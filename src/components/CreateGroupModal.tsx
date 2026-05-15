import React, { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../store/appStore';
import { db } from '../db/database';
import Avatar from './Avatar';
import { IoClose, IoCamera, IoCheckmark, IoSearch } from 'react-icons/io5';

interface Props { onClose: () => void; }

export default function CreateGroupModal({ onClose }: Props) {
  const { identity, contacts, reloadChatsAndContacts, setActiveChat } = useAppStore();
  const [step, setStep] = useState<'members' | 'details'>('members');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = contacts.filter((c) =>
    c.displayName.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setAvatar(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selected.length === 0) return;
    setCreating(true);
    try {
      const groupId = `grp-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      const memberIds = [identity!.peerId, ...selected];

      await db.chats.put({
        id: groupId,
        type: 'group',
        name: groupName.trim(),
        avatar,
        memberIds,
        unreadCount: 0,
        createdAt: Date.now(),
      });

      // Add system message
      await db.messages.put({
        id: uuidv4(),
        chatId: groupId,
        senderId: identity!.peerId,
        type: 'system',
        content: `Group "${groupName.trim()}" created`,
        status: 'sent',
        createdAt: Date.now(),
      });

      await reloadChatsAndContacts();
      setActiveChat(groupId);
      onClose();
    } finally { setCreating(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button className="icon-btn" onClick={step === 'details' ? () => setStep('members') : onClose}>
            <IoClose />
          </button>
          <h2>{step === 'members' ? 'Add Members' : 'New Group'}</h2>
          {step === 'members' && selected.length > 0 && (
            <button className="btn btn-sm" onClick={() => setStep('details')}>Next →</button>
          )}
          {step === 'details' && (
            <button className="btn btn-sm" onClick={handleCreate} disabled={creating || !groupName.trim()}>
              {creating ? '...' : 'Create'}
            </button>
          )}
        </div>

        {step === 'members' && (
          <>
            {/* Selected chips */}
            {selected.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                {selected.map((id) => {
                  const c = contacts.find((x) => x.id === id);
                  return (
                    <div key={id} onClick={() => toggle(id)} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'rgba(108,99,255,0.2)', border: '1px solid rgba(108,99,255,0.3)',
                      borderRadius: 16, padding: '3px 10px 3px 4px', fontSize: 13, cursor: 'pointer',
                    }}>
                      <Avatar src={c?.avatar} name={c?.displayName || id} size={22} />
                      <span>{c?.displayName || id.slice(0, 10)}</span>
                      <IoClose size={12} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
              <IoSearch style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', width: 15, height: 15 }} />
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Search contacts..."
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>

            {/* Contact list */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 320 }}>
              {filtered.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  No contacts found
                </div>
              )}
              {filtered.map((c) => {
                const isSel = selected.includes(c.id);
                return (
                  <div key={c.id} onClick={() => toggle(c.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    cursor: 'pointer', transition: 'background 0.12s',
                    background: isSel ? 'rgba(108,99,255,0.1)' : 'transparent',
                  }}
                    onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg3)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isSel ? 'rgba(108,99,255,0.1)' : 'transparent'; }}
                  >
                    <Avatar src={c.avatar} name={c.displayName} size={44} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.displayName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.id.slice(0, 20)}…</div>
                    </div>
                    {isSel && <IoCheckmark style={{ color: 'var(--accent3)', width: 20, height: 20 }} />}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 'details' && (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
            {/* Avatar */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
                {avatar ? (
                  <img src={avatar} alt="group" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
                ) : (
                  <div style={{
                    width: 80, height: 80, borderRadius: '50%', background: 'var(--bg3)',
                    border: '2px dashed var(--border)', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--text3)', fontSize: 11,
                  }}>
                    <IoCamera size={24} /><span>Add photo</span>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
              </div>
            </div>

            <div className="field">
              <label>Group Name</label>
              <input className="input" placeholder="Enter group name" value={groupName}
                onChange={(e) => setGroupName(e.target.value)} autoFocus />
            </div>

            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {selected.length} member{selected.length !== 1 ? 's' : ''} selected
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {selected.map((id) => {
                const c = contacts.find((x) => x.id === id);
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar src={c?.avatar} name={c?.displayName || id} size={34} />
                    <span style={{ fontSize: 13 }}>{c?.displayName || id.slice(0, 16)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
