FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --system --uid 10001 aaa \
 && mkdir -p /data && chown aaa /data

COPY gunicorn.conf.py wsgi.py ./
COPY app ./app

USER aaa
EXPOSE 443
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import ssl,urllib.request as u; c=ssl.create_default_context(cafile='/certs/ca.crt'); c.load_cert_chain('/certs/aaa.crt','/certs/aaa.key'); u.urlopen('https://localhost/v1/health', context=c, timeout=4)"
CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:app"]
