import Dexie, { Table } from 'dexie';

export interface Identity {
  id: string; // always 'me'
  peerId: string;
  displayName: string;
  avatar?: string;
  publicKey: string;  // base64 ECDH public key
  privateKey: string; // base64 ECDH private key (stored locally only)
  createdAt: number;
}

export interface Contact {
  id: string;          // their peerId
  displayName: string;
  avatar?: string;
  publicKey: string;   // their ECDH public key (for E2EE)
  addedAt: number;
  lastSeen?: number;
  online?: boolean;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'system';

export interface Message {
  id: string;
  chatId: string;      // peerId of the other person (or group id)
  senderId: string;    // peerId of sender
  type: MessageType;
  content: string;     // text or base64 data for files
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  replyToId?: string;
  status: MessageStatus;
  createdAt: number;
  encrypted?: boolean;
}

export interface Chat {
  id: string;          // peerId of contact (for direct) or group id
  type: 'direct' | 'group';
  name?: string;       // for groups
  avatar?: string;
  memberIds?: string[];
  lastMessage?: string;
  lastMessageAt?: number;
  lastMessageType?: MessageType;
  unreadCount: number;
  createdAt: number;
}

export interface PendingSignal {
  id: string;
  type: 'offer' | 'answer';
  targetPeerId: string;
  sdp: string;
  createdAt: number;
}

class P2PDatabase extends Dexie {
  identity!: Table<Identity>;
  contacts!: Table<Contact>;
  messages!: Table<Message>;
  chats!: Table<Chat>;
  pendingSignals!: Table<PendingSignal>;

  constructor() {
    super('P2PMessenger');
    this.version(1).stores({
      identity: 'id',
      contacts: 'id, displayName, addedAt',
      messages: 'id, chatId, senderId, createdAt, status',
      chats: 'id, type, lastMessageAt',
      pendingSignals: 'id, targetPeerId, createdAt',
    });
  }
}

export const db = new P2PDatabase();
