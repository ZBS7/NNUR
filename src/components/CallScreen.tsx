import React, { useEffect, useRef, useState } from 'react';
import { MediaConnection } from 'peerjs';
import { peerManager } from '../p2p/peerManager';
import Avatar from './Avatar';
import {
  IoCall, IoVideocam, IoVideocamOff, IoMic, IoMicOff,
  IoClose, IoCameraReverse,
} from 'react-icons/io5';

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

// ── Ringtone ──────────────────────────────────────────────────────────────────
function makeRingtone() {
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const beep = () => {
    if (stopped) return;
    try {
      const ctx = new AudioContext();
      const g = ctx.createGain(); g.gain.value = 0.18; g.connect(ctx.destination);
      [[880, 0], [1100, 0.22], [880, 0.44], [1100, 0.66]].forEach(([f, t]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.connect(g); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {}
  };
  return {
    start() { stopped = false; beep(); interval = setInterval(beep, 2400); },
    stop() { stopped = true; if (interval) clearInterval(interval); },
  };
}

function makeDialTone() {
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const beep = () => {
    if (stopped) return;
    try {
      const ctx = new AudioContext();
      const g = ctx.createGain(); g.gain.value = 0.07; g.connect(ctx.destination);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 440;
      o.connect(g); o.start(); o.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 800);
    } catch {}
  };
  return {
    start() { stopped = false; beep(); interval = setInterval(beep, 1600); },
    stop() { stopped = true; if (interval) clearInterval(interval); },
  };
}

export default function CallScreen({ incoming, outgoing, onEnd }: Props) {
  const [phase, setPhase] = useState<'ringing' | 'connecting' | 'active'>('ringing');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [seconds, setSeconds] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null); // for audio-only calls
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<ReturnType<typeof makeRingtone> | null>(null);
  const dialRef = useRef<ReturnType<typeof makeDialTone> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const info = incoming || outgoing;
  const isVideo = info?.callType === 'video';
  const isIncoming = !!incoming;

  // ── Ringtone ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isIncoming) {
      ringtoneRef.current = makeRingtone();
      ringtoneRef.current.start();
    } else {
      dialRef.current = makeDialTone();
      dialRef.current.start();
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

  // ── Remote events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onEnded = () => { cleanup(); onEnd(); };
    const onRejected = () => { cleanup(); onEnd(); };
    const onStream = ({ stream }: { stream: MediaStream }) => {
      // Video call — attach to video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
      }
      // Audio call — attach to audio element (always, as fallback)
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
    };
    peerManager.on('call-ended', onEnded);
    peerManager.on('call-rejected', onRejected);
    peerManager.on('call-stream', onStream);
    return () => {
      peerManager.off('call-ended', onEnded);
      peerManager.off('call-rejected', onRejected);
      peerManager.off('call-stream', onStream);
    };
  }, []);

  const cleanup = () => {
    ringtoneRef.current?.stop();
    dialRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const attachLocal = (stream: MediaStream) => {
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
  };

  // ── Outgoing ──────────────────────────────────────────────────────────────
  const startOutgoing = async () => {
    if (!outgoing) return;
    setPhase('connecting');
    dialRef.current?.stop();
    try {
      const localStream = await peerManager.startCall(outgoing.peerId, outgoing.callType);
      attachLocal(localStream);
      setPhase('active');
    } catch (err) {
      console.error('Call failed:', err);
      cleanup(); onEnd();
    }
  };

  // ── Accept ────────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!incoming) return;
    ringtoneRef.current?.stop();
    setPhase('connecting');
    try {
      const { localStream, remoteStream } = await peerManager.answerCall(incoming.call, incoming.callType);
      attachLocal(localStream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => {});
      }
      setPhase('active');
    } catch (err) {
      console.error('Answer failed:', err);
      cleanup(); onEnd();
    }
  };

  const handleReject = () => {
    if (incoming) peerManager.rejectCall(incoming.peerId);
    cleanup(); onEnd();
  };

  const handleEnd = () => {
    if (info?.peerId) peerManager.endCall(info.peerId);
    cleanup(); onEnd();
  };

  const toggleMute = () => {
    peerManager.toggleMute(!muted);
    setMuted(!muted);
  };

  const toggleCamera = () => {
    peerManager.toggleCamera(!cameraOff);
    setCameraOff(!cameraOff);
  };

  // ── Flip camera ───────────────────────────────────────────────────────────
  const flipCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacing);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: newFacing },
      });
      // Replace video track in peer connection
      const videoTrack = newStream.getVideoTracks()[0];
      // @ts-ignore — access internal peer connection
      const pc = peerManager['activeCall']?.peerConnection as RTCPeerConnection | undefined;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(videoTrack);
      }
      // Stop old video tracks, keep audio
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      // Attach new stream to local preview
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      const combined = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);
      localStreamRef.current = combined;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = combined;
        localVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('Flip camera failed:', err);
    }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: isVideo && phase === 'active' ? '#000' : 'linear-gradient(160deg,#1A0A3C 0%,#0F0E17 50%,#1A1825 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Hidden audio element for audio-only calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Remote video — fullscreen */}
      {isVideo && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: phase === 'active' ? 'block' : 'none',
          }}
        />
      )}

      {/* Local video — picture-in-picture, bottom right */}
      {isVideo && (
        <video ref={localVideoRef} autoPlay playsInline muted
          style={{
            position: 'absolute', bottom: 130, right: 16,
            width: 100, height: 140, objectFit: 'cover',
            borderRadius: 12, border: '2px solid rgba(255,255,255,0.4)',
            zIndex: 10, display: phase === 'active' ? 'block' : 'none',
            background: '#111',
          }}
        />
      )}

      {/* Center info */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, zIndex: 1, marginBottom: 48 }}>
        <div style={{
          borderRadius: '50%', padding: 6,
          animation: phase === 'ringing' ? 'nurRing 2s infinite' : 'none',
        }}>
          <Avatar src={info?.peerAvatar} name={info?.peerName || '?'} size={100} />
        </div>
        <style>{`@keyframes nurRing{0%,100%{box-shadow:0 0 0 12px rgba(108,99,255,.15),0 0 0 24px rgba(108,99,255,.07)}50%{box-shadow:0 0 0 18px rgba(108,99,255,.1),0 0 0 36px rgba(108,99,255,.04)}}`}</style>
        <span style={{ fontSize: 26, fontWeight: 800, color: 'white' }}>{info?.peerName}</span>
        <span style={{ fontSize: 15, color: 'rgba(255,255,255,.55)' }}>
          {phase === 'ringing' && isIncoming && `Incoming ${isVideo ? 'video' : 'audio'} call`}
          {phase === 'ringing' && !isIncoming && 'Calling…'}
          {phase === 'connecting' && 'Connecting…'}
          {phase === 'active' && fmtTime(seconds)}
        </span>
      </div>

      {/* Incoming — Accept / Reject */}
      {isIncoming && phase === 'ringing' && (
        <div style={{ display: 'flex', gap: 48, zIndex: 1 }}>
          <CallBtn color="#FF4444" icon={<IoClose size={28} />} label="Decline" onClick={handleReject} />
          <CallBtn color="#22C55E" size={72}
            icon={isVideo ? <IoVideocam size={28} /> : <IoCall size={28} />}
            label="Accept" onClick={handleAccept} />
        </div>
      )}

      {/* Active / Outgoing controls */}
      {(phase === 'active' || (phase === 'connecting' && !isIncoming)) && (
        <div style={{ display: 'flex', gap: 20, zIndex: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <CallBtn
            color={muted ? '#FF4444' : 'rgba(255,255,255,.15)'}
            icon={muted ? <IoMicOff size={22} /> : <IoMic size={22} />}
            label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}
          />
          {isVideo && (
            <>
              <CallBtn
                color={cameraOff ? '#FF4444' : 'rgba(255,255,255,.15)'}
                icon={cameraOff ? <IoVideocamOff size={22} /> : <IoVideocam size={22} />}
                label={cameraOff ? 'Cam on' : 'Cam off'} onClick={toggleCamera}
              />
              <CallBtn
                color="rgba(255,255,255,.15)"
                icon={<IoCameraReverse size={22} />}
                label="Flip" onClick={flipCamera}
              />
            </>
          )}
          <CallBtn size={64} color="#FF4444"
            icon={<IoCall size={22} style={{ transform: 'rotate(135deg)' }} />}
            label="End" onClick={handleEnd}
          />
        </div>
      )}
    </div>
  );
}

function CallBtn({ color, icon, label, onClick, size = 56 }: {
  color: string; icon: React.ReactNode; label: string; onClick: () => void; size?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button onClick={onClick} style={{
        width: size, height: size, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: `0 4px 20px ${color}55`,
      }}>
        {icon}
      </button>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{label}</span>
    </div>
  );
}
