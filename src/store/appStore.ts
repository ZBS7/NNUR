import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { db, Identity, Contact, Message, Chat } from '../db/database';import { generateKeyPair } from '../crypto/e2ee';
import { peerManager } from '../p2p/peerManager';

type Screen = 'setup' | 'main';

interface AppState {
  screen: Screen;
  identity: Identity | null;
  contacts: Contact[];
  chats: Chat[];
  activeChatId: string | null;
  messages: Record<string, Message[]>;
  typingPeers: Record<string, boolean>;
  connectionStatuses: Record<string, 'disconnected' | 'connecting' | 'connected'>;
  peerReady: boolean;
  peerError: string | null;

  initIdentity: (displayName: string, avatar?: string) => Promise<void>;
  loadData: () => Promise<void>;
  reloadChatsAndContacts: () => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  loadMessages: (chatId: string) => Promise<void>;
  sendMessage: (toPeerId: string, content: string, type?: string, extra?: any) => Promise<void>;
  connectToPeer: (peerId: string) => void;
  addContactByPeerId: (peerId: string) => void;
  updateContact: (contact: Contact) => void;
  addMessage: (message: Message) => void;
  updateMessageStatus: (id: string, status: Message['status']) => void;
  setTyping: (peerId: string, isTyping: boolean) => void;
  setConnectionStatus: (peerId: string, status: 'disconnected' | 'connecting' | 'connected') => void;
  setPeerReady: (ready: boolean) => void;
  setPeerError: (err: string | null) => void;
  markChatRead: (chatId: string) => Promise<void>;
}

// Track whether PeerJS has been initialized
let peerInitialized = false;

export const useAppStore = create<AppState>()((set, get) => ({
  screen: 'setup',
  identity: null,
  contacts: [],
  chats: [],
  activeChatId: null,
  messages: {},
  typingPeers: {},
  connectionStatuses: {},
  peerReady: false,
  peerError: null,

  initIdentity: async (displayName, avatar) => {
    const keys = await generateKeyPair();
    // Short alphanumeric ID — PeerJS cloud works best with these
    const peerId = `nur${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const identity: Identity = {
      id: 'me', peerId, displayName, avatar,
      publicKey: keys.publicKey, privateKey: keys.privateKey,
      createdAt: Date.now(),
    };
    await db.identity.put(identity);
    set({ identity, screen: 'main' });
    await get().loadData();
  },

  loadData: async () => {
    const identity = await db.identity.get('me');
    if (!identity) { set({ screen: 'setup' }); return; }

    const contacts = await db.contacts.orderBy('displayName').toArray();
    const chats = await db.chats.orderBy('lastMessageAt').reverse().toArray();
    set({ identity, contacts, chats, screen: 'main' });

    // Only init PeerJS once
    if (peerInitialized) return;
    peerInitialized = true;

    try {
      await peerManager.init(
        identity.peerId, identity.privateKey, identity.publicKey,
        identity.displayName, identity.avatar
      );
      set({ peerReady: true });

      // Auto-connect to all known contacts
      for (const contact of contacts) {
        peerManager.connectTo(contact.id);
      }
    } catch (err: any) {
      peerInitialized = false; // allow retry
      set({ peerError: err.message || 'Failed to connect to P2P network' });
    }

    // Register event handlers (only once)
    peerManager.on('new-message', (msg: Message) => {
      get().addMessage(msg);
      db.chats.orderBy('lastMessageAt').reverse().toArray().then((chats) => set({ chats }));
    });

    peerManager.on('message-status', ({ id, status }: { id: string; status: Message['status'] }) => {
      get().updateMessageStatus(id, status);
    });

    peerManager.on('typing', ({ peerId, isTyping }: { peerId: string; isTyping: boolean }) => {
      get().setTyping(peerId, isTyping);
    });

    peerManager.on('connection-status', ({ peerId, status }: { peerId: string; status: any }) => {
      get().setConnectionStatus(peerId, status);
      if (status === 'connected') {
        db.chats.orderBy('lastMessageAt').reverse().toArray().then((chats) => set({ chats }));
      }
    });

    peerManager.on('contact-updated', async () => {
      const contacts = await db.contacts.orderBy('displayName').toArray();
      const chats = await db.chats.orderBy('lastMessageAt').reverse().toArray();
      set({ contacts, chats });
    });

    peerManager.on('contact-online', async () => {
      const contacts = await db.contacts.orderBy('displayName').toArray();
      set({ contacts });
    });

    peerManager.on('contact-offline', async () => {
      const contacts = await db.contacts.orderBy('displayName').toArray();
      set({ contacts });
    });

    peerManager.on('error', (err: any) => {
      set({ peerError: err.message || 'P2P error' });
    });
  },

  // Reload only contacts/chats without re-initing PeerJS
  reloadChatsAndContacts: async () => {
    const contacts = await db.contacts.orderBy('displayName').toArray();
    const chats = await db.chats.orderBy('lastMessageAt').reverse().toArray();
    set({ contacts, chats });
  },

  setActiveChat: (chatId) => {
    set({ activeChatId: chatId });
    if (chatId) {
      get().loadMessages(chatId);
      get().markChatRead(chatId);
      peerManager.connectTo(chatId);
    }
  },

  loadMessages: async (chatId) => {
    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    set((state) => ({ messages: { ...state.messages, [chatId]: msgs } }));
  },

  sendMessage: async (toPeerId, content, type = 'text', extra) => {
    const chat = await db.chats.get(toPeerId);

    // Group chat — send to all members
    if (chat?.type === 'group') {
      const identity = await db.identity.get('me');
      const memberIds = (chat.memberIds || []).filter((id) => id !== identity?.peerId);

      // Save message locally
      const message = {
        id: uuidv4(),
        chatId: toPeerId,
        senderId: identity!.peerId,
        type: (type || 'text') as any,
        content,
        ...extra,
        status: 'sent' as const,
        createdAt: Date.now(),
        encrypted: false,
      };
      await db.messages.put(message);
      await db.chats.update(toPeerId, {
        lastMessage: type === 'text' ? content.slice(0, 100) : `[${type}]`,
        lastMessageAt: message.createdAt,
        lastMessageType: type as any,
      });

      // Send to each member via P2P
      for (const memberId of memberIds) {
        try {
          await peerManager.sendMessage(memberId, content, type, {
            ...extra,
            replyToId: extra?.replyToId,
          });
        } catch {}
      }

      get().addMessage(message);
      const chats = await db.chats.orderBy('lastMessageAt').reverse().toArray();
      set({ chats });
      return;
    }

    // Direct chat
    const msg = await peerManager.sendMessage(toPeerId, content, type, extra);
    get().addMessage(msg);
    const chats = await db.chats.orderBy('lastMessageAt').reverse().toArray();
    set({ chats });
  },

  connectToPeer: (peerId) => peerManager.connectTo(peerId),

  addContactByPeerId: (peerId) => peerManager.connectTo(peerId),

  updateContact: (contact) => {
    set((state) => ({
      contacts: state.contacts.map((c) => (c.id === contact.id ? contact : c)),
    }));
  },

  addMessage: (message) => {
    set((state) => {
      const existing = state.messages[message.chatId] || [];
      if (existing.find((m) => m.id === message.id)) {
        return {
          messages: {
            ...state.messages,
            [message.chatId]: existing.map((m) => m.id === message.id ? message : m),
          },
        };
      }
      return {
        messages: {
          ...state.messages,
          [message.chatId]: [...existing, message],
        },
      };
    });
  },

  updateMessageStatus: (id, status) => {
    set((state) => {
      const newMessages = { ...state.messages };
      for (const chatId in newMessages) {
        newMessages[chatId] = newMessages[chatId].map((m) =>
          m.id === id ? { ...m, status } : m
        );
      }
      return { messages: newMessages };
    });
  },

  setTyping: (peerId, isTyping) => {
    set((state) => ({ typingPeers: { ...state.typingPeers, [peerId]: isTyping } }));
    if (isTyping) {
      setTimeout(() => {
        set((state) => ({ typingPeers: { ...state.typingPeers, [peerId]: false } }));
      }, 3000);
    }
  },

  setConnectionStatus: (peerId, status) => {
    set((state) => ({
      connectionStatuses: { ...state.connectionStatuses, [peerId]: status },
    }));
  },

  setPeerReady: (ready) => set({ peerReady: ready }),
  setPeerError: (err) => set({ peerError: err }),

  markChatRead: async (chatId) => {
    await db.chats.update(chatId, { unreadCount: 0 });
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)),
    }));
  },
}));
