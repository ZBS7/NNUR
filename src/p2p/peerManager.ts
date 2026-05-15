/**
 * PeerManager — P2P connections, message routing, E2EE, calls
 */
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { v4 as uuidv4 } from 'uuid';
import { db, Message } from '../db/database';
import { encrypt, decrypt, getSharedKey } from '../crypto/e2ee';

export type P2PMessage =
  | { type: 'chat'; id: string; content: string; mimeType?: string; fileName?: string; fileSize?: number; msgType: string; replyToId?: string; createdAt: number; encrypted: boolean }
  | { type: 'delivered'; messageId: string }
  | { type: 'read'; messageId: string }
  | { type: 'typing'; isTyping: boolean }
  | { type: 'handshake'; displayName: string; avatar?: string; publicKey: string }
  | { type: 'handshake_ack'; displayName: string; avatar?: string; publicKey: string }
  | { type: 'call_end' }
  | { type: 'call_reject' };

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface PeerState {
  conn: DataConnection;
  status: ConnectionStatus;
  peerId: string;
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

  // Active call state
  private activeCall: MediaConnection | null = null;
  private localStream: MediaStream | null = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async init(peerId: string, privateKey: string, publicKey: string, displayName: string, avatar?: string) {
    this.myPeerId = peerId;
    this.myPrivateKey = privateKey;
    this.myPublicKey = publicKey;
    this.myDisplayName = displayName;
    this.myAvatar = avatar || '';

    return new Promise<void>((resolve, reject) => {
      this.peer = new Peer(peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
        debug: 0,
      });

      this.peer.on('open', (id) => {
        console.log('[NUR] Connected, peer ID:', id);
        this.emit('ready', id);
        resolve();
      });

      this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));

      // Incoming call
      this.peer.on('call', (call) => {
        this.emit('incoming-call', {
          peerId: call.peer,
          call,
          callType: (call.metadata?.callType as 'audio' | 'video') || 'audio',
        });
      });

      this.peer.on('error', (err) => {
        console.error('[NUR] Peer error:', err);
        this.emit('error', err);
        if ((err as any).type === 'unavailable-id') reject(err);
      });

      this.peer.on('disconnected', () => {
        this.emit('server-disconnected');
        setTimeout(() => this.peer?.reconnect(), 3000);
      });
    });
  }

  // ── Connect to a peer ─────────────────────────────────────────────────────
  connectTo(targetPeerId: string): void {
    if (!targetPeerId || targetPeerId === this.myPeerId) return;
    const existing = this.connections.get(targetPeerId);
    if (existing?.status === 'connected') return;
    if (!this.peer) return;

    this.emit('connection-status', { peerId: targetPeerId, status: 'connecting' });
    const conn = this.peer.connect(targetPeerId, {
      reliable: true,
      serialization: 'json',
      metadata: { from: this.myPeerId },
    });
    this.setupConnection(conn, targetPeerId);
  }

  // ── Setup data connection ─────────────────────────────────────────────────
  private setupConnection(conn: DataConnection, peerId: string) {
    const state: PeerState = { conn, status: 'connecting', peerId };
    this.connections.set(peerId, state);

    conn.on('open', async () => {
      state.status = 'connected';
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
    });

    conn.on('data', (data) => this.handleData(peerId, data as P2PMessage));

    conn.on('close', async () => {
      state.status = 'disconnected';
      this.connections.delete(peerId);
      await db.contacts.update(peerId, { online: false, lastSeen: Date.now() });
      this.emit('connection-status', { peerId, status: 'disconnected' });
      this.emit('contact-offline', peerId);
      const timer = setTimeout(() => this.connectTo(peerId), 5000);
      this.reconnectTimers.set(peerId, timer);
    });

    conn.on('error', (err) => {
      console.error('[NUR] Connection error with', peerId, err);
      state.status = 'disconnected';
    });
  }

  private handleIncomingConnection(conn: DataConnection) {
    this.setupConnection(conn, conn.peer);
  }

  // ── Handle incoming data ──────────────────────────────────────────────────
  private async handleData(fromPeerId: string, data: P2PMessage) {
    switch (data.type) {
      case 'handshake':
      case 'handshake_ack': {
        const existing = await db.contacts.get(fromPeerId);
        if (!existing) {
          await db.contacts.put({
            id: fromPeerId,
            displayName: data.displayName,
            avatar: data.avatar,
            publicKey: data.publicKey,
            addedAt: Date.now(),
            online: true,
            lastSeen: Date.now(),
          });
          const chatExists = await db.chats.get(fromPeerId);
          if (!chatExists) {
            await db.chats.put({ id: fromPeerId, type: 'direct', unreadCount: 0, createdAt: Date.now() });
          }
        } else {
          await db.contacts.update(fromPeerId, {
            displayName: data.displayName,
            avatar: data.avatar,
            publicKey: data.publicKey,
            online: true,
            lastSeen: Date.now(),
          });
        }
        if (data.type === 'handshake') {
          const conn = this.connections.get(fromPeerId)?.conn;
          if (conn) {
            this.sendRaw(conn, {
              type: 'handshake_ack',
              displayName: this.myDisplayName,
              avatar: this.myAvatar,
              publicKey: this.myPublicKey,
            });
          }
        }
        this.emit('contact-updated', fromPeerId);
        break;
      }

      case 'chat': {
        let content = data.content;
        if (data.encrypted) {
          try {
            const contact = await db.contacts.get(fromPeerId);
            const identity = await db.identity.get('me');
            if (contact?.publicKey && identity) {
              const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, fromPeerId);
              content = await decrypt(content, sharedKey);
            }
          } catch {
            content = '[Decryption failed]';
          }
        }
        const message: Message = {
          id: data.id, chatId: fromPeerId, senderId: fromPeerId,
          type: data.msgType as any, content,
          fileName: data.fileName, fileSize: data.fileSize, mimeType: data.mimeType,
          replyToId: data.replyToId, status: 'delivered',
          createdAt: data.createdAt, encrypted: data.encrypted,
        };
        await db.messages.put(message);
        await db.chats.update(fromPeerId, {
          lastMessage: data.msgType === 'text' ? content.slice(0, 100) : `[${data.msgType}]`,
          lastMessageAt: data.createdAt,
          lastMessageType: data.msgType as any,
        });
        await db.chats.where('id').equals(fromPeerId).modify((c) => { c.unreadCount = (c.unreadCount || 0) + 1; });
        const conn = this.connections.get(fromPeerId)?.conn;
        if (conn) this.sendRaw(conn, { type: 'delivered', messageId: data.id });
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

  // ── CALLS ─────────────────────────────────────────────────────────────────

  async startCall(toPeerId: string, callType: 'audio' | 'video'): Promise<MediaStream> {
    if (!this.peer) throw new Error('Not connected');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
    this.localStream = stream;

    const call = this.peer.call(toPeerId, stream, {
      metadata: { callType, callerName: this.myDisplayName, callerAvatar: this.myAvatar },
    });
    this.activeCall = call;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.endCall(toPeerId);
        reject(new Error('Call timeout — no answer'));
      }, 30000);

      call.on('stream', (remoteStream) => {
        clearTimeout(timeout);
        this.emit('call-stream', { peerId: toPeerId, stream: remoteStream });
        resolve(stream);
      });

      call.on('close', () => {
        clearTimeout(timeout);
        this.cleanupCall();
        this.emit('call-ended', { peerId: toPeerId });
      });

      call.on('error', (err) => {
        clearTimeout(timeout);
        this.cleanupCall();
        reject(err);
      });
    });
  }

  async answerCall(call: MediaConnection, callType: 'audio' | 'video'): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
    this.localStream = stream;
    this.activeCall = call;
    call.answer(stream);

    return new Promise((resolve, reject) => {
      call.on('stream', (remoteStream) => {
        resolve({ localStream: stream, remoteStream });
      });
      call.on('close', () => {
        this.cleanupCall();
        this.emit('call-ended', { peerId: call.peer });
      });
      call.on('error', (err) => {
        this.cleanupCall();
        reject(err);
      });
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

  toggleMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  toggleCamera(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async sendMessage(toPeerId: string, content: string, msgType = 'text', extra?: { fileName?: string; fileSize?: number; mimeType?: string; replyToId?: string }): Promise<Message> {
    const identity = await db.identity.get('me');
    const contact = await db.contacts.get(toPeerId);
    let encryptedContent = content;
    let isEncrypted = false;

    if (identity && contact?.publicKey) {
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

    const chatExists = await db.chats.get(toPeerId);
    if (!chatExists) await db.chats.put({ id: toPeerId, type: 'direct', unreadCount: 0, createdAt: Date.now() });
    await db.chats.update(toPeerId, {
      lastMessage: msgType === 'text' ? content.slice(0, 100) : `[${msgType}]`,
      lastMessageAt: message.createdAt,
      lastMessageType: msgType as any,
    });

    const state = this.connections.get(toPeerId);
    if (state?.status === 'connected') {
      this.sendRaw(state.conn, {
        type: 'chat', id: message.id, content: encryptedContent, msgType,
        fileName: extra?.fileName, fileSize: extra?.fileSize,
        mimeType: extra?.mimeType, replyToId: extra?.replyToId,
        createdAt: message.createdAt, encrypted: isEncrypted,
      });
      await db.messages.update(message.id, { status: 'sent' });
      message.status = 'sent';
    } else {
      this.connectTo(toPeerId);
    }

    this.emit('new-message', message);
    return message;
  }

  private async flushPendingMessages(peerId: string) {
    const pending = await db.messages.where('chatId').equals(peerId)
      .and((m) => m.status === 'sending' && m.senderId === this.myPeerId).toArray();
    for (const msg of pending) {
      const identity = await db.identity.get('me');
      const contact = await db.contacts.get(peerId);
      let content = msg.content;
      let isEncrypted = false;
      if (identity && contact?.publicKey) {
        try {
          const sharedKey = await getSharedKey(identity.privateKey, contact.publicKey, peerId);
          content = await encrypt(msg.content, sharedKey);
          isEncrypted = true;
        } catch {}
      }
      const state = this.connections.get(peerId);
      if (state?.status === 'connected') {
        this.sendRaw(state.conn, {
          type: 'chat', id: msg.id, content, msgType: msg.type,
          fileName: msg.fileName, fileSize: msg.fileSize, mimeType: msg.mimeType,
          replyToId: msg.replyToId, createdAt: msg.createdAt, encrypted: isEncrypted,
        });
        await db.messages.update(msg.id, { status: 'sent' });
      }
    }
  }

  sendTyping(toPeerId: string, isTyping: boolean) {
    const state = this.connections.get(toPeerId);
    if (state?.status === 'connected') this.sendRaw(state.conn, { type: 'typing', isTyping });
  }

  sendRead(toPeerId: string, messageId: string) {
    const state = this.connections.get(toPeerId);
    if (state?.status === 'connected') this.sendRaw(state.conn, { type: 'read', messageId });
  }

  private sendRaw(conn: DataConnection, data: P2PMessage) {
    try { conn.send(data); } catch (err) { console.error('[NUR] Send error:', err); }
  }

  getConnectionStatus(peerId: string): ConnectionStatus {
    return this.connections.get(peerId)?.status ?? 'disconnected';
  }

  isConnected(peerId: string) { return this.connections.get(peerId)?.status === 'connected'; }
  getMyPeerId() { return this.myPeerId; }

  destroy() {
    this.reconnectTimers.forEach((t) => clearTimeout(t));
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
