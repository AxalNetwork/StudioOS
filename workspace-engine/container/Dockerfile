# D5566: separate candidate image. Vulnerability evidence currently DENIES admission; never publish/activate it.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
RUN --mount=type=secret,id=system_ca \
    if [ -f /run/secrets/system_ca ]; then export SSL_CERT_FILE=/run/secrets/system_ca; fi; \
    apt-get -o Acquire::https::CaInfo=${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt} update \
    && apt-get -o Acquire::https::CaInfo=${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt} install -y --no-install-recommends git ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /workspace && chown node:node /workspace && chmod 700 /workspace
COPY --chmod=0444 idle.mjs run-job.mjs /app/
USER node
WORKDIR /workspace
ENV NODE_ENV=production HOME=/workspace/tmp TMPDIR=/workspace/tmp
ENTRYPOINT ["/usr/bin/setpriv", "--no-new-privs", "node", "/app/idle.mjs"]
