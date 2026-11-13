# Archive path

`index.ts` keeps the tail handler small. `archive.ts` derives a stable content batch ID, creates one conditional object, retries at most three times and reports received/retry/confirmed/exhausted metadata independently. `protocol.ts` strictly validates and signs that metadata. Exact object keys stay private; errors log closed categories/counts instead of keys or exceptions.

The bounded in-memory replay window does not promise recovery after both stores fail or after the handler ends. Ambiguous writes are unconfirmed, not definitely lost. Independent metadata and owned canaries expose gaps. The existing producer remains responsible for scrubbing sensitive logs; no raw content is copied into the notification contract.
