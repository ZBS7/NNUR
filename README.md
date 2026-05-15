# NUR Messenger 🔒

A fully decentralized, end-to-end encrypted P2P messenger that runs in the browser. No servers store your messages.

## How it works

```
User A ──── PeerJS signaling ──── User B
              (handshake only)
                    │
           WebRTC Data Channel
           (all messages P2P)
```

- **Signaling**: PeerJS public server (only for initial WebRTC handshake)
- **Messages**: Direct P2P via WebRTC Data Channels — never touch a server
- **Encryption**: ECDH P-256 key exchange + AES-GCM 256-bit (Web Crypto API)
- **Storage**: IndexedDB (Dexie.js) — everything stored locally on your device
- **Calls**: WebRTC audio/video calls with ringtone

## Features

- 💬 Text messages with reply, copy, delete
- 🖼 Photo, video, audio, file sharing
- 🎙 Voice messages
- 📞 Audio & video calls
- 🔒 End-to-end encryption (keys never leave your device)
- 📱 QR code contact sharing — scan to add instantly
- 🌐 Works across the internet (NAT traversal via STUN)

## Deploy to GitHub Pages

### Option 1 — Automatic (recommended)

1. Push this repo to GitHub
2. Go to **Settings → Pages → Source** → select **GitHub Actions**
3. The workflow in `.github/workflows/deploy.yml` will build and deploy automatically on every push to `main`
4. Your app will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

### Option 2 — Manual

```bash
npm install
VITE_BASE_PATH=/your-repo-name/ npm run build
# Upload the dist/ folder to any static host
```

## Run locally

```bash
npm install
npm run dev
# Open http://localhost:5174
```

## How to add a contact

1. Click **+** in the sidebar
2. **My ID / QR** tab — share your Peer ID or QR code
3. The other person goes to **Add Contact** tab and either:
   - Pastes your Peer ID and clicks "Add & Open Chat"
   - Scans your QR code with their camera (auto-adds instantly)

## Tech stack

| Layer | Technology |
|-------|-----------|
| P2P transport | PeerJS + WebRTC Data Channels |
| Signaling | PeerJS public server (0.peerjs.com) |
| NAT traversal | Google STUN servers |
| Encryption | ECDH P-256 + AES-GCM (Web Crypto API) |
| Storage | Dexie.js (IndexedDB) |
| Frontend | React 18 + TypeScript + Vite |
| State | Zustand |

## Privacy

- Your private key is generated locally and **never leaves your device**
- Messages are encrypted before sending and decrypted only on the recipient's device
- The PeerJS signaling server only sees your Peer ID and WebRTC handshake data — never message content
- All message history is stored in your browser's IndexedDB
