# Log server: receives the AAA server's accounting events (RFC 5424 over TLS, port 6514)
# and stores them in /var/log/neurolock/audit.log.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends rsyslog rsyslog-gnutls ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/neurolock
COPY rsyslog.conf /etc/rsyslog.conf
EXPOSE 6514
VOLUME ["/var/log/neurolock"]
CMD ["rsyslogd", "-n", "-f", "/etc/rsyslog.conf"]
