# Demo usage: insert a patient and an encrypted note, then read back
import time
from db_client import insert_patient, insert_encrypted_note, read_note_plaintext

# Use unique MRN based on timestamp to allow repeated runs
unique_mrn = f"MRN{int(time.time())}"
pid = insert_patient(unique_mrn, "Demo Patient")
nid = insert_encrypted_note(pid, author="dr.sen", note_text="BP stable. Continue meds.")

print("Inserted patient ID =", pid)
print("Inserted note ID    =", nid)
print("Decrypted note      =", read_note_plaintext(nid))
