import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { IoCamera, IoLockClosed } from 'react-icons/io5';

export default function SetupPage() {
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { initIdentity } = useAppStore();

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      await initIdentity(displayName.trim(), avatar);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-logo">
          <div className="setup-logo-icon">🔒</div>
        </div>
        <h1 className="setup-title">NUR Messenger</h1>
        <p className="setup-sub">
          Fully decentralized. End-to-end encrypted.<br />
          No servers store your messages — ever.
        </p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <div className="setup-avatar-row">
            <div className="avatar-pick" onClick={() => fileRef.current?.click()}>
              {avatar
                ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <><IoCamera size={24} /><span>Add photo</span></>
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
          </div>

          <div className="field">
            <label>Your Name</label>
            <input
              className="input"
              type="text"
              placeholder="Enter your display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <button className="btn" type="submit" disabled={loading || !displayName.trim()}>
            {loading ? 'Setting up...' : 'Get Started'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
            <IoLockClosed size={12} />
            Your keys are generated locally and never leave your device
          </div>
        </form>
      </div>
    </div>
  );
}
