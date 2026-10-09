import crypto from 'crypto';
import { config } from '../config/env';

/**
 * Envelope encryption utilities ported from Python crypto.py
 * Uses AES-256-GCM for data encryption with a KEK-wrapped DEK
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits authentication tag
const DEK_LENGTH = 32; // 256 bits
const KEY_WRAP_IV = Buffer.alloc(8, 0xa6); // RFC 3394 default IV

/**
 * Get the Key Encryption Key (KEK) from configuration
 */
export function getKEK(): Buffer {
    return Buffer.from(config.kekHex, 'hex');
}

/**
 * Generate a random Data Encryption Key (DEK)
 */
export function generateDEK(): Buffer {
    return crypto.randomBytes(DEK_LENGTH);
}

/**
 * Wrap (encrypt) a DEK using the KEK via AES Key Wrap (RFC 3394)
 */
export function wrapDEK(kek: Buffer, dek: Buffer): Buffer {
    const cipher = crypto.createCipheriv('id-aes256-wrap', kek, KEY_WRAP_IV);
    return Buffer.concat([cipher.update(dek), cipher.final()]);
}

/**
 * Unwrap (decrypt) a wrapped DEK using the KEK
 */
export function unwrapDEK(kek: Buffer, wrappedDEK: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('id-aes256-wrap', kek, KEY_WRAP_IV);
    return Buffer.concat([decipher.update(wrappedDEK), decipher.final()]);
}

/**
 * Encrypt data using AES-256-GCM. The returned ciphertext has the tag appended,
 * matching the layout produced by Python's AESGCM.encrypt().
 */
export function encryptData(plaintext: Buffer, dek: Buffer, associatedData?: Buffer): { iv: Buffer; ciphertext: Buffer } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
    if (associatedData) {
        cipher.setAAD(associatedData);
    }
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { iv, ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]) };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decryptData(iv: Buffer, ciphertext: Buffer, dek: Buffer, associatedData?: Buffer): Buffer {
    const encrypted = ciphertext.subarray(0, -TAG_LENGTH);
    const tag = ciphertext.subarray(-TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAuthTag(tag);
    if (associatedData) {
        decipher.setAAD(associatedData);
    }
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Associated data that binds a note's ciphertext to its patient, so rows cannot be swapped between patients. */
export const noteAad = (patientId: number) => Buffer.from(`neurolock:note:patient:${patientId}`, 'utf-8');

export interface EncryptedNote {
    dekWrapped: Buffer;
    iv: Buffer;
    ciphertext: Buffer;
}

/**
 * High-level function to encrypt a note with envelope encryption
 */
export function encryptNote(noteText: string, associatedData?: Buffer): EncryptedNote {
    const dek = generateDEK();
    const dekWrapped = wrapDEK(getKEK(), dek);
    const { iv, ciphertext } = encryptData(Buffer.from(noteText, 'utf-8'), dek, associatedData);
    dek.fill(0);
    return { dekWrapped, iv, ciphertext };
}

/**
 * High-level function to decrypt a note
 */
export function decryptNote(dekWrapped: Buffer, iv: Buffer, ciphertext: Buffer, associatedData?: Buffer): string {
    const dek = unwrapDEK(getKEK(), dekWrapped);
    try {
        return decryptData(iv, ciphertext, dek, associatedData).toString('utf-8');
    } finally {
        dek.fill(0);
    }
}

/**
 * Encrypts a small secret (e.g. a TOTP seed) directly with the KEK.
 * Layout: iv(12) | ciphertext | tag(16)
 */
export function sealSecret(secret: string): Buffer {
    const { iv, ciphertext } = encryptData(Buffer.from(secret, 'utf-8'), getKEK(), Buffer.from('neurolock:secret'));
    return Buffer.concat([iv, ciphertext]);
}

export function openSecret(sealed: Buffer): string {
    const iv = sealed.subarray(0, IV_LENGTH);
    const ciphertext = sealed.subarray(IV_LENGTH);
    return decryptData(iv, ciphertext, getKEK(), Buffer.from('neurolock:secret')).toString('utf-8');
}
