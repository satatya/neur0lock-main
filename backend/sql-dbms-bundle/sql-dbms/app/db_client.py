import os, binascii
from dataclasses import dataclass
from typing import Optional

import mysql.connector
from mysql.connector.pooling import MySQLConnectionPool
from dotenv import load_dotenv

from crypto import generate_dek, wrap_dek, unwrap_dek, encrypt_note, decrypt_note

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)

@dataclass
class DBConfig:
    host: str = os.getenv("DB_HOST", "127.0.0.1")
    port: int = int(os.getenv("DB_PORT", "3306"))
    user: str = os.getenv("DB_USER", "app")
    password: str = os.getenv("DB_PASSWORD", "app123")
    database: str = os.getenv("DB_NAME", "neurolock")

    def dsn(self):
        return dict(host=self.host, port=self.port, user=self.user, password=self.password, database=self.database)

DB = DBConfig()
POOL = MySQLConnectionPool(pool_name="neurolock", pool_size=5, **DB.dsn())

def _kek() -> bytes:
    kek_hex = os.getenv("KEK_HEX")
    if not kek_hex:
        raise RuntimeError("KEK_HEX missing in .env")
    return binascii.unhexlify(kek_hex)

def insert_patient(mrn: str, full_name: str, dob: Optional[str] = None, phone: Optional[str] = None, email: Optional[str] = None) -> int:
    cn = POOL.get_connection()
    try:
        cur = cn.cursor()
        cur.execute(
            "INSERT INTO patients (mrn, full_name, dob, phone, email) VALUES (%s, %s, %s, %s, %s)",
            (mrn, full_name, dob, phone, email),
        )
        cn.commit()
        return cur.lastrowid
    finally:
        cn.close()

def insert_encrypted_note(patient_id: int, author: str, note_text: str) -> int:
    dek = generate_dek()
    iv, ct = encrypt_note(note_text.encode("utf-8"), associated_data=None, dek=dek)
    wrapped = wrap_dek(_kek(), dek)

    cn = POOL.get_connection()
    try:
        cur = cn.cursor()
        cur.execute(
            "INSERT INTO therapy_notes (patient_id, author, dek_wrapped, iv, ciphertext) VALUES (%s, %s, %s, %s, %s)",
            (patient_id, author, wrapped, iv, ct),
        )
        note_id = cur.lastrowid
        # Accounting is the AAA server's job (audit trail -> rsyslog); this demo client only
        # writes clinical data. Use the REST API for audited access.
        cn.commit()
        return note_id
    finally:
        cn.close()

def read_note_plaintext(note_id: int) -> str:
    cn = POOL.get_connection()
    try:
        cur = cn.cursor()
        cur.execute("SELECT dek_wrapped, iv, ciphertext FROM therapy_notes WHERE id=%s", (note_id,))
        row = cur.fetchone()
        if not row:
            raise KeyError(f"note {note_id} not found")
        wrapped, iv, ct = row
        dek = unwrap_dek(_kek(), wrapped)
        plaintext = decrypt_note(iv, ct, None, dek)
        return plaintext.decode("utf-8")
    finally:
        cn.close()
