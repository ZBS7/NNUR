import { useEffect } from 'react';
import { peerManager } from '../p2p/peerManager';
import { useAppStore } from '../store/appStore';
import { Message } from '../db/database';

export function useNotifications() {
  const { contacts, activeChatId } = useAppStore();

  useEffect(() => {
    // Request permission on first use
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const showNotif = (title: string, body: string, icon?: string) => {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible') return; // don't show if app is focused

      try {
        const n = new Notification(title, {
          body,
          icon: icon || '/icon.png',
          badge: '/icon.png',
          silent: false,
        });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 5000);
      } catch {}
    };

    const onMessage = (msg: Message) => {
      // Don't notify for own messages or if chat is open
      if (msg.senderId === peerManager.getMyPeerId()) return;
      if (activeChatId === msg.chatId) return;

      const contact = contacts.find((c) => c.id === msg.senderId);
      const name = contact?.displayName || 'Someone';
      const preview = msg.type === 'text'
        ? (msg.content?.slice(0, 60) || '')
        : msg.type === 'audio' ? '🎙 Voice message'
        : msg.type === 'image' ? '🖼 Photo'
        : msg.type === 'video' ? '🎥 Video'
        : '📎 File';

      showNotif(`NUR — ${name}`, preview, contact?.avatar);
    };

    const onIncomingCall = ({ peerId, callType }: { peerId: string; callType: string }) => {
      const contact = contacts.find((c) => c.id === peerId);
      const name = contact?.displayName || 'Someone';
      showNotif('NUR — Incoming Call', `${name} is calling you (${callType})`, contact?.avatar);
    };

    peerManager.on('new-message', onMessage);
    peerManager.on('incoming-call', onIncomingCall);
    return () => {
      peerManager.off('new-message', onMessage);
      peerManager.off('incoming-call', onIncomingCall);
    };
  }, [contacts, activeChatId]);
}
