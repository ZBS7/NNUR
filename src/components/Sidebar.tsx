import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import Avatar from './Avatar';
import AddContactModal from './AddContactModal';
import ProfileModal from './ProfileModal';
import CreateGroupModal from './CreateGroupModal';
import { IoAdd, IoSearch, IoSettingsOutline, IoRefresh, IoPeople, IoPersonAdd } from 'react-icons/io5';

function fmtTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar() {
  const { identity, contacts, chats, activeChatId, setActiveChat, connectionStatuses, peerReady, peerError } = useAppStore();
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const filteredChats = chats.filter((ch) => {
    if (ch.type === 'group') return (ch.name || '').toLowerCase().includes(filter.toLowerCase());
    const contact = contacts.find((c) => c.id === ch.id);
    const name = contact?.displayName || ch.id;
    return name.toLowerCase().includes(filter.toLowerCase());
  });

  const getPreview = (ch: typeof chats[0]) => {
    if (!ch.lastMessage) return 'No messages yet';
    if (ch.lastMessageType && ch.lastMessageType !== 'text') {
      const icons: Record<string, string> = {
        image: '🖼 Photo', video: '🎥 Video', file: '📎 File', system: '•',
      };
      return icons[ch.lastMessageType] || ch.lastMessageType;
    }
    return ch.lastMessage;
  };

  const getChatName = (ch: typeof chats[0]) => {
    if (ch.type === 'group') return ch.name || 'Group';
    const contact = contacts.find((c) => c.id === ch.id);
    return contact?.displayName || ch.id.slice(0, 16) + '…';
  };

  const getChatAvatar = (ch: typeof chats[0]) => {
    if (ch.type === 'group') return ch.avatar;
    return contacts.find((c) => c.id === ch.id)?.avatar;
  };

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">NUR</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn" onClick={() => setShowCreateGroup(true)} title="New group">
            <IoPeople />
          </button>
          <button className="icon-btn" onClick={() => setShowAdd(true)} title="Add contact">
            <IoPersonAdd />
          </button>
        </div>
      </div>

      {/* P2P status */}
      <div className="peer-status-bar" style={{ cursor: 'pointer' }} onClick={() => {
        alert(`Peer ID:\n${identity?.peerId || 'unknown'}\n\nStatus: ${peerError ? 'ERROR: ' + peerError : peerReady ? 'Connected' : 'Connecting...'}`);
      }}>
        <div className={`peer-status-dot ${peerError ? 'error' : peerReady ? 'ready' : 'connecting'}`} />
        <span style={{ color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
          {peerError ? 'Connection error — tap for info'
            : peerReady ? `Connected · ${identity?.peerId?.slice(0, 14)}…`
            : 'Connecting…'}
        </span>
        {peerError && (
          <button onClick={(e) => { e.stopPropagation(); window.location.reload(); }}
            style={{ fontSize: 11, color: 'var(--accent3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
            <IoRefresh size={12} /> Retry
          </button>
        )}
      </div>

      {/* Search */}
      <div className="sidebar-search-wrap">
        <div className="search-wrap">
          <IoSearch />
          <input className="sidebar-search" placeholder="Search chats..."
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      {/* Chat list */}
      <div className="chat-list">
        {filteredChats.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>No chats yet.<br />Add a contact or create a group.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              <button className="btn btn-sm" onClick={() => setShowAdd(true)}>
                <IoPersonAdd /> Add Contact
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowCreateGroup(true)}>
                <IoPeople /> New Group
              </button>
            </div>
          </div>
        )}

        {filteredChats.map((ch) => {
          const name = getChatName(ch);
          const avatar = getChatAvatar(ch);
          const status = ch.type === 'group' ? 'connected' : (connectionStatuses[ch.id] || 'disconnected');
          const isGroup = ch.type === 'group';

          return (
            <div key={ch.id}
              className={`chat-item ${activeChatId === ch.id ? 'active' : ''}`}
              onClick={() => setActiveChat(ch.id)}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Avatar src={avatar} name={name} size={46}
                  online={!isGroup && status === 'connected'}
                  connecting={!isGroup && status === 'connecting'} />
                {isGroup && (
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1,
                    background: 'var(--accent)', borderRadius: '50%',
                    width: 16, height: 16, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', border: '2px solid var(--bg2)',
                  }}>
                    <IoPeople style={{ width: 8, height: 8, color: 'white' }} />
                  </div>
                )}
              </div>
              <div className="chat-item-info">
                <div className="chat-item-top">
                  <span className="chat-name">{name}</span>
                  <span className="chat-time">{fmtTime(ch.lastMessageAt)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="chat-preview" style={{ flex: 1 }}>{getPreview(ch)}</span>
                  {ch.unreadCount > 0 && <span className="unread-badge">{ch.unreadCount}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — profile button, always visible */}
      <div className="sidebar-footer" onClick={() => setShowProfile(true)} title="Settings & Profile">
        <Avatar src={identity?.avatar} name={identity?.displayName || 'Me'} size={38} />
        <div className="sidebar-footer-info">
          <span className="sidebar-footer-name">{identity?.displayName}</span>
          <span className="sidebar-footer-id">{identity?.peerId?.slice(0, 22)}…</span>
        </div>
        <button className="icon-btn" title="Settings"
          onClick={(e) => { e.stopPropagation(); setShowProfile(true); }}>
          <IoSettingsOutline />
        </button>
      </div>

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
    </div>
  );
}
