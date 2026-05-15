import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import Avatar from './Avatar';
import AddContactModal from './AddContactModal';
import ProfileModal from './ProfileModal';
import { IoAdd, IoSearch, IoSettingsOutline, IoRefresh } from 'react-icons/io5';

function fmtTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar() {
  const { identity, contacts, chats, activeChatId, setActiveChat, connectionStatuses, peerReady, peerError } = useAppStore();
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const filteredChats = chats.filter((ch) => {
    const contact = contacts.find((c) => c.id === ch.id);
    const name = contact?.displayName || ch.name || ch.id;
    return name.toLowerCase().includes(filter.toLowerCase());
  });

  const getPreview = (ch: typeof chats[0]) => {
    if (!ch.lastMessage) return 'No messages yet';
    if (ch.lastMessageType && ch.lastMessageType !== 'text') {
      const icons: Record<string, string> = { image: '🖼 Photo', video: '🎥 Video', audio: '🎙 Voice', file: '📎 File' };
      return icons[ch.lastMessageType] || ch.lastMessageType;
    }
    return ch.lastMessage;
  };

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">NUR</span>
        <button className="icon-btn" onClick={() => setShowAdd(true)} title="Add contact">
          <IoAdd />
        </button>
      </div>

      {/* P2P status */}
      <div className="peer-status-bar" style={{ cursor: 'pointer' }} onClick={() => {
        const id = identity?.peerId || 'unknown';
        alert(`Your Peer ID:\n${id}\n\nStatus: ${peerError ? 'ERROR: ' + peerError : peerReady ? 'Connected to signaling server' : 'Connecting...'}\n\nIf contacts show offline outside local network, the issue is NAT traversal. Check browser console for ICE errors.`);
      }}>
        <div className={`peer-status-dot ${peerError ? 'error' : peerReady ? 'ready' : 'connecting'}`} />
        <span style={{ color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {peerError
            ? `Error — tap for info`
            : peerReady
            ? `Connected · ${identity?.peerId?.slice(0, 14)}…`
            : 'Connecting…'}
        </span>
        {peerError && (
          <button
            onClick={(e) => { e.stopPropagation(); window.location.reload(); }}
            style={{ fontSize: 11, color: 'var(--accent3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <IoRefresh size={12} /> Retry
          </button>
        )}
      </div>

      {/* Search */}
      <div className="sidebar-search-wrap">
        <div className="search-wrap">
          <IoSearch />
          <input
            className="sidebar-search"
            placeholder="Search chats..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="chat-list">
        {filteredChats.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>No chats yet.<br />Add a contact to start chatting.</p>
            <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setShowAdd(true)}>
              <IoAdd /> Add Contact
            </button>
          </div>
        )}

        {filteredChats.map((ch) => {
          const contact = contacts.find((c) => c.id === ch.id);
          const name = contact?.displayName || ch.name || ch.id;
          const status = connectionStatuses[ch.id] || 'disconnected';

          return (
            <div
              key={ch.id}
              className={`chat-item ${activeChatId === ch.id ? 'active' : ''}`}
              onClick={() => setActiveChat(ch.id)}
            >
              <Avatar
                src={contact?.avatar}
                name={name}
                size={46}
                online={status === 'connected'}
                connecting={status === 'connecting'}
              />
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

      {/* Footer — click to open settings */}
      <div className="sidebar-footer" onClick={() => setShowProfile(true)} title="Settings">
        <Avatar src={identity?.avatar} name={identity?.displayName || 'Me'} size={38} />
        <div className="sidebar-footer-info">
          <span className="sidebar-footer-name">{identity?.displayName}</span>
          <span className="sidebar-footer-id">{identity?.peerId}</span>
        </div>
        <button className="icon-btn" title="Settings" onClick={(e) => { e.stopPropagation(); setShowProfile(true); }}>
          <IoSettingsOutline />
        </button>
      </div>

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}
