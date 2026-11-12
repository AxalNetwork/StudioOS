# D5566: candidate only. The image workflow must validate it before admission.
FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
RUN --mount=type=secret,id=system_ca \
    if [ -f /run/secrets/system_ca ]; then export SSL_CERT_FILE=/run/secrets/system_ca; fi; \
    apk upgrade --no-cache \
    && apk add --no-cache ca-certificates git nodejs npm setpriv \
    && test -x /bin/setpriv && ln -s /bin/setpriv /usr/bin/setpriv \
    && addgroup -g 1000 node && adduser -D -H -u 1000 -G node node \
    && mkdir -p /app /workspace && chown node:node /workspace && chmod 700 /workspace
COPY --chmod=0444 idle.mjs run-job.mjs /app/
USER node
WORKDIR /workspace
ENV NODE_ENV=production HOME=/workspace/tmp TMPDIR=/workspace/tmp
ENTRYPOINT ["/usr/bin/setpriv", "--no-new-privs", "node", "/app/idle.mjs"]
