# D886 owner ruling: Node core and browser adapters; Python is the Zoom sidecar boundary.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/runtime-node
WORKDIR /app
# #9209: apt reads one fixed Debian snapshot, the one the base digest above was built from
# (its debuerreotype epoch), so two builds of one commit install the same packages. Every
# apt install, Playwright's system dependencies included, comes from this source. The
# installed list is written to /usr/share/meeting-bot/apt-packages.txt so rebuilds can be
# compared. Moving the date: README § Rebuilds and the apt snapshot.
ARG DEBIAN_SNAPSHOT=20261104T212339Z
RUN printf '%s\n' \
      'Types: deb' "URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" \
      'Suites: bookworm bookworm-updates' 'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' '' \
      'Types: deb' "URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" \
      'Suites: bookworm-security' 'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
    && rm -f /etc/apt/sources.list \
    && printf '%s\n' 'Acquire::Check-Valid-Until "false";' 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/99snapshot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && apt-get update \
    && npx --no-install playwright install-deps chromium \
    && npx --no-install playwright install chromium \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-gi pulseaudio xvfb libglib2.0-0 \
    && mkdir -p /usr/share/meeting-bot && dpkg-query -W > /usr/share/meeting-bot/apt-packages.txt \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && chmod -R a+rX /ms-playwright
COPY zoom/requirements.txt ./zoom/requirements.txt
RUN python3 -m venv --system-site-packages /opt/zoom \
    && /opt/zoom/bin/pip install --no-cache-dir --only-binary=:all: --require-hashes -r zoom/requirements.txt \
    && /opt/zoom/bin/python -c "from gi.repository import GLib; import zoom_meeting_sdk as z; assert all(hasattr(z, name) for name in ('InitSDK','InitParam','AuthContext','CreateAuthService','CreateMeetingService'))" \
    && mkdir -p /tmp/runtime-node && chown node:node /tmp/runtime-node && chmod 700 /tmp/runtime-node
ENV PATH=/opt/zoom/bin:$PATH

FROM base AS verified
COPY src ./src
COPY notice.mjs ./notice.mjs
COPY zoom/native.py zoom/sidecar.py zoom/requirements.txt zoom/check_runtime.py ./zoom/
RUN python3 zoom/check_runtime.py
COPY container-entry.sh ./container-entry.sh
COPY test/container_smoke.test.ts ./test/container_smoke.test.ts
RUN node --experimental-strip-types --no-warnings --test test/container_smoke.test.ts

FROM base AS runtime
COPY --from=verified --chown=node:node /app/src ./src
COPY --from=verified --chown=node:node /app/notice.mjs ./notice.mjs
COPY --from=verified --chown=node:node /app/zoom ./zoom
COPY --from=verified --chown=node:node /app/container-entry.sh ./container-entry.sh
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "container-entry.sh"]
