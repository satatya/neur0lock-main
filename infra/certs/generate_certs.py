"""Creates a private development CA and the TLS certificates every NeuroLock service uses.

    python generate_certs.py <output-dir>

Idempotent: existing files are kept. In production replace these with certificates from your
organisation's PKI.
"""
import datetime
import ipaddress
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

SERVICES = {
    # file name: (common name, DNS names, IPs, server auth, client auth)
    "openldap": ("openldap", ["openldap", "localhost"], ["127.0.0.1"], True, False),
    "rsyslog": ("rsyslog", ["rsyslog", "localhost"], ["127.0.0.1"], True, False),
    # AAA: server for the REST API, client towards rsyslog
    "aaa": ("aaa", ["aaa", "localhost"], ["127.0.0.1"], True, True),
    # REST API: client certificate for calls to the AAA server
    "api": ("neurolock-api", ["api", "localhost"], ["127.0.0.1"], False, True),
    # Website (nginx)
    "web": ("localhost", ["localhost", "web"], ["127.0.0.1"], True, False),
}


def _key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _write(path, data: bytes):
    with open(path, "wb") as handle:
        handle.write(data)
    os.chmod(path, 0o644)  # containers run as different users; this is a dev-only volume


def _pem_key(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())


def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_key_path, ca_crt_path = os.path.join(out_dir, "ca.key"), os.path.join(out_dir, "ca.crt")

    if os.path.exists(ca_key_path) and os.path.exists(ca_crt_path):
        with open(ca_key_path, "rb") as handle:
            ca_key = serialization.load_pem_private_key(handle.read(), password=None)
        with open(ca_crt_path, "rb") as handle:
            ca_cert = x509.load_pem_x509_certificate(handle.read())
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "NeuroLock Development CA"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NeuroLock")])
        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        _write(ca_key_path, _pem_key(ca_key))
        _write(ca_crt_path, ca_cert.public_bytes(serialization.Encoding.PEM))
        print("created CA")

    for file_name, (common_name, dns_names, ips, server_auth, client_auth) in SERVICES.items():
        crt_path, key_path = os.path.join(out_dir, f"{file_name}.crt"), os.path.join(out_dir, f"{file_name}.key")
        if os.path.exists(crt_path) and os.path.exists(key_path):
            continue
        key = _key()
        usages = ([ExtendedKeyUsageOID.SERVER_AUTH] if server_auth else []) + ([ExtendedKeyUsageOID.CLIENT_AUTH] if client_auth else [])
        alt_names = [x509.DNSName(d) for d in dns_names] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
        cert = (
            x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NeuroLock")]))
            .issuer_name(ca_cert.subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=825))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
            .add_extension(x509.ExtendedKeyUsage(usages), critical=False)
            .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        _write(key_path, _pem_key(key))
        _write(crt_path, cert.public_bytes(serialization.Encoding.PEM))
        print(f"created {file_name}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/certs")
