import { decryptNote, encryptNote, getKEK, noteAad, openSecret, sealSecret, unwrapDEK, wrapDEK } from '../src/utils/encryption';

describe('envelope encryption', () => {
    it('encrypts and decrypts a note', () => {
        const encrypted = encryptNote('Patient reports improved sleep.');
        expect(encrypted.iv).toHaveLength(12);
        expect(encrypted.dekWrapped).toHaveLength(40); // 32-byte DEK + 8 bytes of RFC 3394 overhead
        expect(encrypted.ciphertext.toString('utf-8')).not.toContain('improved');
        expect(decryptNote(encrypted.dekWrapped, encrypted.iv, encrypted.ciphertext)).toBe('Patient reports improved sleep.');
    });

    it('binds ciphertext to the patient via associated data', () => {
        const encrypted = encryptNote('confidential', noteAad(1));
        expect(decryptNote(encrypted.dekWrapped, encrypted.iv, encrypted.ciphertext, noteAad(1))).toBe('confidential');
        expect(() => decryptNote(encrypted.dekWrapped, encrypted.iv, encrypted.ciphertext, noteAad(2))).toThrow();
    });

    it('detects tampering', () => {
        const encrypted = encryptNote('do not modify');
        encrypted.ciphertext[0] ^= 0xff;
        expect(() => decryptNote(encrypted.dekWrapped, encrypted.iv, encrypted.ciphertext)).toThrow();
    });

    it('wraps and unwraps data keys with the KEK (RFC 3394)', () => {
        const dek = Buffer.alloc(32, 7);
        expect(unwrapDEK(getKEK(), wrapDEK(getKEK(), dek)).equals(dek)).toBe(true);
    });

    it('seals small secrets such as TOTP seeds', () => {
        const sealed = sealSecret('JBSWY3DPEHPK3PXP');
        expect(sealed.toString('utf-8')).not.toContain('JBSWY3DPEHPK3PXP');
        expect(openSecret(sealed)).toBe('JBSWY3DPEHPK3PXP');
    });
});
