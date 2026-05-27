import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * End-to-End Encryption for Codememory Relay (v0.3.5).
 *
 * Uses AES-256-GCM for authenticated encryption with a pre-shared
 * pairing key. Each message gets a fresh 12-byte IV (nonce) and
 * a 16-byte authentication tag appended to the ciphertext.
 *
 * Security properties:
 *   - Confidentiality: only peers with the pairing key can read messages.
 *   - Integrity: tampered ciphertext fails decryption (GCM auth tag).
 *   - Forward secrecy (per-message): fresh random IV for every message.
 *
 * Follows Rule 02: no cloud dependencies — pure Node.js crypto.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives a 256-bit encryption key from the pairing key string.
 * Uses SHA-256 to produce a consistent-length key regardless
 * of the input key length.
 *
 * @param pairingKey The pre-shared pairing key.
 * @returns A 32-byte Buffer suitable for AES-256-GCM.
 */
export function deriveKey(pairingKey: string): Buffer {
  return createHash('sha256').update(pairingKey).digest();
}

/**
 * Encrypts plaintext data using AES-256-GCM.
 *
 * @param plaintext  The data to encrypt.
 * @param pairingKey The pre-shared pairing key.
 * @returns          Base64-encoded string: IV (12b) + ciphertext + auth tag (16b).
 */
export function encrypt(plaintext: string, pairingKey: string): string {
  const key = deriveKey(pairingKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: iv + ciphertext + tag, all base64-encoded
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/**
 * Decrypts ciphertext produced by {@link encrypt}.
 *
 * @param encoded    Base64-encoded: IV + ciphertext + auth tag.
 * @param pairingKey The pre-shared pairing key.
 * @returns          The original plaintext.
 * @throws           If the auth tag doesn't match (tampered data).
 */
export function decrypt(encoded: string, pairingKey: string): string {
  const key = deriveKey(pairingKey);
  const buffer = Buffer.from(encoded, 'base64');

  if (buffer.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short for IV + auth tag');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(buffer.length - TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH, buffer.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Generates a new random pairing key for first-time setup.
 *
 * Produces a 32-character hex string (128 bits of entropy)
 * suitable for sharing manually between team members.
 *
 * @returns A random hex-encoded pairing key.
 */
export function generatePairingKey(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Returns a short fingerprint of the pairing key for display.
 * The full key is never shown — just enough to verify peers
 * are using the same key.
 *
 * @param pairingKey The pairing key.
 * @returns          First 8 hex characters of the key's SHA-256 hash.
 */
export function getPairingFingerprint(pairingKey: string): string {
  return deriveKey(pairingKey).toString('hex').slice(0, 8);
}

/**
 * Creates a deterministic peer ID from hostname and port.
 * Used for idempotent peer registration — same host+port
 * always produces the same ID.
 *
 * @param hostname Peer hostname.
 * @param port     Peer relay port.
 * @returns        A hex-encoded peer ID.
 */
export function generatePeerId(hostname: string, port: number): string {
  return createHash('sha256')
    .update(`${hostname}:${port}`)
    .digest('hex')
    .slice(0, 16);
}
