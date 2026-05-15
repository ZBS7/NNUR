import React, { useEffect, useRef, useState } from 'react';
import { MediaConnection } from 'peerjs';
import { peerManager } from '../p2p/peerManager';
import Avatar from './Avatar';
import { IoCall, IoVideocam, IoVideocamOff, IoMic, IoMicOff, IoClose } from 'react-icons/io5';

export interface IncomingCallInfo {
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  callType: 'audio' | 'video';
  call: MediaConnection;
}

interface Props {
  incoming?: IncomingCallInfo | null;
  outgoing?: { peerId: string; peerName: string; peerAvatar?: string; callType: 'audio' | 'video' } | null;
  onEnd: () => void;
}

// ── Ringtone via Web Audio API ────────────────────────────────────────────────
function makeRingtone() {
  let ctx: AudioContext | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const beep = () => {
    if (stopped) return;
    try {
      ctx = new AudioContext();
      const g = ctx.createGain(); g.gain.value = 0.15; g.connect(ctx.destination);
      const freqs = [880, 1100, 880, 1100];
      freqs.forEach((f, i) => {
        const o = ctx!.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.connect(g);
        const t = ctx!.currentTime + i * 0.18;
        o.start(t); o.stop(t + 0.15);
      });
    } catch {}
  };

  return {
    start() { stopped = false; beep(); interval = setInterval(beep, 2200); },
    stop() { stopped = true; if (interval) clearInterval(interval); try { ctx?.close(); } catch {} },
  };
}

// ── Outgoing dial tone ────────────────────────────────────────────────────────
function makeDialTone() {
  let ctx: AudioContext | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const beep = () => {
    if (stopped) return;
    try {
      ctx = new AudioContext();
      const g = ctx.createGain(); g.gain.value = 0.08; g.connect(ctx.destination);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 440;
      o.connect(g); o.start(); o.stop(ctx.currentTime + 0.4);
    } catch {}
  };

  return {
    start() { stopped = false; beep(); interval = setInterval(beep, 1500); },
    stop() { stopped = true; if (interval) clearInterval(interval); try { ctx?.close(); } catch {} },
  };
}

export default function CallScreen({ incoming, outgoing, onEnd }: Props) {
  const [phase, setPhase] = useState<'ringing' | 'active' | 'connecting'>('ringing');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<ReturnType<typeof makeRingtone> | null>(null);
  const dialRef = useRef<ReturnType<typeof makeDialTone> | null>(null);

  const info = incoming || outgoing;
  const isVideo = info?.callType === 'video';
  const isIncoming = !!incoming;

  // ── Ringtone / dial tone ──────────────────────────────────────────────────
  useEffect(() => {
    if (isIncoming && phase === 'ringing') {
      ringtoneRef.current = makeRingtone();
      ringtoneRef.current.start();
    } else if (!isIncoming && phase === 'ringing') {
      dialRef.current = makeDialTone();
      dialRef.current.start();
      // Auto-start outgoing call
      startOutgoing();
    }
    return () => { ringtoneRef.current?.stop(); dialRef.current?.stop(); };
  }, []);

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'active') {
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // ── Listen for remote call end ────────────────────────────────────────────
  useEffect(() => {
    const onEnded = () => { cleanup(); onEnd(); };
    const onRejected = () => { cleanup(); onEnd(); };
    peerManager.on('call-ended', onEnded);
    peerManager.on('call-rejected', onRejected);
    return () => { peerManager.off('call-ended', onEnded); peerManager.off('call-rejected', onRejected); };
  }, []);

  // ── Listen for remote stream ──────────────────────────────────────────────
  useEffect(() => {
    const onStream = ({ stream }: { peerId: string; stream: MediaStream }) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
    };
    peerManager.on('call-stream', onStream);
    return () => peerManager.off('call-stream', onStream);
  }, []);

  const cleanup = () => {
    ringtoneRef.current?.stop();
    dialRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const attachLocalStream = (stream: MediaStream) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
    }
  };

  // ── Start outgoing call ───────────────────────────────────────────────────
  const startOutgoing = async () => {
    if (!outgoing) return;
    setPhase('connecting');
    dialRef.current?.stop();
    try {
      const localStream = await peerManager.startCall(outgoing.peerId, outgoing.callType);
      attachLocalStream(localStream);
      setPhase('active');
    } catch (err) {
      console.error('Call failed:', err);
      cleanup(); onEnd();
    }
  };

  // ── Accept incoming call ──────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!incoming) return;
    ringtoneRef.current?.stop();
    setPhase('connecting');
    try {
      const { localStream, remoteStream } = await peerManager.answerCall(incoming.call, incoming.callType);
      attachLocalStream(localStream);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      setPhase('active');
    } catch (err) {
      console.error('Answer failed:', err);
      cleanup(); onEnd();
    }
  };

  // ── Reject ────────────────────────────────────────────────────────────────
  const handleReject = () => {
    if (incoming) peerManager.rejectCall(incoming.peerId);
    cleanup(); onEnd();
  };

  // ── End active call ───────────────────────────────────────────────────────
  const handleEnd = () => {
    const peerId = info?.peerId;
    if (peerId) peerManager.endCall(peerId);
    cleanup(); onEnd();
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: isVideo && phase === 'active'
        ? '#000'
        : 'linear-gradient(160deg, #1A0A3C 0%, #0F0E17 50%, #1A1825 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Remote video */}
      {isVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: phase === 'active' ? 'block' : 'none' }} />
      )}

      {/* Local video PiP */}
      {isVideo && phase === 'active' && (
        <video ref={localVideoRef} autoPlay playsInline muted
          style={{ position: 'absolute', bottom: 120, right: 20, width: 110, height: 150, objectFit: 'cover', borderRadius: 12, border: '2px solid rgba(255,255,255,0.3)', zIndex: 1 }} />
      )}

      {/* Center info */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, zIndex: 1, marginBottom: 48 }}>
        {/* Pulsing ring for ringing state */}
        <div style={{
          borderRadius: '50%', padding: 6,
          boxShadow: phase === 'ringing' ? '0 0 0 12px rgba(108,99,255,0.15), 0 0 0 24px rgba(108,99,255,0.07)' : 'none',
          animation: phase === 'ringing' ? 'nurRing 2s infinite' : 'none',
        }}>
          <Avatar src={info?.peerAvatar} name={info?.peerName || '?'} size={100} />
        </div>

        <style>{`@keyframes nurRing { 0%,100% { box-shadow: 0 0 0 12px rgba(108,99,255,0.15), 0 0 0 24px rgba(108,99,255,0.07); } 50% { box-shadow: 0 0 0 18px rgba(108,99,255,0.1), 0 0 0 36px rgba(108,99,255,0.04); } }`}</style>

        <span style={{ fontSize: 26, fontWeight: 800, color: 'white' }}>{info?.peerName}</span>
        <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)' }}>
          {phase === 'ringing' && isIncoming && `Incoming ${isVideo ? 'video' : 'audio'} call`}
          {phase === 'ringing' && !isIncoming && 'Calling…'}
          {phase === 'connecting' && 'Connecting…'}
          {phase === 'active' && fmtTime(seconds)}
        </span>
      </div>

      {/* ── INCOMING RINGING: Accept / Reject ── */}
      {isIncoming && phase === 'ringing' && (
        <div style={{ display: 'flex', gap: 48, zIndex: 1 }}>
          <CallBtn color="#FF4444" icon={<IoClose size={28} />} label="Decline" onClick={handleReject} />
          <CallBtn color="#22C55E" icon={isVideo ? <IoVideocam size={28} /> : <IoCall size={28} />} label="Accept" onClick={handleAccept} size={72} />
        </div>
      )}

      {/* ── ACTIVE / OUTGOING: Controls ── */}
      {(phase === 'active' || phase === 'connecting') && (
        <div style={{ display: 'flex', gap: 24, zIndex: 1 }}>
          <CallBtn
            color={muted ? '#FF4444' : 'rgba(255,255,255,0.15)'}
            icon={muted ? <IoMicOff size={22} /> : <IoMic size={22} />}
            label={muted ? 'Unmute' : 'Mute'}
            onClick={() => { peerManager.toggleMute(!muted); setMuted(!muted); }}
          />
          {isVideo && (
            <CallBtn
              color={cameraOff ? '#FF4444' : 'rgba(255,255,255,0.15)'}
              icon={cameraOff ? <IoVideocamOff size={22} /> : <IoVideocam size={22} />}
              label={cameraOff ? 'Cam on' : 'Cam off'}
              onClick={() => { peerManager.toggleCamera(!cameraOff); setCameraOff(!cameraOff); }}
            />
          )}
          <CallBtn color="#FF4444" icon={<IoCall size={22} style={{ transform: 'rotate(135deg)' }} />} label="End" onClick={handleEnd} size={64} />
        </div>
      )}
    </div>
  );
}

function CallBtn({ color, icon, label, onClick, size = 56 }: { color: string; icon: React.ReactNode; label: string; onClick: () => void; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button onClick={onClick} style={{
        width: size, height: size, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: `0 4px 20px ${color}66`,
      }}>
        {icon}
      </button>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{label}</span>
    </div>
  );
}
