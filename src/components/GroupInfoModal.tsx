import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { db } from '../db/database';
import Avatar from './Avatar';
import AddContactModal from './AddContactModal';
import {
  IoClose, IoPencil, IoCheckmark, IoCamera, IoPersonAdd,
  IoTrash, IoExitOutline,
} from 'react-icons/io5';

interface Props { chatId: string; onClose: () => void; }

export default function GroupInfoModal({ chatId, onClose }: Props) {
  const { identity, contacts, chats, reloadChatsAndContacts, setActiveChat } = useAppStore();
  const chat = chats.find((c) => c.id === chatId);
  const memberIds = chat?.memberIds || [];
  const isAdmin = memberIds[0] === identity?.peerId; // first member = creator = admin

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(chat?.name || '');
  const [editAvatar, setEditAvatar] = useState<string | undefined>(chat?.avatar);
  const [saving, setSaving] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addPeerId, setAddPeerId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const members = memberIds.map((id) => {
    if (id === identity?.peerId) return { id, displayName: identity.displayName, avatar: identity.avatar, isMe: true };
    const c = contacts.find((x) => x.id === id);
    return { id, displayName: c?.displayName || id.slice(0, 16) + '…', avatar: c?.avatar, isMe: false };
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.chats.update(chatId, { name: editName.trim() || chat?.name, avatar: editAvatar });
      await reloadChatsAndContacts();
      setEditing(false);
    } finally { setSaving(false); }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setEditAvatar(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const handleAddMember = async () => {
    const id = addPeerId.trim();
    if (!id || memberIds.includes(id)) return;
    const newIds = [...memberIds, id];
    await db.chats.update(chatId, { memberIds: newIds });
    await reloadChatsAndContacts();
    setAddPeerId('');
    setShowAddMember(false);
  };

  const handleRemoveMember = async (id: string) => {
    if (!confirm(`Remove this member?`)) return;
    const newIds = memberIds.filter((x) => x !== id);
    await db.chats.update(chatId, { memberIds: newIds });
    await reloadChatsAndContacts();
  };

  const handleLeave = async () => {
    if (!confirm('Leave this group?')) return;
    const newIds = memberIds.filter((x) => x !== identity?.peerId);
    if (newIds.length === 0) {
      await db.chats.delete(chatId);
      await db.messages.where('chatId').equals(chatId).delete();
    } else {
      await db.chats.update(chatId, { memberIds: newIds });
    }
    await reloadChatsAndContacts();
    setActiveChat(null);
    onClose();
  };

  const handleDeleteGroup = async () => {
    if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
    await db.chats.delete(chatId);
    await db.messages.where('chatId').equals(chatId).delete();
    await reloadChatsAndContacts();
    setActiveChat(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button className="icon-btn" onClick={onClose}><IoClose /></button>
          <h2>Group Info</h2>
          {isAdmin && !editing && (
            <button className="icon-btn" onClick={() => setEditing(true)} title="Edit"><IoPencil /></button>
          )}
          {editing && (
            <button className="icon-btn" onClick={handleSave} style={{ color: 'var(--accent3)' }}>
              {saving ? '…' : <IoCheckmark />}
            </button>
          )}
        </div>

        <div className="modal-body">
          {/* Avatar + name */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {editing ? (
              <>
                <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
                  {editAvatar ? (
                    <img src={editAvatar} alt="group" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
                  ) : (
                    <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--bg3)', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IoCamera size={28} style={{ color: 'var(--text3)' }} />
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
                </div>
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  placeholder="Group name" style={{ textAlign: 'center', maxWidth: 260 }} autoFocus />
              </>
            ) : (
              <>
                <Avatar src={chat?.avatar} name={chat?.name || 'Group'} size={80} />
                <div style={{ fontSize: 20, fontWeight: 800 }}>{chat?.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>{memberIds.length} members</div>
              </>
            )}
          </div>

          {/* Members */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
              Members
            </div>

            {isAdmin && (
              <>
                {!showAddMember ? (
                  <button onClick={() => setShowAddMember(true)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                    color: 'var(--accent3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, width: '100%',
                  }}>
                    <IoPersonAdd size={18} /> Add Member
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input className="input" placeholder="Paste Peer ID..." value={addPeerId}
                      onChange={(e) => setAddPeerId(e.target.value)} autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddMember(); }} />
                    <button className="btn btn-sm" onClick={handleAddMember} disabled={!addPeerId.trim()}>Add</button>
                    <button className="icon-btn" onClick={() => { setShowAddMember(false); setAddPeerId(''); }}><IoClose /></button>
                  </div>
                )}
              </>
            )}

            {members.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <Avatar src={m.avatar} name={m.displayName} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {m.displayName}{m.isMe ? ' (you)' : ''}
                  </div>
                  {m.id === memberIds[0] && (
                    <div style={{ fontSize: 11, color: 'var(--accent3)' }}>Admin</div>
                  )}
                </div>
                {isAdmin && !m.isMe && (
                  <button className="icon-btn" onClick={() => handleRemoveMember(m.id)}
                    style={{ color: 'var(--red)' }} title="Remove">
                    <IoTrash size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            <button onClick={handleLeave} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0',
              color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
            }}>
              <IoExitOutline size={18} /> Leave Group
            </button>
            {isAdmin && (
              <button onClick={handleDeleteGroup} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0',
                color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
              }}>
                <IoTrash size={18} /> Delete Group
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
