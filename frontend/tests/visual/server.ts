/**
 * D1511 (#3762, deck v2 A18) — the visual and axe suites' server.
 *
 * Serves the BUILT SPA (`docs/`, from `npm run build`) and answers every
 * `/api/*` request with THE REAL WORKER (`cloudflare-worker/src/index.ts`,
 * `worker.fetch`) over the migrated D1 schema in SQLite and the fake AI
 * binding (`cloudflare-worker/test/_recorded_ai.mjs`). Nothing is stubbed by
 * path: the editor reads exactly what production's routes answer for these
 * records. Synthetic data only; it listens on 127.0.0.1 and never reaches the
 * network.
 *
 * What it seeds:
 *   · the matrix: one venture per (theme × aspect), each theme a key of
 *     `BASE_THEMES` (`services/decks/designSystem.ts`), so the axis grows when
 *     #3769 adds themes. Its current deck has one card per structure of the
 *     catalogue (`STRUCTURES`, 17), each area filled with a block;
 *   · the one-click venture (`fixtures/oneClickVenture.ts`): at start the
 *     server runs the one-click build on the fake binding — the brief from
 *     `/new/context`, `POST /api/decks/generate`, then Accept (keep-slides,
 *     save). No base version and no brand kit, so the picked theme is
 *     Neutral light (`oneClickModel.themePick`) and nothing more is written.
 *
 * `GET /__visual/manifest` answers the session token, the user and the
 * ventures, so the spec signs in and walks the matrix without a login page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     frontend/tests/visual/server.ts            (from the repo root; PORT defaults to 4791)
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import worker from '../../../cloudflare-worker/src/index.ts';
import { createJWT } from '../../../cloudflare-worker/src/auth.ts';
import { BASE_THEMES } from '../../../cloudflare-worker/src/services/decks/designSystem.ts';
import { ASPECTS, STRUCTURES } from '../../../cloudflare-worker/src/services/decks/structures.ts';
import { migratedDatabase } from '../../../cloudflare-worker/test/_storage_schema.ts';
import { d1Over } from '../../../cloudflare-worker/test/_d1_sqlite.mjs';
import { memKV } from '../../../cloudflare-worker/test/_mem_kv.mjs';
import { fakeAI } from '../../../cloudflare-worker/test/_recorded_ai.mjs';
import { ONE_CLICK, seedOneClickVenture } from '../../../cloudflare-worker/test/fixtures/oneClickVenture.ts';

const ROOT = resolve(new URL('../../../', import.meta.url).pathname);
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 4791);
const JWT_SECRET = 'synthetic-d1511-visual-suite-not-a-real-credential';
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Every version's saved time: the editor's "Saved · …" chip reads against the page clock the spec pins. */
export const SAVED_AT = '2026-10-20 09:00:00';

/**
 * The server's clock is pinned as the page's is (`_editor.mjs` NOW), so what
 * the Worker dates ("as of 5 Oct · out of date", a session's expiry) reads the
 * same on every run, on any day. Only `new Date()` and `Date.now()` move.
 */
export const NOW = Date.parse('2026-10-20T10:00:00Z');
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args: any[]) { if (args.length) super(...(args as [any])); else super(NOW); }
  static now() { return NOW; }
}
globalThis.Date = PinnedDate as DateConstructor;

/** Rate limits are not under test here: a counter that never counts past one. */
const noLimits = () => ({ async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } });

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error('[visual] docs/index.html is missing: run `npm run build` at the repo root first.');
  process.exit(1);
}

const db = migratedDatabase();
const venture = seedOneClickVenture(db);
// The founder finished onboarding, so the app's wizard gate lets them into the editor.
db.prepare("INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) VALUES (?, 'founder', 3, 3, '2026-09-01 09:00:00')").run(venture.founderUserId);
const env: any = {
  JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI: fakeAI(),
  RATE_LIMITS: noLimits(), TOKENS: memKV(), OAUTH_KV: memKV(), AI_SPEND: memKV(),
};
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const token = await createJWT(env, venture.founderUserId, `synthetic-${venture.founderUserId}@example.invalid`, 'founder');

/** One card per structure: a heading in the first area, then a line of body text, a figure, a list. */
function structureCard(s: typeof STRUCTURES[number], n: number) {
  const blocks = s.areas.map((a, i) => {
    const grid = { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 };
    if (i === 0) return { id: `b${i + 1}`, kind: 'text', style: 'heading', grid, text: s.label };
    if (a.role === 'metric' || (i % 3 === 1 && a.r2 - a.r1 >= 1)) return { id: `b${i + 1}`, kind: 'metric', grid, label: 'Synthetic figure', value: String(10 + i) };
    if (i % 3 === 2) return { id: `b${i + 1}`, kind: 'text', style: 'list', grid, text: 'First point\nSecond point' };
    return { id: `b${i + 1}`, kind: 'text', style: 'paragraph', grid, text: `${s.use}.` };
  });
  return { layout: 'title', title: `${n}. ${s.label}`, structure: s.id, areas: s.areas, blocks, notes: '' };
}

const THEMES = Object.keys(BASE_THEMES);
const matrix: Array<{ projectId: number; theme: string; aspect: string; deckId: number }> = [];
let nextProject = 100;
let nextDeck = 1000;
for (const theme of THEMES) {
  for (const aspect of ASPECTS) {
    const projectId = nextProject++;
    const deckId = nextDeck++;
    db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(projectId, `Synthetic ${theme} ${aspect}`, venture.founderId);
    db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, created_by, created_at, theme_json) VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?)')
      .run(deckId, projectId, 'Every structure', JSON.stringify(STRUCTURES.map((s, i) => structureCard(s, i + 1))), venture.founderUserId, SAVED_AT,
        JSON.stringify({ kind: theme, background: null, ...(aspect === '4:3' ? { aspect } : {}) }));
    matrix.push({ projectId, theme, aspect, deckId });
  }
}

/** One call to the real Worker, as the browser would make it. */
async function api(method: string, path: string, body?: unknown) {
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, ctx);
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`[visual] ${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// The one-click build, then Accept, on the fake binding.
const brief = await api('GET', `/api/decks/new/context?project_id=${ONE_CLICK.projectId}`);
const pickBrief = brief.inferred ? { audience: brief.inferred.audience, length: brief.inferred.length } : brief.fast_path;
const built = await api('POST', '/api/decks/generate', { project_id: ONE_CLICK.projectId, ...pickBrief });
const accepted = await api('POST', `/api/decks/proposals/${built.proposal.id}/keep-slides`, { all: true, save: true });
db.prepare('UPDATE pitch_decks SET created_at = ? WHERE project_id = ?').run(SAVED_AT, ONE_CLICK.projectId);
const oneClick = { projectId: ONE_CLICK.projectId, deckId: accepted.deck.id, cards: accepted.deck.slides.length, theme: 'neutral_light', aspect: '16:9' };

const me = await api('GET', '/api/auth/me').catch(() => null);
const manifest = { token, user: me ?? { id: venture.founderUserId, role: 'founder', founder_id: venture.founderId }, themes: THEMES, aspects: ASPECTS, structures: STRUCTURES.map((s) => s.id), matrix, oneClick };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', ORIGIN);
    if (url.pathname === '/__visual/manifest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(manifest));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const out = await worker.fetch(new Request(`${ORIGIN}${url.pathname}${url.search}`, {
        method: req.method, headers, ...(chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}),
      }), env, ctx);
      const head: Record<string, string> = {};
      out.headers.forEach((v, k) => { head[k] = v; });
      res.writeHead(out.status, head);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    // The SPA: a file under docs/ when there is one, else the shell (Workers' single-page-application fallback).
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(DOCS, rel);
    if (!file.startsWith(DOCS) || !existsSync(file) || statSync(file).isDirectory()) {
      const index = join(DOCS, rel, 'index.html');
      file = file.startsWith(DOCS) && existsSync(index) && !url.pathname.startsWith('/raise') ? index : join(DOCS, 'index.html');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) {
    // The trace goes to the runner's log, never into the reply.
    console.error('[visual] request failed', e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('The visual test server could not answer this request.');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[visual] serving docs/ and the Worker on ${ORIGIN}; ${matrix.length} matrix ventures, one-click deck ${oneClick.deckId} (${oneClick.cards} cards)`));
