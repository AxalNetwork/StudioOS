### HQ › AI agents › From Axal: reconciling the library with the store (D5335, #5335)

The read-only preflight that D4532 §3 names. It is in `routes/admin_hq_skills.ts`, before `/:uid`. It is Super Admin only (403 otherwise). There is no client method: the screen belongs to #4956.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/ai-agents/skills/library/reconcile` | Super Admin | `{ report_version: 1, scope: 'hq', read_at, totals: { exact, source_only, persisted_only, content_drift, case_drift, missing_case, duplicate_identity, invalid_reference }, skills: [{ slug, class, disposition: none\|seed\|report\|fail, source_hash, persisted_hash, published_version }], manifest: [{ slug, uid, status, current_version, draft_hash, cases: [{ case_id, revision, key, sha256 }] }] }` |

It compares the generated library (`libraryManifest`, through `checkLibrary` on the store's live taxonomy) with the HQ-scope skills and their live cases (`persistedManifest`). It uses `reconcile`, which compares by identity and hash, never by count. Company skills are outside it. It returns hashes and identities only: no draft text, no case input, no person. It writes no store row. Its one write is the audit row `agent_skill_library_reconciled` (`logAdminAction`), which holds the totals. `node scripts/check-skill-library.mjs --persisted <file>` reads its JSON as the persisted manifest.
