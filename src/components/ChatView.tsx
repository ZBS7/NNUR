import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { peerManager } from '../p2p/peerManager';
import { db, Message, Chat } from '../db/database';
import MessageBubble, { fmtDate } from './MessageBubble';
import Avatar from './Avatar';
import CallScreen, { IncomingCallInfo } from './CallScreen';
import GroupInfoModal from './GroupInfoModal';
import {
  IoArrowBack, IoSend, IoAttach, IoClose,
  IoImage, IoVideocam, IoDocument, IoLockClosed, IoCall,
  IoPeople, IoInformationCircle,
} from 'react-icons/io5';

interface Props { chatId: string; }

export default function ChatView({ chatId }: Props) {
  const { identity, contacts, chats, messages, typingPeers, connectionStatuses, sendMessage, setActiveChat, loadMessages } = useAppStore();
  const contact = contacts.find((c) => c.id === chatId);
  const chat = chats.find((c) => c.id === chatId);
  const isGroup = chat?.type === 'group';
  const chatMessages = messages[chatId] || [];
  const isTyping = typingPeers[chatId] || false;
  const connStatus = connectionStatuses[chatId] || (isGroup ? 'connected' : 'disconnected');

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingFile, setSendingFile] = useState(''); // filename being sent
  const [showGroupInfo, setShowGroupInfo] = useState(false);

  // ── Call state ────────────────────────────────────────────────────────────
  const [outgoingCall, setOutgoingCall] = useState<{
    peerId: string; peerName: string; peerAvatar?: string; callType: 'audio' | 'video';
  } | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load messages & connect ───────────────────────────────────────────────
  useEffect(() => {
    loadMessages(chatId);
    if (!isGroup) peerManager.connectTo(chatId);
  }, [chatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      const last = chatMessages[chatMessages.length - 1];
      if (last.senderId !== identity?.peerId) {
        peerManager.sendRead(chatId, last.id);
        db.chats.update(chatId, { unreadCount: 0 });
      }
    }
  }, [chatMessages.length]);

  // ── Listen for incoming calls ─────────────────────────────────────────────
  useEffect(() => {
    const onIncoming = ({ peerId, call, callType }: { peerId: string; call: any; callType: 'audio' | 'video' }) => {
      // Only show if it's from this contact (or show globally — handled in App)
      const c = contacts.find((x) => x.id === peerId);
      setIncomingCall({
        peerId,
        peerName: c?.displayName || peerId,
        peerAvatar: c?.avatar,
        callType,
        call,
      });
    };
    peerManager.on('incoming-call', onIncoming);
    return () => peerManager.off('incoming-call', onIncoming);
  }, [contacts]);

  // ── Start call ────────────────────────────────────────────────────────────
  const startCall = (callType: 'audio' | 'video') => {
    if (connStatus !== 'connected') {
      alert('Contact is offline. Cannot start a call.');
      return;
    }
    setOutgoingCall({
      peerId: chatId,
      peerName: contact?.displayName || chatId,
      peerAvatar: contact?.avatar,
      callType,
    });
  };

  // ── Text input ────────────────────────────────────────────────────────────
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    peerManager.sendTyping(chatId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => peerManager.sendTyping(chatId, false), 2000);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    peerManager.sendTyping(chatId, false);
    try {
      await sendMessage(chatId, content, 'text', replyTo ? { replyToId: replyTo.id } : undefined);
      setReplyTo(null);
    } catch {} finally { setSending(false); }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── File sending ──────────────────────────────────────────────────────────
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for P2P DataChannel

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const sendFile = async (file: File, type: string) => {
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Maximum size is 5MB.\n\nYour file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    setSending(true);
    setSendingFile(file.name);
    setShowAttach(false);
    try {
      const b64 = await fileToBase64(file);
      await sendMessage(chatId, b64, type, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        replyToId: replyTo?.id,
      });
      setReplyTo(null);
    } catch (err) {
      console.error('File send error:', err);
      alert('Failed to send file. Please try again.');
    } finally {
      setSending(false);
      setSendingFile('');
    }
  };

  const handleImgSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) sendFile(f, f.type.startsWith('video/') ? 'video' : 'image'); e.target.value = ''; };
  const handleVidSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) sendFile(f, 'video'); e.target.value = ''; };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) { e.target.value = ''; return; }
    let type = 'file';
    if (f.type.startsWith('image/')) type = 'image';
    else if (f.type.startsWith('video/')) type = 'video';
    sendFile(f, type); e.target.value = '';
  };

  const statusLabel = isGroup ? `${chat?.memberIds?.length || 0} members`
    : connStatus === 'connected' ? 'online'
    : connStatus === 'connecting' ? 'connecting...' : 'offline';
  const statusClass = isGroup ? 'status-online'
    : connStatus === 'connected' ? 'status-online'
    : connStatus === 'connecting' ? 'status-connecting' : 'status-offline';

  // Chat name
  const chatName = isGroup ? (chat?.name || 'Group') : (contact?.displayName || chatId);
  const chatAvatar = isGroup ? chat?.avatar : contact?.avatar;

  // Group messages by date
  const grouped: { date: string; msgs: Message[] }[] = [];
  let curDate = '';
  chatMessages.forEach((m) => {
    const d = fmtDate(m.createdAt);
    if (d !== curDate) { curDate = d; grouped.push({ date: d, msgs: [] }); }
    grouped[grouped.length - 1].msgs.push(m);
  });

  return (
    <>
      <div className="main active" style={{ flexDirection: 'column' }}>
        {/* ── Header ── */}
        <div className="chat-header">
          <button className="icon-btn back-btn" onClick={() => setActiveChat(null)}><IoArrowBack /></button>
          <Avatar src={chatAvatar} name={chatName} size={40}
            online={!isGroup && connStatus === 'connected'}
            connecting={!isGroup && connStatus === 'connecting'} />
          <div className="chat-header-info" onClick={() => isGroup && setShowGroupInfo(true)}>
            <span className="chat-header-name">{chatName}</span>
            <span className={`chat-header-sub ${statusClass}`}>{statusLabel}</span>
          </div>
          {/* Group info button */}
          {isGroup && (
            <button className="icon-btn" onClick={() => setShowGroupInfo(true)} title="Group info">
              <IoInformationCircle />
            </button>
          )}
          {/* Call buttons — only for direct chats */}
          {!isGroup && (
            <>
              <button className="icon-btn" title="Audio call"
                onClick={() => startCall('audio')}
                style={{ color: connStatus === 'connected' ? 'var(--green)' : 'var(--text3)' }}>
                <IoCall />
              </button>
              <button className="icon-btn" title="Video call"
                onClick={() => startCall('video')}
                style={{ color: connStatus === 'connected' ? 'var(--accent3)' : 'var(--text3)' }}>
                <IoVideocam />
              </button>
            </>
          )}
          <div className="e2ee-badge"><IoLockClosed size={11} /> E2EE</div>
        </div>

        {/* ── Messages ── */}
        <div className="messages-area" ref={containerRef}>
          {grouped.map((g) => (
            <div key={g.date}>
              <div className="date-sep"><span>{g.date}</span></div>
              {g.msgs.map((msg, i) => {
                const prev = g.msgs[i - 1];
                const senderContact = isGroup ? contacts.find((c) => c.id === msg.senderId) : contact;
                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isMe={msg.senderId === identity?.peerId}
                    showAvatar={isGroup && (!prev || prev.senderId !== msg.senderId)}
                    contactName={senderContact?.displayName || msg.senderId.slice(0, 8)}
                    contactAvatar={senderContact?.avatar}
                    allMessages={chatMessages}
                    onReply={setReplyTo}
                  />
                );
              })}
            </div>
          ))}
          {isTyping && (
            <div className="typing-row">
              <div className="typing-dots"><span /><span /><span /></div>
              <span>{contact?.displayName || 'Someone'} is typing...</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* ── Input ── */}
        <div className="input-area">
          {/* File sending progress */}
          {sendingFile && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'rgba(108,99,255,0.1)', borderRadius: 10, marginBottom: 8,
              border: '1px solid rgba(108,99,255,0.2)',
            }}>
              <div style={{ width: 16, height: 16, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Sending {sendingFile}…
              </span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {replyTo && (
            <div className="reply-bar">
              <div className="reply-bar-content">
                <span className="reply-bar-name">{replyTo.senderId === identity?.peerId ? 'You' : (contact?.displayName || replyTo.senderId.slice(0, 8))}</span>
                <span className="reply-bar-text">{replyTo.type !== 'text' ? `[${replyTo.type}]` : replyTo.content}</span>
              </div>
              <button className="icon-btn" onClick={() => setReplyTo(null)}><IoClose /></button>
            </div>
          )}

          <div className="input-row">
            <div className="attach-wrap">
              <button className="icon-btn" onClick={() => setShowAttach(!showAttach)}><IoAttach /></button>
              {showAttach && (
                <div className="attach-menu">
                  <button className="attach-item" onClick={() => { imgRef.current?.click(); setShowAttach(false); }}><IoImage /> Photo / Video</button>
                  <button className="attach-item" onClick={() => { vidRef.current?.click(); setShowAttach(false); }}><IoVideocam /> Video</button>
                  <button className="attach-item" onClick={() => { fileRef.current?.click(); setShowAttach(false); }}><IoDocument /> Any File</button>
                </div>
              )}
            </div>

            <input ref={imgRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleImgSelect} />
            <input ref={vidRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleVidSelect} />
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />

            <textarea
              className="msg-input"
              placeholder="Message..."
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKey}
              rows={1}
              disabled={sending}
            />
            <button className="send-btn" onClick={handleSend} disabled={sending || !text.trim()}><IoSend /></button>
          </div>
        </div>
      </div>

      {/* ── Group info modal ── */}
      {showGroupInfo && isGroup && (
        <GroupInfoModal chatId={chatId} onClose={() => setShowGroupInfo(false)} />
      )}

      {/* ── Outgoing call ── */}
      {outgoingCall && <CallScreen outgoing={outgoingCall} onEnd={() => setOutgoingCall(null)} />}
      {/* ── Incoming call ── */}
      {incomingCall && <CallScreen incoming={incomingCall} onEnd={() => setIncomingCall(null)} />}
    </>
  );
}
