import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import SetupPage from './components/SetupPage';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import CallScreen, { IncomingCallInfo } from './components/CallScreen';
import { peerManager } from './p2p/peerManager';
import { IoLockClosed } from 'react-icons/io5';

export default function App() {
  const { screen, activeChatId, contacts, loadData } = useAppStore();
  const [globalIncoming, setGlobalIncoming] = useState<IncomingCallInfo | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Listen for incoming calls globally (even when no chat is open)
  useEffect(() => {
    const onIncoming = ({ peerId, call, callType }: { peerId: string; call: any; callType: 'audio' | 'video' }) => {
      // If the chat is already open for this peer, ChatView handles it
      // Otherwise show global incoming call screen
      if (activeChatId !== peerId) {
        const c = contacts.find((x) => x.id === peerId);
        setGlobalIncoming({
          peerId,
          peerName: c?.displayName || peerId,
          peerAvatar: c?.avatar,
          callType,
          call,
        });
      }
    };
    peerManager.on('incoming-call', onIncoming);
    return () => peerManager.off('incoming-call', onIncoming);
  }, [activeChatId, contacts]);

  if (screen === 'setup') return <SetupPage />;

  return (
    <>
      <div className="app">
        <Sidebar />
        <div className={`main ${activeChatId ? 'active' : ''}`}>
          {activeChatId ? (
            <ChatView chatId={activeChatId} />
          ) : (
            <div className="empty-main">
              <div className="empty-main-icon">
                {/* NUR logo */}
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <circle cx="40" cy="40" r="40" fill="url(#nurGrad)" />
                  <defs>
                    <radialGradient id="nurGrad" cx="30%" cy="30%">
                      <stop offset="0%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#4C1D95" />
                    </radialGradient>
                  </defs>
                  <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle"
                    fontSize="28" fontWeight="900" fill="white" fontFamily="system-ui">
                    NUR
                  </text>
                </svg>
              </div>
              <h2>Welcome to NUR</h2>
              <p>Select a chat or add a new contact to start a fully encrypted peer-to-peer conversation.</p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, color: 'var(--green)',
                fontSize: 13, marginTop: 8, background: 'rgba(61,220,132,0.08)',
                padding: '8px 18px', borderRadius: 20, border: '1px solid rgba(61,220,132,0.2)',
              }}>
                <IoLockClosed size={13} /> End-to-end encrypted · No servers · P2P
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Global incoming call (when no chat is open) */}
      {globalIncoming && (
        <CallScreen
          incoming={globalIncoming}
          onEnd={() => setGlobalIncoming(null)}
        />
      )}
    </>
  );
}
