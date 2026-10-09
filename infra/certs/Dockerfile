# One-shot job: creates the development CA and service certificates in the shared /certs volume.
FROM python:3.12-slim
RUN pip install --no-cache-dir cryptography==43.0.3
COPY generate_certs.py /generate_certs.py
CMD ["python", "/generate_certs.py", "/certs"]
