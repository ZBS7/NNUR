/**
 * PeerManager — P2P connections, message routing, E2EE, calls
 * Fixed: online status, large file chunking, message retry
 */
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { v4 as uuidv4 } from 'uuid';
import { db, Message } from '../db/database';
import { encrypt, decrypt, getSharedKey } from '../crypto/e2ee';

// ── Config ────────────────────────────────────────────────────────────────
const SIGNAL_HOST = 'nur-signal-production.up.railway.app';
const SIGNAL_PATH = '/nur';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

// Max size per chunk for large files (64KB)
const CHUNK_SIZE = 64 * 1024;

export type P2PMessage =
  | { type: 'chat'; id: string; content: string; mimeType?: string; fileName?: string; fileSize?: number; msgType: string; replyToId?: string; createdAt: number; encrypted: boolean; chunked?: boolean; chunkIndex?: number; totalChunks?: number }
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
  pingTimer?: ReturnType<typeof setInterval>;
  pongTimeout?: ReturnType<typeof setTimeout>;
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

  // Chunk reassembly buffers: messageId -> chunks[]
  private chunkBuffers = new Map<string, { chunks: string[]; total: number; meta: any }>();

  // Active call
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
    return this.createPeerPromise();
  }

  private createPeerPromise(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.createPeer(resolve, reject);
    });
  }

  private createPeer(resolve?: () => void, reject?: (e: any) => void) {
    console.log(`[NUR] Connecting to ${SIGNAL_HOST}, ID: ${this.myPeerId}`);

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.peer = new Peer(this.myPeerId, {
      host: SIGNAL_HOST,
      port: 443,
      path: SIGNAL_PATH,
      secure: true,
      config: { iceServers: ICE_SERVERS },
      debug: 0,
    });

    const timeout = setTimeout(() => {
      console.warn('[NUR] Timeout, retrying...');
      this.peer?.destroy();
      this.retryCount++;
      if (this.retryCount < 5) {
        setTimeout(() => this.createPeer(resolve, reject), 2000);
      } else {
        reject?.(new Error('Cannot connect to P2P network. Check internet connection.'));
      }
    }, 10000);

    this.peer.on('open', (id) => {
      clearTimeout(timeout);
      console.log('[NUR] Connected! ID:', id);
      this.retryCount = 0;
      this.emit('ready', id);
      resolve?.();
    });

    this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));

    this.peer.on('call', (call) => {
      this.emit('incoming-call', {
        peerId: call.peer,
        call,
        callType: (call.metadata?.callType as 'audio' | 'video') || 'audio',
      });
    });

    this.peer.on('error', (err: any) => {
      clearTimeout(timeout);
      console.error('[NUR] Error:', err.type, err.message);

      if (err.type === 'unavailable-id') {
        this.myPeerId = `nur${Math.random().toString(36).slice(2, 10)}`;
        this.peer?.destroy();
        setTimeout(() => this.createPeer(resolve, reject), 500);
        return;
      }

      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.retryCount++;
        this.peer?.destroy();
        setTimeout(() => this.createPeer(resolve, reject), 2000);
        return;
      }

      // Non-fatal peer-unavailable — just means the other peer is offline
      if (err.type === 'peer-unavailable') {
        const match = err.message?.match(/Could not connect to peer (.+)/);
        if (match) {
          const peerId = match[1];
          this.connections.delete(peerId);
          this.emit('connection-status', { peerId, status: 'disconnected' });
          db.contacts.update(peerId, { online: false, lastSeen: Date.now() });
        }
        return;
      }

      this.emit('error', err);
    });

    this.peer.on('disconnected', () => {
      console.warn('[NUR] Signaling disconnected, reconnecting...');
      this.emit('server-disconnected');
      setTimeout(() => {
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        } else {
          this.createPeer();
        }
      }, 3000);
    });
  }

  // ── Connect to peer ───────────────────────────────────────────────────────
  connectTo(targetPeerId: string): void {
    if (!targetPeerId || targetPeerId === this.myPeerId) return;
    const existing = this.connections.get(targetPeerId);
    if (existing?.status === 'connected') return;
    if (existing?.status === 'connecting') return;
    if (!this.peer || this.peer.destroyed) return;

    console.log('[NUR] Connecting to:', targetPeerId);
    this.emit('connection-status', { peerId: targetPeerId, status: 'connecting' });

    const conn = this.peer.connect(targetPeerId, {
      reliable: true,
      serialization: 'json',
      metadata: { from: this.myPeerId },
    });
    this.setupConnection(conn, targetPeerId);
  }

  // ── Setup connection ──────────────────────────────────────────────────────
  private setupConnection(conn: DataConnection, peerId: string) {
    const old = this.connections.get(peerId);
    if (old && old.conn !== conn) {
      clearInterval(old.pingTimer);
      clearTimeout(old.pongTimeout);
      try { old.conn.close(); } catch {}
    }

    const state: PeerState = { conn, status: 'connecting', peerId };
    this.connections.set(peerId, state);

    const openTimeout = setTimeout(() => {
      if (state.status !== 'connected') {
        console.warn('[NUR] Open timeout for', peerId);
        this.connections.delete(peerId);
        this.emit('connection-status', { peerId, status: 'disconnected' });
        this.scheduleReconnect(peerId, 5000);
      }
    }, 15000);

    conn.on('open', async () => {
      clearTimeout(openTimeout);
      state.status = 'connected';
      console.log('[NUR] Open with:', peerId);
      this.emit('connection-status', { peerId, status: 'connected' });

      // Send handshake
      this.sendRaw(conn, {
        type: 'handshake',
        displayName: this.myDisplayName,
        avatar: this.myAvatar,
        publicKey: this.myPublicKey,
      });

      await db.contacts.update(peerId, { online: true, lastSeen: Date.now() });
      this.emit('contact-online', peerId);
      this.flushPendingMessages(peerId);

      // Heartbeat ping every 20s to detect silent disconnects
      state.pingTimer = setInterval(() => {
        if (state.status !== 'connected') return;
        this.sendRaw(conn, { type: 'ping' });
        state.pongTimeout = setTimeout(() => {
          console.warn('[NUR] Pong timeout for', peerId, '— reconnecting');
          conn.close();
        }, 5000);
      }, 20000);
    });

    conn.on('data', (data) => this.handleData(peerId, data as P2PMessage, state));

    conn.on('close', async () => {
      clearTimeout(openTimeout);
      clearInterval(state.pingTimer);
      clearTimeout(state.pongTimeout);
      state.status = 'disconnected';
      this.connections.delete(peerId);
      console.log('[NUR] Closed with:', peerId);
      await db.contacts.update(peerId, { online: false, lastSeen: Date.now() });
      this.emit('connection-status', { peerId, status: 'disconnected' });
      this.emit('contact-offline', peerId);
      this.scheduleReconnect(peerId, 5000);
    });

    conn.on('error', (err) => {
      clearTimeout(openTimeout);
      clearInterval(state.pingTimer);
      clearTimeout(state.pongTimeout);
      console.error('[NUR] Conn error with', peerId, err);
      state.status = 'disconnected';
      this.connections.delete(peerId);
      this.emit('connection-status', { peerId, status: 'disconnected' });
      this.scheduleReconnect(peerId, 5000);
    });
  }

  private scheduleReconnect(peerId: string, delay: number) {
    const old = this.reconnectTimers.get(peerId);
    if (old) clearTimeout(old);
    const t = setTimeout(() => this.connectTo(peerId), delay);
    this.reconnectTimers.set(peerId, t);
  }

  private handleIncomingConnection(conn: DataConnection) {
    console.log('[NUR] Incoming from:', conn.peer);
    this.setupConnection(conn, conn.peer);
  }

  // ── Handle data ───────────────────────────────────────────────────────────
  private async handleData(fromPeerId: string, data: P2PMessage, state: PeerState) {
    switch (data.type) {
      case 'ping':
        this.sendRaw(state.conn, { type: 'pong' });
        break;

      case 'pong':
        clearTimeout(state.pongTimeout);
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
        // Handle chunked messages (large files/audio)
        let chatData = data;
        if (data.chunked && data.totalChunks && data.totalChunks > 1) {
          const buf = this.chunkBuffers.get(data.id) || { chunks: [] as string[], total: data.totalChunks, meta: data };
          buf.chunks[data.chunkIndex!] = data.content;
          this.chunkBuffers.set(data.id, buf);
          const received = buf.chunks.filter(Boolean).length;
          if (received < buf.total) break;
          // Reassemble all chunks
          chatData = { ...buf.meta, content: buf.chunks.join(''), chunked: false };
          this.chunkBuffers.delete(data.id);
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
          fileName: chatData.fileName, fileSize: chatData.fileSize, mimeType: chatData.mimeType,
          replyToId: chatData.replyToId, status: 'delivered',
          createdAt: chatData.createdAt, encrypted: chatData.encrypted,
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

  // ── Send message (with chunking for large content) ────────────────────────
  async sendMessage(toPeerId: string, content: string, msgType = 'text', extra?: {
    fileName?: string; fileSize?: number; mimeType?: string; replyToId?: string;
  }): Promise<Message> {
    const identity = await db.identity.get('me');
    const contact = await db.contacts.get(toPeerId);
    let encryptedContent = content;
    let isEncrypted = false;

    // Only encrypt text messages — binary data (base64) is too large to encrypt reliably
    if (identity && contact?.publicKey && msgType === 'text') {
      try {
        const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, toPeerId);
        encryptedContent = await encrypt(content, sharedKey);
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
      await this.sendMessageOverConn(state.conn, message, encryptedContent, isEncrypted, extra);
      await db.messages.update(message.id, { status: 'sent' });
      message.status = 'sent';
    } else {
      this.connectTo(toPeerId);
    }

    this.emit('new-message', message);
    return message;
  }

  private async sendMessageOverConn(
    conn: DataConnection, message: Message,
    encryptedContent: string, isEncrypted: boolean,
    extra?: { fileName?: string; fileSize?: number; mimeType?: string; replyToId?: string }
  ) {
    const base: any = {
      type: 'chat', id: message.id, msgType: message.type,
      fileName: extra?.fileName, fileSize: extra?.fileSize,
      mimeType: extra?.mimeType, replyToId: extra?.replyToId,
      createdAt: message.createdAt, encrypted: isEncrypted,
    };

    // Split large content into chunks (for audio/video/files)
    if (encryptedContent.length > CHUNK_SIZE) {
      const totalChunks = Math.ceil(encryptedContent.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        const chunk = encryptedContent.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        this.sendRaw(conn, {
          ...base,
          content: chunk,
          chunked: true,
          chunkIndex: i,
          totalChunks,
        });
        // Small delay between chunks to avoid overwhelming the channel
        if (i < totalChunks - 1) await new Promise(r => setTimeout(r, 10));
      }
    } else {
      this.sendRaw(conn, { ...base, content: encryptedContent });
    }
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
        await this.sendMessageOverConn(state.conn, msg, content, isEncrypted, {
          fileName: msg.fileName, fileSize: msg.fileSize, mimeType: msg.mimeType, replyToId: msg.replyToId,
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

  // ── Helpers ───────────────────────────────────────────────────────────────
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

  getConnectionStatus(peerId: string): ConnectionStatus { return this.connections.get(peerId)?.status ?? 'disconnected'; }
  isConnected(peerId: string) { return this.connections.get(peerId)?.status === 'connected'; }
  getMyPeerId() { return this.myPeerId; }

  destroy() {
    this.reconnectTimers.forEach((t) => clearTimeout(t));
    this.connections.forEach((s) => { clearInterval(s.pingTimer); clearTimeout(s.pongTimeout); });
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
