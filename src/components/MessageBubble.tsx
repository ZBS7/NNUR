import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message } from '../db/database';
import { db } from '../db/database';
import { useAppStore } from '../store/appStore';
import Avatar from './Avatar';
import { IoCheckmark, IoCheckmarkDone, IoPlay, IoPause, IoDownload, IoArrowUndo, IoCopy, IoTrash } from 'react-icons/io5';

interface Props {
  message: Message;
  isMe: boolean;
  showAvatar: boolean;
  contactName: string;
  contactAvatar?: string;
  allMessages: Message[];
  onReply: (msg: Message) => void;
}

const COLORS = ['#6C63FF','#FF6B9D','#F7B731','#26de81','#2BCBBA','#FC5C65','#45AAF2','#A55EEA'];

function waveform(seed: string, n = 28) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return Array.from({ length: n }, () => { h = (h * 1664525 + 1013904223) & 0xffffffff; return 18 + Math.abs(h % 64); });
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtSize(b?: number) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function fmtDur(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function fileIcon(name?: string) {
  const ext = name?.split('.').pop()?.toLowerCase() || '';
  const m: Record<string, string> = { pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', zip: '🗜️', rar: '🗜️', exe: '⚙️', mp3: '🎵', wav: '🎵', txt: '📝', js: '📜', ts: '📜', py: '🐍' };
  return m[ext] || '📄';
}

function AudioPlayer({ src, msgId }: { src: string; msgId: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(0);
  const ref = useRef<HTMLAudioElement>(null);
  const bars = waveform(msgId);
  const played = Math.floor((progress / 100) * bars.length);

  const toggle = () => {
    if (!ref.current) return;
    playing ? ref.current.pause() : ref.current.play();
    setPlaying(!playing);
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    ref.current.currentTime = ((e.clientX - r.left) / r.width) * ref.current.duration;
  };

  return (
    <div className="audio-player">
      <audio ref={ref} src={src}
        onTimeUpdate={() => ref.current && setProgress((ref.current.currentTime / ref.current.duration) * 100 || 0)}
        onLoadedMetadata={() => ref.current && setDur(ref.current.duration)}
        onEnded={() => setPlaying(false)}
      />
      <button className="audio-play" onClick={toggle}>{playing ? <IoPause /> : <IoPlay />}</button>
      <div className="audio-wave" onClick={seek}>
        <div className="wave-bars">
          {bars.map((h, i) => <div key={i} className={`wave-bar ${i < played ? 'played' : ''}`} style={{ height: `${h}%` }} />)}
        </div>
      </div>
      <span className="audio-dur">{fmtDur(dur)}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'sending') return <span className="bubble-status status-sending"><IoCheckmark /></span>;
  if (status === 'sent') return <span className="bubble-status status-sent"><IoCheckmark /></span>;
  if (status === 'delivered') return <span className="bubble-status status-delivered"><IoCheckmarkDone /></span>;
  if (status === 'read') return <span className="bubble-status status-read"><IoCheckmarkDone /></span>;
  if (status === 'failed') return <span className="bubble-status status-failed">!</span>;
  return null;
}

export { fmtDate };

export default function MessageBubble({ message, isMe, showAvatar, contactName, contactAvatar, allMessages, onReply }: Props) {
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const longRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef(0);
  const touchY = useRef(0);
  const [swipe, setSwipe] = useState(0);

  const replyMsg = message.replyToId ? allMessages.find((m) => m.id === message.replyToId) : null;

  useEffect(() => {
    if (!ctx) return;
    const h = () => setCtx(null);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [ctx]);

  const openCtx = useCallback((x: number, y: number) => {
    const mw = 180, mh = 180;
    setCtx({ x: Math.min(x, window.innerWidth - mw - 8), y: Math.min(y, window.innerHeight - mh - 8) });
  }, []);

  const onCtxMenu = (e: React.MouseEvent) => { e.preventDefault(); openCtx(e.clientX, e.clientY); };
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
    touchY.current = e.touches[0].clientY;
    longRef.current = setTimeout(() => openCtx(touchX.current, touchY.current), 500);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchX.current;
    const dy = Math.abs(e.touches[0].clientY - touchY.current);
    if (Math.abs(dx) > 8 || dy > 8) { if (longRef.current) clearTimeout(longRef.current); }
    if (dx > 0 && dy < 25) setSwipe(Math.min(dx, 65));
  };
  const onTouchEnd = () => {
    if (longRef.current) clearTimeout(longRef.current);
    if (swipe > 50) onReply(message);
    setSwipe(0);
  };

  const handleCopy = () => { if (message.content) navigator.clipboard.writeText(message.content); setCtx(null); };
  const handleDelete = async () => {
    setCtx(null);
    await db.messages.delete(message.id);
    useAppStore.getState().loadMessages(message.chatId);
  };

  const renderContent = () => {
    const isAudio = message.type === 'audio' || (message.type === 'file' && /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(message.fileName || ''));

    if (isAudio && message.content.startsWith('data:')) {
      return <AudioPlayer src={message.content} msgId={message.id} />;
    }
    switch (message.type) {
      case 'image':
        return (
          <>
            <img src={message.content} alt="" className="bubble-img" onClick={() => window.open(message.content, '_blank')} />
            {message.fileName && <p className="bubble-caption">{message.fileName}</p>}
          </>
        );
      case 'video':
        return <video src={message.content} controls className="bubble-video" preload="metadata" />;
      case 'audio':
        return <AudioPlayer src={message.content} msgId={message.id} />;
      case 'file':
        return (
          <div className="file-msg">
            <div className="file-icon">{fileIcon(message.fileName)}</div>
            <div className="file-info">
              <span className="file-name">{message.fileName}</span>
              <span className="file-size">{fmtSize(message.fileSize)}</span>
            </div>
            <a href={message.content} download={message.fileName} className="file-dl"><IoDownload /></a>
          </div>
        );
      default:
        return <p className="bubble-text">{message.content}</p>;
    }
  };

  return (
    <>
      <div
        className={`msg-row ${isMe ? 'me' : ''}`}
        onContextMenu={onCtxMenu}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: swipe ? `translateX(${isMe ? -swipe : swipe}px)` : undefined, transition: swipe ? 'none' : 'transform 0.2s' }}
      >
        {!isMe && (
          <div className="msg-av" style={{ width: 28 }}>
            {showAvatar && <Avatar src={contactAvatar} name={contactName} size={28} />}
          </div>
        )}

        <div className={`bubble ${isMe ? 'me' : 'them'} type-${message.type}`}>
          {replyMsg && (
            <div className="bubble-reply">
              <span className="bubble-reply-name">{replyMsg.senderId === message.senderId ? 'You' : contactName}</span>
              <span className="bubble-reply-text">{replyMsg.type !== 'text' ? `[${replyMsg.type}]` : replyMsg.content}</span>
            </div>
          )}
          {renderContent()}
          <div className="bubble-meta">
            {message.encrypted && <span title="End-to-end encrypted" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>🔒</span>}
            <span className="bubble-time">{fmtTime(message.createdAt)}</span>
            {isMe && <StatusIcon status={message.status} />}
          </div>
        </div>
      </div>

      {ctx && (
        <>
          <div className="ctx-overlay" onClick={() => setCtx(null)} />
          <div className="ctx-menu" style={{ top: ctx.y, left: ctx.x }} onClick={(e) => e.stopPropagation()}>
            <button className="ctx-item" onClick={() => { onReply(message); setCtx(null); }}><IoArrowUndo /> Reply</button>
            {message.type === 'text' && <button className="ctx-item" onClick={handleCopy}><IoCopy /> Copy</button>}
            <div className="ctx-sep" />
            <button className="ctx-item danger" onClick={handleDelete}><IoTrash /> Delete</button>
          </div>
        </>
      )}
    </>
  );
}
