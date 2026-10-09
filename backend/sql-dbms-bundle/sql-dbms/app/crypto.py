import os
from typing import Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.keywrap import aes_key_wrap, aes_key_unwrap

def generate_dek() -> bytes:
    return os.urandom(32)  # 256-bit DEK

def wrap_dek(kek: bytes, dek: bytes) -> bytes:
    # RFC 3394 AES Key Wrap (adds 8 bytes)
    return aes_key_wrap(kek, dek)

def unwrap_dek(kek: bytes, wrapped: bytes) -> bytes:
    return aes_key_unwrap(kek, wrapped)

def encrypt_note(plaintext: bytes, associated_data: bytes | None, dek: bytes) -> Tuple[bytes, bytes]:
    aesgcm = AESGCM(dek)
    iv = os.urandom(12)  # 96-bit nonce
    ct = aesgcm.encrypt(iv, plaintext, associated_data)
    return iv, ct

def decrypt_note(iv: bytes, ciphertext: bytes, associated_data: bytes | None, dek: bytes) -> bytes:
    aesgcm = AESGCM(dek)
    return aesgcm.decrypt(iv, ciphertext, associated_data)
