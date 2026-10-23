# D886 owner ruling: Node core and browser adapters; Python is the Zoom sidecar boundary.
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npx --no-install playwright install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && chmod -R a+rX /ms-playwright

FROM base AS verified
COPY src ./src
COPY notice.mjs ./notice.mjs
COPY zoom/native.py zoom/sidecar.py zoom/requirements.txt ./zoom/
COPY test/container_smoke.test.ts ./test/container_smoke.test.ts
RUN node --experimental-strip-types --no-warnings --test test/container_smoke.test.ts

FROM base AS runtime
COPY --from=verified --chown=node:node /app/src ./src
COPY --from=verified --chown=node:node /app/notice.mjs ./notice.mjs
COPY --from=verified --chown=node:node /app/zoom ./zoom
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/entry.ts"]
