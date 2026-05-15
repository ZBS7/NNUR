import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { db } from '../db/database';
import { IoClose, IoCamera, IoTrash, IoLogOut, IoKey, IoCopy, IoCheckmark } from 'react-icons/io5';

interface Props { onClose: () => void; }

export default function ProfileModal({ onClose }: Props) {
  const { identity, reloadChatsAndContacts } = useAppStore();
  const [displayName, setDisplayName] = useState(identity?.displayName || '');
  const [avatar, setAvatar] = useState<string | undefined>(identity?.avatar);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [tab, setTab] = useState<'profile' | 'security' | 'danger'>('profile');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await db.identity.update('me', {
        displayName: displayName.trim(),
        avatar,
      });
      await reloadChatsAndContacts();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const copyPeerId = async () => {
    await navigator.clipboard.writeText(identity?.peerId || '').catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const copyPublicKey = async () => {
    await navigator.clipboard.writeText(identity?.publicKey || '').catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleClearHistory = async () => {
    if (!confirm('Delete ALL message history? This cannot be undone.')) return;
    await db.messages.clear();
    await db.chats.toCollection().modify({ lastMessage: undefined, lastMessageAt: undefined, unreadCount: 0 });
    await reloadChatsAndContacts();
    alert('Message history cleared.');
  };

  const handleResetApp = async () => {
    if (!confirm('Reset everything? Your identity, contacts and messages will be deleted.')) return;
    await db.messages.clear();
    await db.chats.clear();
    await db.contacts.clear();
    await db.identity.clear();
    window.location.reload();
  };

  const tabStyle = (t: string) => ({
    flex: 1, padding: '11px', fontSize: 13, fontWeight: 600 as const,
    background: 'none', cursor: 'pointer' as const,
    color: tab === t ? 'var(--accent3)' : 'var(--text2)',
    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'all 0.2s',
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}><IoClose /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button style={tabStyle('profile')} onClick={() => setTab('profile')}>👤 Profile</button>
          <button style={tabStyle('security')} onClick={() => setTab('security')}>🔒 Security</button>
          <button style={tabStyle('danger')} onClick={() => setTab('danger')}>⚠️ Danger</button>
        </div>

        <div className="modal-body">

          {/* ── PROFILE ── */}
          {tab === 'profile' && (
            <>
              {/* Avatar */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div
                  style={{ position: 'relative', cursor: 'pointer', width: 90, height: 90 }}
                  onClick={() => fileRef.current?.click()}
                >
                  {avatar ? (
                    <img src={avatar} alt="avatar" style={{ width: 90, height: 90, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
                  ) : (
                    <div style={{
                      width: 90, height: 90, borderRadius: '50%', background: 'var(--bg3)',
                      border: '2px dashed var(--border)', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 32, fontWeight: 800, color: 'var(--accent3)',
                    }}>
                      {displayName.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s',
                  }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                  >
                    <IoCamera style={{ color: 'white', width: 24, height: 24 }} />
                  </div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
              </div>

              {avatar && (
                <button
                  onClick={() => setAvatar(undefined)}
                  style={{ alignSelf: 'center', fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <IoTrash size={13} /> Remove photo
                </button>
              )}

              <div className="field">
                <label>Display Name</label>
                <input
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  maxLength={50}
                />
              </div>

              <div className="field">
                <label>Your Peer ID</label>
                <div className="peer-id-display" onClick={copyPeerId} style={{ fontSize: 12 }}>
                  {identity?.peerId}
                </div>
              </div>

              <button className="btn" onClick={handleSave} disabled={saving || !displayName.trim()}>
                {saved ? <><IoCheckmark /> Saved!</> : saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}

          {/* ── SECURITY ── */}
          {tab === 'security' && (
            <>
              <div className="info-box">
                Your encryption keys are generated locally and <strong>never leave your device</strong>.
                All messages are end-to-end encrypted using ECDH P-256 + AES-GCM 256-bit.
              </div>

              <div className="field">
                <label>Your Peer ID</label>
                <div className="peer-id-display" onClick={copyPeerId} style={{ fontSize: 12, cursor: 'pointer' }}>
                  {identity?.peerId}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={copyPeerId} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  {copiedId ? <><IoCheckmark /> Copied!</> : <><IoCopy /> Copy Peer ID</>}
                </button>
              </div>

              <div className="field">
                <label>Your Public Key (ECDH P-256)</label>
                <div style={{
                  background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 14px', fontFamily: 'monospace', fontSize: 11,
                  color: 'var(--text2)', wordBreak: 'break-all', lineHeight: 1.6,
                }}>
                  {identity?.publicKey?.slice(0, 80)}...
                </div>
                <button className="btn btn-ghost btn-sm" onClick={copyPublicKey} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  {copiedKey ? <><IoCheckmark /> Copied!</> : <><IoKey /> Copy Public Key</>}
                </button>
              </div>

              <div style={{
                background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.2)',
                borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--green)', lineHeight: 1.6,
              }}>
                🔒 Your private key is stored only in your browser's IndexedDB and is never transmitted anywhere.
              </div>
            </>
          )}

          {/* ── DANGER ── */}
          {tab === 'danger' && (
            <>
              <div style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--red)', lineHeight: 1.6 }}>
                ⚠️ These actions are irreversible. Be careful.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Clear Message History</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                    Deletes all messages from your device. Contacts are kept.
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={handleClearHistory}>
                    <IoTrash /> Clear All Messages
                  </button>
                </div>

                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Reset App</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                    Deletes your identity, all contacts and messages. You'll start fresh.
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={handleResetApp}>
                    <IoLogOut /> Reset Everything
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
