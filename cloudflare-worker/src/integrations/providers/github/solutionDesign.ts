/**
 * D782 (#2114) — GitHub feeds Build › Solution design.
 *
 * Per chosen repository, under the App's Contents and Metadata reads (no new
 * permission):
 *   - `README.md` (`GET /repos/{o}/{r}/readme`);
 *   - Markdown files under `docs/`, `doc/`, `adr/` and `docs/adr/`, at most
 *     MAX_DESIGN_FILES files and MAX_DESIGN_BYTES in all, newest first;
 *   - `GET /repos/{o}/{r}/languages`, and the repository's topics.
 *
 * THE STACK IS FACTS. Languages by bytes and topics are written to
 * `solution_design_stack`, one row per repository, linked through the
 * `connector_fed_items` ledger (`'solution_design', 'stack'`); Solution design
 * shows them as "Built with".
 *
 * ARCHITECTURE IS PROPOSED, NEVER WRITTEN (D782 rule 2). Each ADR file, and
 * each README or docs section headed Architecture, Design or Decisions, is a
 * row in `solution_design_proposals`: its title, its own first paragraph as
 * the extract, and the file's link. No model reads the files. The founder
 * accepts one, which writes a `solution_design_notes` row citing the file and
 * its ledger row (`'solution_design', 'design_note'`), or dismisses it. A
 * re-sync compares the section's SHA-256: the same text leaves the row as it
 * is, so a dismissed proposal stays dismissed; changed text proposes it again.
 *
 * Repository text is untrusted: it is stored and drawn as text, never HTML.
 *
 * NO SIDE EFFECTS, AND NO IMPORT OF `../github`: the sync hands in its own
 * authenticated GET, so the Build route can import the read, Accept and
 * Dismiss below without registering the provider.
 */
import type { Env } from '../../../types';

export const DESIGN_DIRS = ['docs', 'doc', 'adr', 'docs/adr'] as const;
const ADR_DIRS = new Set<string>(['adr', 'docs/adr']);
export const MAX_DESIGN_FILES = 40;
export const MAX_DESIGN_BYTES = 200 * 1024;
/** At most this many Markdown files per repository are dated when the caps bite. */
const MAX_DATED = 100;
const MAX_LANGUAGES = 20;
const MAX_TOPICS = 20;
const TITLE_CHARS = 200;
const EXTRACT_CHARS = 400;
const DESIGN_HEADING = /^(architecture|design|decisions?)\b/i;
const MARKDOWN = /\.(md|markdown)$/i;
// A GitHub fetch, a D1 read or a D1 batch is one Worker subrequest. A
// repository's fixed cost: the repository, its languages, the stack's batch,
// the README, the four directories, the proposals' read and their batch.
const REPO_SETUP_COST = 10;

/** The sync's authenticated GET (`github.ts`'s `gh` with its token). */
export type GithubGet = (path: string) => Promise<Response>;

export interface DesignProposal { path: string; anchor: string; title: string; extract: string; text: string }
interface MarkdownFile { path: string; size: number; url: string | null; adr: boolean; date: string | null }

// ───────────────────────────────────────────────────────────── Markdown, pure

interface Section { level: number; heading: string; body: string }

/** The ATX headings and what follows each, up to the next heading of the same or a higher level. Fenced code is not read for headings. */
export function markdownSections(md: string): Section[] {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const heads: { at: number; level: number; heading: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, at) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { fence = fence === null ? f[1][0] : (f[1][0] === fence ? null : fence); return; }
    if (fence !== null) return;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h && h[2]) heads.push({ at, level: h[1].length, heading: h[2].trim() });
  });
  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find((x) => x.level <= h.level);
    return { level: h.level, heading: h.heading, body: lines.slice(h.at + 1, next ? next.at : lines.length).join('\n') };
  });
}

/** The first paragraph of prose: no heading, no fence, no HTML comment; whitespace collapsed; cut at EXTRACT_CHARS. */
export function firstParagraph(text: string): string {
  const out: string[] = [];
  let fence = false;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (/^(`{3,}|~{3,})/.test(line)) { if (out.length) break; fence = !fence; continue; }
    if (fence) continue;
    if (!line) { if (out.length) break; continue; }
    if (/^#{1,6}\s/.test(line) || /^<!--.*-->$/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) { if (out.length) break; continue; }
    out.push(line);
  }
  const words = out.join(' ').replace(/\s+/g, ' ').trim();
  return words.length > EXTRACT_CHARS ? `${words.slice(0, EXTRACT_CHARS - 1).trimEnd()}…` : words;
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
export function headingAnchor(heading: string): string {
  return String(heading ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What one Markdown file proposes. An ADR file is one proposal: its first
 * heading (else its file name) and its first paragraph after it. Any other
 * file proposes each section headed Architecture, Design or Decisions.
 */
export function designProposals(path: string, md: string, adr: boolean): DesignProposal[] {
  const sections = markdownSections(md);
  if (adr) {
    const top = sections[0];
    const name = path.split('/').pop()!.replace(MARKDOWN, '');
    const title = cut(top?.heading || name, TITLE_CHARS);
    const extract = firstParagraph(top ? top.body : md);
    return [{ path, anchor: '', title, extract, text: String(md ?? '') }];
  }
  return sections.filter((s) => DESIGN_HEADING.test(s.heading)).map((s) => ({
    path, anchor: headingAnchor(s.heading), title: cut(s.heading, TITLE_CHARS), extract: firstParagraph(s.body), text: `${s.heading}\n${s.body}`,
  }));
}

/**
 * Which files are read: every one when they fit the caps; otherwise the
 * newest first (an undated file last), each taken while it still fits.
 */
export function chooseDesignFiles<T extends { size: number; date: string | null }>(files: T[]): T[] {
  const fits = files.length <= MAX_DESIGN_FILES && files.reduce((n, f) => n + f.size, 0) <= MAX_DESIGN_BYTES;
  if (fits) return files;
  const newest = [...files].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const out: T[] = [];
  let bytes = 0;
  for (const f of newest) {
    if (out.length >= MAX_DESIGN_FILES) break;
    if (bytes + f.size > MAX_DESIGN_BYTES) continue;
    out.push(f); bytes += f.size;
  }
  return out;
}

/** Languages by bytes, largest first, each with its share; GitHub's own figures. */
export function stackLanguages(raw: unknown): { name: string; bytes: number }[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([name, bytes]) => name && typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0)
    .map(([name, bytes]) => ({ name: cut(name, 60), bytes: bytes as number }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, MAX_LANGUAGES);
}

export function stackTopics(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => cut(t, 50)).slice(0, MAX_TOPICS);
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeContent(body: any): string | null {
  if (!body || body.encoding !== 'base64' || typeof body.content !== 'string') return null;
  try {
    const bin = atob(body.content.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch { return null; }
}

// ───────────────────────────────────────────────────────────── the sync

const UPSERT_STACK = `INSERT INTO solution_design_stack (integration_id, project_id, repository, languages_json, topics_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, repository) DO UPDATE SET
       languages_json = excluded.languages_json, topics_json = excluded.topics_json, updated_at = CURRENT_TIMESTAMP`;
const LEDGER_STACK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, 'solution_design', 'stack', ?, 'solution_design_stack',
       (SELECT id FROM solution_design_stack WHERE integration_id = ? AND project_id = ? AND repository = ?))
     ON CONFLICT(integration_id, external_id) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`;
const PROPOSALS_OF_REPO =
  'SELECT source_key, fingerprint FROM solution_design_proposals WHERE integration_id = ? AND project_id = ? AND repository = ?';
const INSERT_PROPOSAL = `INSERT INTO solution_design_proposals (integration_id, project_id, repository, path, source_key, fingerprint, title, extract, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
// Changed text proposes again, whatever was decided before; the note an earlier Accept wrote stays.
const REPROPOSE = `UPDATE solution_design_proposals SET fingerprint = ?, title = ?, extract = ?, url = ?, status = 'pending',
       note_id = NULL, decided_by = NULL, decided_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE integration_id = ? AND project_id = ? AND source_key = ?`;
// A pending proposal whose section is gone is withdrawn; a decided one is history and stays.
const WITHDRAW_GONE = `DELETE FROM solution_design_proposals
     WHERE integration_id = ? AND project_id = ? AND repository = ? AND status = 'pending'
       AND source_key NOT IN (SELECT value FROM json_each(?))`;

/**
 * Reads each chosen repository's design files and stack, within `budget`
 * subrequests. Returns its figures for the sync's counts: `design_proposals`
 * (new or changed), `stacks` (repositories whose stack was written), and
 * `partial` when the budget stopped it.
 */
export async function syncSolutionDesign(
  env: Env, integrationId: number, projectId: number, get: GithubGet, repos: string[], budget: number,
): Promise<Record<string, number | boolean>> {
  const counts: Record<string, number | boolean> = { design_proposals: 0, stacks: 0 };
  let left = budget;
  const spend = (n: number) => { if (left < n) return false; left -= n; return true; };
  const json = async (path: string, missing: 'null' | 'throw' = 'throw'): Promise<any> => {
    const res = await get(path);
    if (res.status === 404 && missing === 'null') return null;
    if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${path.split('?')[0]}`);
    return res.json();
  };
  for (const repo of repos) {
    if (!spend(REPO_SETUP_COST)) { counts.partial = true; break; }
    const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
    const contents = (p: string) => `${path}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

    // A repository GitHub no longer serves feeds nothing here; the issue and pull request reads say why.
    const meta = await json(path, 'null');
    if (!meta) continue;
    // The stack: facts, through the ledger.
    const languages = stackLanguages(await json(`${path}/languages`, 'null'));
    await env.DB.batch([
      env.DB.prepare(UPSERT_STACK).bind(integrationId, projectId, repo, JSON.stringify(languages), JSON.stringify(stackTopics(meta?.topics))),
      env.DB.prepare(LEDGER_STACK).bind(integrationId, projectId, `stack:${projectId}:${repo}`, integrationId, projectId, repo),
    ]);
    counts.stacks = Number(counts.stacks) + 1;

    // The files: the README, then each design directory's Markdown.
    const readme = await json(`${path}/readme`, 'null');
    const files: MarkdownFile[] = [];
    for (const dir of DESIGN_DIRS) {
      const list = await json(contents(dir), 'null');
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (f?.type !== 'file' || typeof f.path !== 'string' || !MARKDOWN.test(f.path) || files.some((x) => x.path === f.path)) continue;
        files.push({ path: f.path, size: Number(f.size) || 0, url: typeof f.html_url === 'string' ? f.html_url : null, adr: ADR_DIRS.has(dir), date: null });
      }
    }
    const capped = !(files.length <= MAX_DESIGN_FILES && files.reduce((n, f) => n + f.size, 0) <= MAX_DESIGN_BYTES);
    if (capped) {
      for (const f of files.slice(0, MAX_DATED)) {
        if (!spend(1)) break;
        const last = await json(`${path}/commits?path=${encodeURIComponent(f.path)}&per_page=1`, 'null');
        f.date = typeof last?.[0]?.commit?.committer?.date === 'string' ? last[0].commit.committer.date : null;
      }
    }
    const proposals: (DesignProposal & { url: string | null })[] = [];
    const readmeText = readme && Number(readme.size) <= MAX_DESIGN_BYTES ? decodeContent(readme) : null;
    if (readmeText !== null) {
      const at = typeof readme.path === 'string' ? readme.path : 'README.md';
      for (const d of designProposals(at, readmeText, false)) proposals.push({ ...d, url: typeof readme.html_url === 'string' ? readme.html_url : null });
    }
    let read = 0, stopped = false;
    for (const f of chooseDesignFiles(capped ? files.slice(0, MAX_DATED) : files)) {
      if (!spend(1)) { stopped = true; break; }
      const text = decodeContent(await json(contents(f.path), 'null'));
      if (text === null) continue;
      // The listing's sizes chose the files; what was read is what counts against the cap.
      const bytes = new TextEncoder().encode(text).length;
      if (read + bytes > MAX_DESIGN_BYTES) continue;
      read += bytes;
      for (const d of designProposals(f.path, text, f.adr)) proposals.push({ ...d, url: f.url });
    }

    // The proposals: new ones pending, changed ones pending again, unchanged ones as they are.
    const seen = new Map<string, { fingerprint: string; p: (typeof proposals)[number] }>();
    for (const p of proposals) {
      const key = `${repo}:${p.path}${p.anchor ? `#${p.anchor}` : ''}`;
      if (!seen.has(key)) seen.set(key, { fingerprint: await sha256(p.text), p });
    }
    const held = new Map(((await env.DB.prepare(PROPOSALS_OF_REPO).bind(integrationId, projectId, repo)
      .all<{ source_key: string; fingerprint: string }>()).results || []).map((r) => [r.source_key, r.fingerprint]));
    const stmts: D1PreparedStatement[] = [];
    for (const [key, { fingerprint, p }] of seen) {
      const link = p.url ? `${p.url}${p.anchor ? `#${p.anchor}` : ''}` : null;
      if (!held.has(key)) stmts.push(env.DB.prepare(INSERT_PROPOSAL).bind(integrationId, projectId, repo, p.path, key, fingerprint, p.title, p.extract || null, link));
      else if (held.get(key) !== fingerprint) stmts.push(env.DB.prepare(REPROPOSE).bind(fingerprint, p.title, p.extract || null, link, integrationId, projectId, key));
      else continue;
      counts.design_proposals = Number(counts.design_proposals) + 1;
    }
    // Only a complete read of the repository may withdraw what it no longer holds.
    if (!stopped) stmts.push(env.DB.prepare(WITHDRAW_GONE).bind(integrationId, projectId, repo, JSON.stringify([...seen.keys()])));
    if (stmts.length) await env.DB.batch(stmts);
    if (stopped) { counts.partial = true; break; }
  }
  return counts;
}

// ───────────────────────────────────────────────────────────── the module

/** What Solution design shows from code: Built with, the pending proposals, the accepted notes. */
export async function solutionDesignFromCode(env: Env, projectId: number) {
  const stacks = (await env.DB.prepare(
    `SELECT s.repository, s.languages_json, s.topics_json, s.updated_at
       FROM solution_design_stack s
       JOIN connector_fed_items l ON l.local_table = 'solution_design_stack' AND l.local_id = s.id AND l.kind = 'stack'
       JOIN integrations i ON i.id = s.integration_id
      WHERE s.project_id = ? ORDER BY s.repository`,
  ).bind(projectId).all<any>()).results || [];
  const proposals = (await env.DB.prepare(
    `SELECT id, repository, path, title, extract, url, created_at, updated_at FROM solution_design_proposals
      WHERE project_id = ? AND status = 'pending' ORDER BY updated_at DESC, id DESC LIMIT 100`,
  ).bind(projectId).all<any>()).results || [];
  const notes = (await env.DB.prepare(
    'SELECT id, title, body, source_url, source_path, created_at FROM solution_design_notes WHERE project_id = ? ORDER BY id DESC LIMIT 100',
  ).bind(projectId).all<any>()).results || [];
  const parse = (raw: string, fallback: unknown[]) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : fallback; } catch { return fallback; } };
  return {
    built_with: stacks.map((s) => {
      const languages = stackLanguages(Object.fromEntries(parse(s.languages_json, []).map((l: any) => [l?.name, l?.bytes])));
      const total = languages.reduce((n, l) => n + l.bytes, 0);
      return {
        repository: s.repository,
        languages: languages.map((l) => ({ ...l, pct: total ? Math.round((l.bytes / total) * 1000) / 10 : 0 })),
        topics: stackTopics(parse(s.topics_json, [])),
        updated_at: s.updated_at,
        source_label: 'From GitHub',
      };
    }),
    proposals: proposals.map((p) => ({ id: p.id, repository: p.repository, path: p.path, title: p.title, extract: p.extract ?? null, url: safeGithubUrl(p.url) })),
    notes: notes.map((n) => ({ id: n.id, title: n.title, body: n.body ?? null, source_url: safeGithubUrl(n.source_url), source_path: n.source_path ?? null, created_at: n.created_at })),
  };
}

/** A link is drawn only when it is GitHub's own https page. */
export function safeGithubUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? ''));
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

export type DecideOutcome = 'ok' | 'not_found' | 'decided';

async function outcomeOf(env: Env, projectId: number, id: number): Promise<DecideOutcome> {
  const row = await env.DB.prepare('SELECT status FROM solution_design_proposals WHERE id = ? AND project_id = ?').bind(id, projectId).first<{ status: string }>();
  return row ? 'decided' : 'not_found';
}

/**
 * Accept: the proposal is claimed (pending → accepted, once), then its note,
 * the note's id on the proposal and the note's ledger row are written in one
 * batch with `extra` (the activity line). A failed batch hands the claim back.
 */
export async function acceptDesignProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const claim = await env.DB.prepare(
    `UPDATE solution_design_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!claim.meta?.changes) return outcomeOf(env, projectId, id);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO solution_design_notes (project_id, proposal_id, title, body, source_url, source_path, created_by)
          SELECT project_id, id, title, extract, url, repository || '/' || path, ? FROM solution_design_proposals WHERE id = ?`).bind(userId, id),
      env.DB.prepare('UPDATE solution_design_proposals SET note_id = last_insert_rowid() WHERE id = ?').bind(id),
      env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
          VALUES ((SELECT integration_id FROM solution_design_proposals WHERE id = ?), ?, 'solution_design', 'design_note',
                  (SELECT 'design_note:' || project_id || ':' || source_key || '@' || substr(fingerprint, 1, 16) FROM solution_design_proposals WHERE id = ?),
                  'solution_design_notes', (SELECT note_id FROM solution_design_proposals WHERE id = ?))
          ON CONFLICT(integration_id, external_id) DO UPDATE SET
            last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`).bind(id, projectId, id, id),
      ...extra,
    ]);
  } catch (e) {
    await env.DB.prepare(`UPDATE solution_design_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ? AND status = 'accepted' AND note_id IS NULL`).bind(id).run();
    throw e;
  }
  return 'ok';
}

/** Dismiss: pending → dismissed, once. It comes back only if its text changes. */
export async function dismissDesignProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const r = await env.DB.prepare(
    `UPDATE solution_design_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!r.meta?.changes) return outcomeOf(env, projectId, id);
  if (extra.length) await env.DB.batch(extra);
  return 'ok';
}
