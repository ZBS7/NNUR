/**
 * E2EE using Web Crypto API
 * Key exchange: ECDH (P-256)
 * Encryption:   AES-GCM 256-bit
 */

// ── Key Generation ──────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKey: bufToBase64(pubRaw),
    privateKey: JSON.stringify(privJwk),
  };
}

// ── Shared Secret Derivation ────────────────────────────────────────────────

export async function deriveSharedKey(
  myPrivateKeyB64: string,
  theirPublicKeyB64: string
): Promise<CryptoKey> {
  const privJwk = JSON.parse(myPrivateKeyB64);
  const privKey = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );

  const pubRaw = base64ToBuf(theirPublicKeyB64);
  const pubKey = await crypto.subtle.importKey(
    'raw',
    pubRaw.buffer.slice(pubRaw.byteOffset, pubRaw.byteOffset + pubRaw.byteLength) as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: pubKey },
    privKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Encrypt ─────────────────────────────────────────────────────────────────

export async function encrypt(plaintext: string, sharedKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  // Prepend IV to ciphertext, encode as base64
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return bufToBase64(combined.buffer);
}

// ── Decrypt ─────────────────────────────────────────────────────────────────

export async function decrypt(ciphertextB64: string, sharedKey: CryptoKey): Promise<string> {
  const combined = base64ToBuf(ciphertextB64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function base64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ── Key cache (avoid re-deriving on every message) ───────────────────────────

const keyCache = new Map<string, CryptoKey>();

export async function getSharedKey(
  myPrivateKey: string,
  theirPublicKey: string,
  cacheKey: string
): Promise<CryptoKey> {
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)!;
  const key = await deriveSharedKey(myPrivateKey, theirPublicKey);
  keyCache.set(cacheKey, key);
  return key;
}
