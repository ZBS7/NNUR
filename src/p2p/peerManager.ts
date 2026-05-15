/**
 * PeerManager — P2P connections, message routing, E2EE, calls
 */
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { v4 as uuidv4 } from 'uuid';
import { db, Message } from '../db/database';
import { encrypt, decrypt, getSharedKey } from '../crypto/e2ee';

const SIGNAL_HOST = 'nur-signal-production.up.railway.app';
const SIGNAL_PATH = '/nur';

// Fallback ICE servers (used if /ice-servers endpoint fails)
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: 'd0a07fcab67f4f9a0f9fd81d',
    credential: 'LQEPITaYF3Lyvz5o',
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: 'd0a07fcab67f4f9a0f9fd81d',
    credential: 'LQEPITaYF3Lyvz5o',
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: 'd0a07fcab67f4f9a0f9fd81d',
    credential: 'LQEPITaYF3Lyvz5o',
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: 'd0a07fcab67f4f9a0f9fd81d',
    credential: 'LQEPITaYF3Lyvz5o',
  },
];

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`https://${SIGNAL_HOST}/ice-servers`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      console.log('[NUR] Got', data.length, 'ICE servers from backend');
      return data;
    }
    return FALLBACK_ICE;
  } catch (err) {
    console.warn('[NUR] Could not fetch ICE servers, using fallback:', err);
    return FALLBACK_ICE;
  }
}

// Chunk size for large binary data (16KB — conservative for reliability)
const CHUNK_SIZE = 16 * 1024;

// Type for a chat message payload
interface ChatPayload {
  type: 'chat';
  id: string;
  content: string;
  msgType: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  replyToId?: string;
  createdAt: number;
  encrypted: boolean;
  chunked?: boolean;
  chunkIndex?: number;
  totalChunks?: number;
}

export type P2PMessage =
  | ChatPayload
  | { type: 'delivered'; messageId: string }
  | { type: 'read'; messageId: string }
  | { type: 'typing'; isTyping: boolean }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'handshake'; displayName: string; avatar?: string; publicKey: string }
  | { type: 'handshake_ack'; displayName: string; avatar?: string; publicKey: string }
  | { type: 'call_end' }
  | { type: 'call_reject' };

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface PeerState {
  conn: DataConnection;
  status: ConnectionStatus;
  peerId: string;
  // Ping/pong for keepalive — only when NOT transferring
  pingTimer?: ReturnType<typeof setInterval>;
  pongTimeout?: ReturnType<typeof setTimeout>;
  transferring: boolean; // true while sending chunks
}

interface ChunkBuffer {
  chunks: string[];
  total: number;
  meta: ChatPayload;
}

type EventHandler = (...args: any[]) => void;

class PeerManager {
  private peer: Peer | null = null;
  private myPeerId = '';
  private myPrivateKey = '';
  private myPublicKey = '';
  private myDisplayName = '';
  private myAvatar = '';
  private connections = new Map<string, PeerState>();
  private handlers = new Map<string, EventHandler[]>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryCount = 0;
  private iceServers: RTCIceServer[] = FALLBACK_ICE;
  private chunkBuffers = new Map<string, ChunkBuffer>();
  private activeCall: MediaConnection | null = null;
  private localStream: MediaStream | null = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async init(peerId: string, privateKey: string, publicKey: string, displayName: string, avatar?: string) {
    this.myPeerId = peerId;
    this.myPrivateKey = privateKey;
    this.myPublicKey = publicKey;
    this.myDisplayName = displayName;
    this.myAvatar = avatar || '';
    this.retryCount = 0;
    // Fetch fresh ICE servers (includes TURN credentials from Metered)
    this.iceServers = await fetchIceServers();
    return new Promise<void>((resolve, reject) => this.createPeer(resolve, reject));
  }

  private createPeer(resolve?: () => void, reject?: (e: any) => void) {
    if (this.peer && !this.peer.destroyed) this.peer.destroy();

    this.peer = new Peer(this.myPeerId, {
      host: SIGNAL_HOST,
      port: 443,
      path: SIGNAL_PATH,
      secure: true,
      config: { iceServers: this.iceServers },
      debug: 0,
    });

    const timeout = setTimeout(() => {
      this.peer?.destroy();
      this.retryCount++;
      if (this.retryCount < 5) {
        setTimeout(() => this.createPeer(resolve, reject), 2000);
      } else {
        reject?.(new Error('Cannot connect to P2P network.'));
      }
    }, 10000);

    this.peer.on('open', (id) => {
      clearTimeout(timeout);
      this.retryCount = 0;
      console.log('[NUR] Connected, ID:', id);
      this.emit('ready', id);
      resolve?.();
    });

    this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));

    this.peer.on('call', (call) => {
      this.emit('incoming-call', {
        peerId: call.peer, call,
        callType: (call.metadata?.callType as 'audio' | 'video') || 'audio',
      });
    });

    this.peer.on('error', (err: any) => {
      clearTimeout(timeout);
      console.error('[NUR] Error:', err.type);

      if (err.type === 'unavailable-id') {
        this.myPeerId = `nur${Math.random().toString(36).slice(2, 10)}`;
        this.peer?.destroy();
        setTimeout(() => this.createPeer(resolve, reject), 500);
        return;
      }
      if (err.type === 'peer-unavailable') {
        const match = err.message?.match(/Could not connect to peer (.+)/);
        if (match) {
          const pid = match[1].trim();
          this.connections.delete(pid);
          this.emit('connection-status', { peerId: pid, status: 'disconnected' });
          db.contacts.update(pid, { online: false, lastSeen: Date.now() });
          this.scheduleReconnect(pid, 10000);
        }
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.retryCount++;
        this.peer?.destroy();
        setTimeout(() => this.createPeer(resolve, reject), 2000);
        return;
      }
      this.emit('error', err);
    });

    this.peer.on('disconnected', () => {
      this.emit('server-disconnected');
      setTimeout(() => {
        if (this.peer && !this.peer.destroyed) this.peer.reconnect();
        else this.createPeer();
      }, 3000);
    });
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  connectTo(targetPeerId: string): void {
    if (!targetPeerId || targetPeerId === this.myPeerId) return;
    const ex = this.connections.get(targetPeerId);
    if (ex?.status === 'connected' || ex?.status === 'connecting') return;
    if (!this.peer || this.peer.destroyed) return;

    this.emit('connection-status', { peerId: targetPeerId, status: 'connecting' });
    const conn = this.peer.connect(targetPeerId, {
      reliable: true, serialization: 'json',
      metadata: { from: this.myPeerId },
    });
    console.log('[NUR] 🔄 Initiating connection to:', targetPeerId);
    this.setupConnection(conn, targetPeerId);
  }

  private setupConnection(conn: DataConnection, peerId: string) {
    const old = this.connections.get(peerId);
    if (old && old.conn !== conn) {
      this.stopPing(old);
      try { old.conn.close(); } catch {}
    }

    const state: PeerState = { conn, status: 'connecting', peerId, transferring: false };
    this.connections.set(peerId, state);

    const openTimeout = setTimeout(() => {
      if (state.status !== 'connected') {
        this.connections.delete(peerId);
        this.emit('connection-status', { peerId, status: 'disconnected' });
        this.scheduleReconnect(peerId, 5000);
      }
    }, 15000);

    conn.on('open', async () => {
      clearTimeout(openTimeout);
      state.status = 'connected';
      console.log('[NUR] ✅ Connected to peer:', peerId);
      this.emit('connection-status', { peerId, status: 'connected' });
      this.sendRaw(conn, {
        type: 'handshake',
        displayName: this.myDisplayName,
        avatar: this.myAvatar,
        publicKey: this.myPublicKey,
      });
      await db.contacts.update(peerId, { online: true, lastSeen: Date.now() });
      this.emit('contact-online', peerId);
      this.flushPendingMessages(peerId);
      this.startPing(state);
    });

    conn.on('data', (data) => this.handleData(peerId, data as P2PMessage, state));

    conn.on('close', async () => {
      clearTimeout(openTimeout);
      this.stopPing(state);
      state.status = 'disconnected';
      this.connections.delete(peerId);
      await db.contacts.update(peerId, { online: false, lastSeen: Date.now() });
      this.emit('connection-status', { peerId, status: 'disconnected' });
      this.emit('contact-offline', peerId);
      this.scheduleReconnect(peerId, 5000);
    });

    conn.on('error', (err) => {
      clearTimeout(openTimeout);
      this.stopPing(state);
      console.error('[NUR] Conn error:', peerId, err);
      state.status = 'disconnected';
      this.connections.delete(peerId);
      this.emit('connection-status', { peerId, status: 'disconnected' });
      this.scheduleReconnect(peerId, 5000);
    });
  }

  // Ping only when idle (not transferring)
  private startPing(state: PeerState) {
    this.stopPing(state);
    state.pingTimer = setInterval(() => {
      if (state.status !== 'connected' || state.transferring) return;
      this.sendRaw(state.conn, { type: 'ping' });
      state.pongTimeout = setTimeout(() => {
        if (!state.transferring) {
          console.warn('[NUR] Pong timeout, closing:', state.peerId);
          state.conn.close();
        }
      }, 8000);
    }, 25000);
  }

  private stopPing(state: PeerState) {
    if (state.pingTimer) clearInterval(state.pingTimer);
    if (state.pongTimeout) clearTimeout(state.pongTimeout);
  }

  private handleIncomingConnection(conn: DataConnection) {
    this.setupConnection(conn, conn.peer);
  }

  // ── Handle data ───────────────────────────────────────────────────────────
  private async handleData(fromPeerId: string, data: P2PMessage, state: PeerState) {
    switch (data.type) {
      case 'ping':
        this.sendRaw(state.conn, { type: 'pong' });
        break;

      case 'pong':
        if (state.pongTimeout) clearTimeout(state.pongTimeout);
        break;

      case 'handshake':
      case 'handshake_ack': {
        const existing = await db.contacts.get(fromPeerId);
        if (!existing) {
          await db.contacts.put({
            id: fromPeerId, displayName: data.displayName,
            avatar: data.avatar, publicKey: data.publicKey,
            addedAt: Date.now(), online: true, lastSeen: Date.now(),
          });
          if (!await db.chats.get(fromPeerId)) {
            await db.chats.put({ id: fromPeerId, type: 'direct', unreadCount: 0, createdAt: Date.now() });
          }
        } else {
          await db.contacts.update(fromPeerId, {
            displayName: data.displayName, avatar: data.avatar,
            publicKey: data.publicKey, online: true, lastSeen: Date.now(),
          });
        }
        if (data.type === 'handshake') {
          this.sendRaw(state.conn, {
            type: 'handshake_ack',
            displayName: this.myDisplayName,
            avatar: this.myAvatar,
            publicKey: this.myPublicKey,
          });
        }
        this.emit('contact-updated', fromPeerId);
        break;
      }

      case 'chat': {
        // Chunked reassembly
        let chatData: ChatPayload = data;
        if (data.chunked && data.totalChunks && data.totalChunks > 1) {
          let buf = this.chunkBuffers.get(data.id);
          if (!buf) {
            // Pre-allocate array with exact size
            buf = {
              chunks: new Array(data.totalChunks).fill(null),
              total: data.totalChunks,
              meta: data,
            };
            this.chunkBuffers.set(data.id, buf);
          }
          // Store chunk at exact index
          buf.chunks[data.chunkIndex!] = data.content;

          // Count non-null chunks
          const received = buf.chunks.filter((c) => c !== null).length;
          console.log(`[NUR] Chunk ${data.chunkIndex! + 1}/${data.totalChunks} for msg ${data.id.slice(0, 8)}`);

          if (received < buf.total) break; // wait for more

          // All chunks received — reassemble in order
          chatData = { ...buf.meta, content: buf.chunks.join(''), chunked: false };
          this.chunkBuffers.delete(data.id);
          console.log(`[NUR] Reassembled ${data.totalChunks} chunks, total size: ${chatData.content.length}`);
        }

        let content = chatData.content;
        if (chatData.encrypted) {
          try {
            const contact = await db.contacts.get(fromPeerId);
            const identity = await db.identity.get('me');
            if (contact?.publicKey && identity) {
              const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, fromPeerId);
              content = await decrypt(content, sharedKey);
            }
          } catch { content = '[Decryption failed]'; }
        }

        const message: Message = {
          id: chatData.id, chatId: fromPeerId, senderId: fromPeerId,
          type: chatData.msgType as any, content,
          fileName: chatData.fileName, fileSize: chatData.fileSize,
          mimeType: chatData.mimeType, replyToId: chatData.replyToId,
          status: 'delivered', createdAt: chatData.createdAt, encrypted: chatData.encrypted,
        };
        await db.messages.put(message);
        await db.chats.update(fromPeerId, {
          lastMessage: chatData.msgType === 'text' ? content.slice(0, 100) : `[${chatData.msgType}]`,
          lastMessageAt: chatData.createdAt, lastMessageType: chatData.msgType as any,
        });
        await db.chats.where('id').equals(fromPeerId).modify((c) => { c.unreadCount = (c.unreadCount || 0) + 1; });
        this.sendRaw(state.conn, { type: 'delivered', messageId: chatData.id });
        this.emit('new-message', message);
        break;
      }

      case 'delivered':
        await db.messages.update(data.messageId, { status: 'delivered' });
        this.emit('message-status', { id: data.messageId, status: 'delivered' });
        break;

      case 'read':
        await db.messages.update(data.messageId, { status: 'read' });
        this.emit('message-status', { id: data.messageId, status: 'read' });
        break;

      case 'typing':
        this.emit('typing', { peerId: fromPeerId, isTyping: data.isTyping });
        break;

      case 'call_end':
        this.emit('call-ended', { peerId: fromPeerId });
        this.cleanupCall();
        break;

      case 'call_reject':
        this.emit('call-rejected', { peerId: fromPeerId });
        this.cleanupCall();
        break;
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async sendMessage(toPeerId: string, content: string, msgType = 'text', extra?: {
    fileName?: string; fileSize?: number; mimeType?: string; replyToId?: string;
  }): Promise<Message> {
    const identity = await db.identity.get('me');
    const contact = await db.contacts.get(toPeerId);
    let sendContent = content;
    let isEncrypted = false;

    // Only encrypt text — binary base64 is too large
    if (identity && contact?.publicKey && msgType === 'text') {
      try {
        const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, toPeerId);
        sendContent = await encrypt(content, sharedKey);
        isEncrypted = true;
      } catch {}
    }

    const message: Message = {
      id: uuidv4(), chatId: toPeerId, senderId: this.myPeerId,
      type: msgType as any, content, ...extra,
      status: 'sending', createdAt: Date.now(), encrypted: isEncrypted,
    };
    await db.messages.put(message);

    if (!await db.chats.get(toPeerId)) {
      await db.chats.put({ id: toPeerId, type: 'direct', unreadCount: 0, createdAt: Date.now() });
    }
    await db.chats.update(toPeerId, {
      lastMessage: msgType === 'text' ? content.slice(0, 100) : `[${msgType}]`,
      lastMessageAt: message.createdAt, lastMessageType: msgType as any,
    });

    const state = this.connections.get(toPeerId);
    if (state?.status === 'connected') {
      await this.transmit(state, message, sendContent, isEncrypted, extra);
      await db.messages.update(message.id, { status: 'sent' });
      message.status = 'sent';
    } else {
      this.connectTo(toPeerId);
    }

    this.emit('new-message', message);
    return message;
  }

  // Transmit with chunking for large payloads
  private async transmit(
    state: PeerState, message: Message,
    sendContent: string, isEncrypted: boolean,
    extra?: { fileName?: string; fileSize?: number; mimeType?: string; replyToId?: string }
  ) {
    const base: Omit<ChatPayload, 'content' | 'chunked' | 'chunkIndex' | 'totalChunks'> = {
      type: 'chat', id: message.id, msgType: message.type,
      fileName: extra?.fileName, fileSize: extra?.fileSize,
      mimeType: extra?.mimeType, replyToId: extra?.replyToId,
      createdAt: message.createdAt, encrypted: isEncrypted,
    };

    if (sendContent.length <= CHUNK_SIZE) {
      this.sendRaw(state.conn, { ...base, content: sendContent });
      return;
    }

    // Large payload — chunk it, pause ping during transfer
    state.transferring = true;
    const totalChunks = Math.ceil(sendContent.length / CHUNK_SIZE);
    console.log(`[NUR] Sending ${totalChunks} chunks for ${message.type} (${Math.round(sendContent.length / 1024)}KB)`);

    try {
      for (let i = 0; i < totalChunks; i++) {
        // Wait if DataChannel buffer is getting full (flow control)
        await this.waitForBuffer(state.conn);

        const chunk = sendContent.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        this.sendRaw(state.conn, {
          ...base, content: chunk,
          chunked: true, chunkIndex: i, totalChunks,
        });
        // Small delay between chunks
        await new Promise((r) => setTimeout(r, 30));
      }
      console.log(`[NUR] All ${totalChunks} chunks sent for ${message.id.slice(0, 8)}`);
    } catch (err) {
      console.error('[NUR] Transmit error:', err);
      throw err;
    } finally {
      state.transferring = false;
    }
  }

  // Wait until DataChannel buffer drains below threshold
  private waitForBuffer(conn: DataConnection): Promise<void> {
    return new Promise((resolve) => {
      // Access underlying RTCDataChannel
      const dc = (conn as any)._dc as RTCDataChannel | undefined;
      if (!dc) { resolve(); return; }

      const MAX_BUFFER = 256 * 1024; // 256KB threshold
      if (dc.bufferedAmount < MAX_BUFFER) { resolve(); return; }

      const check = () => {
        if (dc.bufferedAmount < MAX_BUFFER) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      setTimeout(check, 50);
    });
  }

  private async flushPendingMessages(peerId: string) {
    const pending = await db.messages.where('chatId').equals(peerId)
      .and((m) => m.status === 'sending' && m.senderId === this.myPeerId).toArray();
    for (const msg of pending) {
      const identity = await db.identity.get('me');
      const contact = await db.contacts.get(peerId);
      let content = msg.content;
      let isEncrypted = false;
      if (identity && contact?.publicKey && msg.type === 'text') {
        try {
          const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, peerId);
          content = await encrypt(msg.content, sharedKey);
          isEncrypted = true;
        } catch {}
      }
      const state = this.connections.get(peerId);
      if (state?.status === 'connected') {
        await this.transmit(state, msg, content, isEncrypted, {
          fileName: msg.fileName, fileSize: msg.fileSize,
          mimeType: msg.mimeType, replyToId: msg.replyToId,
        });
        await db.messages.update(msg.id, { status: 'sent' });
      }
    }
  }

  // ── Calls ─────────────────────────────────────────────────────────────────
  async startCall(toPeerId: string, callType: 'audio' | 'video'): Promise<MediaStream> {
    if (!this.peer) throw new Error('Not connected');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
    this.localStream = stream;
    const call = this.peer.call(toPeerId, stream, {
      metadata: { callType, callerName: this.myDisplayName, callerAvatar: this.myAvatar },
    });
    this.activeCall = call;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.endCall(toPeerId); reject(new Error('No answer')); }, 30000);
      call.on('stream', (s) => { clearTimeout(t); this.emit('call-stream', { peerId: toPeerId, stream: s }); resolve(stream); });
      call.on('close', () => { clearTimeout(t); this.cleanupCall(); this.emit('call-ended', { peerId: toPeerId }); });
      call.on('error', (e) => { clearTimeout(t); this.cleanupCall(); reject(e); });
    });
  }

  async answerCall(call: MediaConnection, callType: 'audio' | 'video'): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
    this.localStream = stream;
    this.activeCall = call;
    call.answer(stream);
    return new Promise((resolve, reject) => {
      call.on('stream', (s) => resolve({ localStream: stream, remoteStream: s }));
      call.on('close', () => { this.cleanupCall(); this.emit('call-ended', { peerId: call.peer }); });
      call.on('error', (e) => { this.cleanupCall(); reject(e); });
    });
  }

  endCall(toPeerId: string) {
    const conn = this.connections.get(toPeerId)?.conn;
    if (conn) this.sendRaw(conn, { type: 'call_end' });
    this.cleanupCall();
  }

  rejectCall(toPeerId: string) {
    const conn = this.connections.get(toPeerId)?.conn;
    if (conn) this.sendRaw(conn, { type: 'call_reject' });
    this.activeCall?.close();
    this.activeCall = null;
  }

  private cleanupCall() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.activeCall?.close();
    this.activeCall = null;
  }

  toggleMute(muted: boolean) { this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted)); }
  toggleCamera(off: boolean) { this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off)); }

  sendTyping(toPeerId: string, isTyping: boolean) {
    const s = this.connections.get(toPeerId);
    if (s?.status === 'connected') this.sendRaw(s.conn, { type: 'typing', isTyping });
  }

  sendRead(toPeerId: string, messageId: string) {
    const s = this.connections.get(toPeerId);
    if (s?.status === 'connected') this.sendRaw(s.conn, { type: 'read', messageId });
  }

  private sendRaw(conn: DataConnection, data: P2PMessage) {
    try { conn.send(data); } catch (e) { console.error('[NUR] Send error:', e); }
  }

  private scheduleReconnect(peerId: string, delay: number) {
    const old = this.reconnectTimers.get(peerId);
    if (old) clearTimeout(old);
    const t = setTimeout(() => this.connectTo(peerId), delay);
    this.reconnectTimers.set(peerId, t);
  }

  getConnectionStatus(peerId: string): ConnectionStatus { return this.connections.get(peerId)?.status ?? 'disconnected'; }
  isConnected(peerId: string) { return this.connections.get(peerId)?.status === 'connected'; }
  getMyPeerId() { return this.myPeerId; }

  destroy() {
    this.reconnectTimers.forEach((t) => clearTimeout(t));
    this.connections.forEach((s) => this.stopPing(s));
    this.cleanupCall();
    this.peer?.destroy();
    this.peer = null;
    this.connections.clear();
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }
  off(event: string, handler: EventHandler) {
    const list = this.handlers.get(event);
    if (list) this.handlers.set(event, list.filter((h) => h !== handler));
  }
  private emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

export const peerManager = new PeerManager();
