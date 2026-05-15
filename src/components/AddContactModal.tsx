import React, { useState, useRef, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { useAppStore } from '../store/appStore';
import { db } from '../db/database';
import { peerManager } from '../p2p/peerManager';
import { IoClose, IoCopy, IoScan, IoCheckmark, IoPersonAdd } from 'react-icons/io5';

interface Props { onClose: () => void; }

export default function AddContactModal({ onClose }: Props) {
  const { identity, setActiveChat, reloadChatsAndContacts } = useAppStore();
  const [tab, setTab] = useState<'share' | 'add'>('share');
  const [inputPeerId, setInputPeerId] = useState('');
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [scanSuccess, setScanSuccess] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scanningRef = useRef(false);

  const myPeerId = identity?.peerId || '';

  const copyId = async () => {
    try { await navigator.clipboard.writeText(myPeerId); }
    catch {
      const el = document.createElement('textarea');
      el.value = myPeerId; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // ── Add contact by ID ─────────────────────────────────────────────────────
  const doAdd = async (id: string) => {
    id = id.trim();
    setAddError('');
    if (!id) { setAddError('Please enter a Peer ID'); return false; }
    if (id === myPeerId) { setAddError("That's your own Peer ID"); return false; }

    setAdding(true);
    try {
      if (!await db.chats.get(id)) {
        await db.chats.put({ id, type: 'direct', unreadCount: 0, createdAt: Date.now() });
      }
      if (!await db.contacts.get(id)) {
        await db.contacts.put({
          id, displayName: id.slice(0, 18) + '…',
          publicKey: '', addedAt: Date.now(), online: false,
        });
      }
      await reloadChatsAndContacts();
      peerManager.connectTo(id);
      setActiveChat(id);
      onClose();
      return true;
    } catch (err: any) {
      setAddError(err.message || 'Failed to add contact');
      return false;
    } finally { setAdding(false); }
  };

  const handleAdd = () => doAdd(inputPeerId);

  // ── QR scan ───────────────────────────────────────────────────────────────
  const scanFrame = useCallback(() => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA || video.videoWidth === 0) {
      rafRef.current = requestAnimationFrame(scanFrame); return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(scanFrame); return; }
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code?.data) {
      stopScan();
      setScanSuccess(`QR scanned: ${code.data.slice(0, 24)}…`);
      // Auto-add immediately after scan
      doAdd(code.data);
    } else {
      rafRef.current = requestAnimationFrame(scanFrame);
    }
  }, []);

  const startScan = async () => {
    setScanError(''); setScanSuccess('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      setScanning(true);
      scanningRef.current = true;
      // Give React time to render <video>, then attach
      setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          v.play().then(() => { rafRef.current = requestAnimationFrame(scanFrame); });
        };
        // Fallback if onloadedmetadata already fired
        if (v.readyState >= 1) {
          v.play().then(() => { rafRef.current = requestAnimationFrame(scanFrame); });
        }
      }, 80);
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError' ? 'Camera permission denied — allow it in browser settings.'
        : err.name === 'NotFoundError' ? 'No camera found on this device.'
        : 'Camera error: ' + err.message;
      setScanError(msg);
    }
  };

  const stopScan = () => {
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => { scanningRef.current = false; cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Contact</h2>
          <button className="icon-btn" onClick={onClose}><IoClose /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {(['share', 'add'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); if (t !== 'add') stopScan(); }}
              style={{ flex: 1, padding: '12px', fontSize: 13, fontWeight: 600, background: 'none', cursor: 'pointer',
                color: tab === t ? 'var(--accent3)' : 'var(--text2)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.2s' }}>
              {t === 'share' ? '📤 My ID / QR' : '➕ Add Contact'}
            </button>
          ))}
        </div>

        <div className="modal-body">

          {/* ── SHARE ── */}
          {tab === 'share' && (
            <>
              <div className="info-box">Share your <strong>Peer ID</strong> or <strong>QR code</strong> — the other person scans or pastes it to add you.</div>
              <div className="field">
                <label>Your Peer ID</label>
                <div className="peer-id-display" onClick={copyId} title="Click to copy">{myPeerId}</div>
                <button className="btn btn-sm" onClick={copyId} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                  {copied ? <><IoCheckmark /> Copied!</> : <><IoCopy /> Copy ID</>}
                </button>
              </div>
              <div className="qr-section">
                <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>QR Code</label>
                <div className="qr-wrap">
                  <QRCodeSVG value={myPeerId || 'loading'} size={200} bgColor="#ffffff" fgColor="#0F0E17" level="M" />
                </div>
                <span className="copy-hint">Others scan this to add you instantly</span>
              </div>
            </>
          )}

          {/* ── ADD ── */}
          {tab === 'add' && (
            <>
              <div className="info-box">Paste a <strong>Peer ID</strong> or scan their <strong>QR code</strong> with your camera.</div>

              <div className="field">
                <label>Peer ID</label>
                <input className="input" placeholder="p2p-xxxxxxxxxxxxxxxxxxxxxxxx"
                  value={inputPeerId} onChange={(e) => { setInputPeerId(e.target.value); setAddError(''); }}
                  autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
                {addError && <span style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{addError}</span>}
              </div>

              <button className="btn" onClick={handleAdd} disabled={adding || !inputPeerId.trim()}>
                <IoPersonAdd /> {adding ? 'Connecting…' : 'Add & Open Chat'}
              </button>

              <div className="divider">or scan QR code</div>

              {/* Camera area — always rendered when scanning so ref is available */}
              <div className="scan-area">
                {!scanning ? (
                  <>
                    <button className="btn btn-ghost" onClick={startScan}><IoScan /> Open Camera</button>
                    {scanError && <div style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center', lineHeight: 1.5, maxWidth: 300 }}>{scanError}</div>}
                    {scanSuccess && <div style={{ color: 'var(--green)', fontSize: 13, textAlign: 'center' }}>{scanSuccess}</div>}
                  </>
                ) : (
                  <>
                    <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
                      <video ref={videoRef} playsInline muted
                        style={{ width: '100%', borderRadius: 12, border: '2px solid var(--accent)', display: 'block', background: '#000', minHeight: 220 }} />
                      {/* Viewfinder overlay */}
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 170, height: 170, position: 'relative' }}>
                          {/* Corner brackets */}
                          {[['0','0','right','bottom'],['0','auto','right','bottom'],['auto','0','right','bottom'],['auto','auto','right','bottom']].map((_,i) => (
                            <div key={i} style={{
                              position: 'absolute',
                              top: i < 2 ? 0 : 'auto', bottom: i >= 2 ? 0 : 'auto',
                              left: i % 2 === 0 ? 0 : 'auto', right: i % 2 === 1 ? 0 : 'auto',
                              width: 24, height: 24,
                              borderTop: i < 2 ? '3px solid var(--accent)' : 'none',
                              borderBottom: i >= 2 ? '3px solid var(--accent)' : 'none',
                              borderLeft: i % 2 === 0 ? '3px solid var(--accent)' : 'none',
                              borderRight: i % 2 === 1 ? '3px solid var(--accent)' : 'none',
                            }} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>Point camera at QR code — adds automatically</p>
                    <button className="btn btn-ghost btn-sm" onClick={stopScan}><IoClose /> Cancel</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
