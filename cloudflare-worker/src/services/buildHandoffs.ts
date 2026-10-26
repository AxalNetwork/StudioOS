/**
 * D1068 (#2938, part 5 of #2426): Send to… and Back in.
 *
 * OUT. The founder presses Send to… on accepted plan items. The text is built
 * here, on the server, from what the plan holds (the item's accepted payload,
 * its evidence labels, the brief), never from a transcript, a quote or a
 * pending proposal. It runs the shared privacy check (`lintForSend`, with
 * #2411's name fix) as `public`, because it leaves StudioOS, and records one
 * `build_handoffs` row. What comes back is a link the founder opens or text
 * they copy. Nothing is sent by StudioOS on its own, and no AI sends.
 *
 *   lovable  one prompt for the items, opened as Lovable's prompt link
 *   github   one pre-filled "new issue" link per item, into a repository the
 *            founder picked on the GitHub connector (owner question 4, A);
 *            without one, the issues as Markdown to copy
 *   notion   one Markdown page per item, to copy or download (question 5, A)
 *   vercel   Vercel's import page for a picked repository; no text
 *
 * THE MARKER. Every text carries "Axal VC plan item VB-…" for each item, the
 * item's own `build_plan_items.marker` (question 6, A).
 *
 * BACK IN. D782's feed reads a marker in an issue's or a pull request's body
 * (`markerLinks`). A known marker, on an accepted item that landed, turns the
 * fed item into a link proposal (an `ai_rail_proposals` row, `source_kind =
 * 'connector'`, the fed item as `source_ref`) instead of a new row. Accept
 * links it; Dismiss lets the next sync land it as its own row.
 *
 * Logs keep ids and codes, never text.
 */
import type { Env, User } from '../types';
import { lintForSend } from './telegramRedactCheck';
import { logCycleWriteStatement, type BuildModuleSlug } from './cycleActivity';
import { PlanItemError, assertFounder, loadItem } from './buildPlanAccept';
import { SEEN_KEY, currentPlan } from './buildPlanner';
import { latestWording } from './buildPlanWord';

export const PROVIDERS = ['lovable', 'github', 'notion', 'vercel'] as const;
export type Provider = typeof PROVIDERS[number];
/** At most this many items in one Send. */
export const HANDOFF_ITEMS_MAX = 50;
/** Lovable's prompt box, as VB6 counts it. */
export const LOVABLE_PROMPT_MAX = 4000;
/** The rail option a link proposal is filed under. */
export const LINK_OPTION = 'link:build/plan';
export const MARKER_LINE = 'Axal VC plan item';
const MARKER_RE = /\bVB-[0-9A-F]{32}\b/g;
const ITEM_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const FED = /^(issue|pull):[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#[1-9][0-9]{0,9}$/;
const PROVIDER_WORDS: Record<Provider, string> = { lovable: 'Lovable', github: 'GitHub', notion: 'Notion', vercel: 'Vercel' };

const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return null; } };

type Ref = { kind: string; ref: string; label: string; source_label?: string };
type SendItem = { uid: string; module: string; kind: string; marker: string; landed_table: string; landed_id: string; payload: Record<string, any>; evidence: Ref[] };

// ─────────────────────────────────────────────── the texts

/** The markers a text names, in order, each once. */
export function markersIn(text: unknown): string[] {
  return [...new Set(String(text ?? '').match(MARKER_RE) || [])];
}

const line = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** The evidence lines an item carries out. Never the decision: only the founders read it (D693). */
function evidenceLines(item: SendItem): string[] {
  return item.evidence.filter(e => e.kind !== 'decision' && line(e.label))
    .map(e => `- ${line(e.label)}${e.source_label ? ` · ${line(e.source_label)}` : ''}`);
}

/** One item as an issue: its title, and a body of its detail, its evidence and its marker. */
export function issueText(item: SendItem): { title: string; body: string } {
  const p = item.payload;
  const detail = [p.description, p.target ? `Target: ${line(p.target)}` : null, p.method ? `Method: ${line(p.method)}` : null, p.mitigation]
    .map(line).filter(Boolean);
  const evidence = evidenceLines(item);
  const body = [
    ...(detail.length ? [detail.join('\n')] : []),
    ...(evidence.length ? [`Why this is on the plan (from Validate):\n${evidence.join('\n')}`] : []),
    `${MARKER_LINE} ${item.marker}`,
  ].join('\n\n');
  return { title: line(p.title) || 'Plan item', body };
}

/** One item as a Notion page in Markdown. */
export function pageText(item: SendItem): string {
  const { title, body } = issueText(item);
  return `# ${title}\n\n${body}`;
}

/**
 * The Lovable prompt: the founder's kept wording when there is one (D1071),
 * else the rule's opening, then the brief and the items, then one marker line
 * per item.
 */
export function lovableText(items: SendItem[], brief: any, keptPrompt: string | null): string {
  const labels = (list: unknown) => (Array.isArray(list) ? list : []).map((x: any) => line(x?.label)).filter(Boolean).join('; ');
  const pos = brief?.positioning && typeof brief.positioning === 'object' ? brief.positioning : {};
  const briefLines = [
    labels(brief?.audience) && `For: ${labels(brief?.audience)}`,
    labels(brief?.problems) && `Problem: ${labels(brief?.problems)}`,
    line(pos.valueProp) && `Promise: ${line(pos.valueProp)}`,
    line(pos.differentiator) && `Different because: ${line(pos.differentiator)}`,
    labels(brief?.replaces) && `Replaces: ${labels(brief?.replaces)}`,
  ].filter(Boolean);
  const build = items.map(i => `- ${line(i.payload.title) || 'Plan item'}${i.payload.target ? ` (test: ${line(i.payload.target)})` : ''}`);
  return [
    line(keptPrompt) || 'Build a clickable prototype that lets the people below try what is listed under Build.',
    ...(briefLines.length ? [briefLines.join('\n')] : []),
    `Build:\n${build.join('\n')}`,
    items.map(i => `${MARKER_LINE} ${i.marker}`).join('\n'),
  ].join('\n\n');
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The privacy check on every text at once. A finding names its kind and which
 * text it is in, never the matched words: the founder fixes the item, and the
 * response never repeats what was caught.
 */
async function privacyCheck(env: Env, texts: { key: string; text: string }[]) {
  const sep = '\n\n';
  // The markers are StudioOS's own: their 32 hex digits would read as a phone or card number,
  // so each is scanned as a same-length placeholder, which keeps every offset where it was.
  const joined = texts.map(t => t.text).join(sep).replace(MARKER_RE, m => `VB-${'x'.repeat(m.length - 3)}`);
  const res = await lintForSend(env, joined, 'public');
  if (res.ok) return;
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) { starts.push(at); at += t.text.length + sep.length; }
  const where = (offset?: number) => {
    if (offset == null) return null;
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= offset) k++;
    return texts[k]?.key ?? null;
  };
  const findings = res.findings.map(f => ({ kind: f.kind, in: where(f.offset) }));
  throw new PlanItemError('pii_found', 422,
    'This text holds an email, a phone number, a person’s name or another private detail, so it was not sent. Edit the item and send again.',
    { findings });
}

// ─────────────────────────────────────────────── Send to…

/** The repositories the founder picked on their GitHub connection for this venture. */
async function pickedRepositories(env: Env, userId: number, projectId: number): Promise<string[]> {
  const rows = await env.DB.prepare(`SELECT config_json FROM integrations WHERE user_id = ? AND provider_key = 'github' AND status != 'disconnected'`)
    .bind(userId).all<{ config_json: string | null }>();
  const out: string[] = [];
  for (const r of rows.results || []) {
    const cfg = parse(r.config_json) || {};
    if (Number(cfg.project_id) !== projectId || !Array.isArray(cfg.repositories)) continue;
    for (const repo of cfg.repositories) if (typeof repo === 'string') out.push(repo);
  }
  return out;
}

/** The accepted, landed items the founder named, on this venture's current plan, in the order named. */
async function sendItems(env: Env, projectId: number, scope: string, uids: unknown): Promise<SendItem[]> {
  if (!Array.isArray(uids) || !uids.length || uids.length > HANDOFF_ITEMS_MAX || !uids.every(u => typeof u === 'string' && ITEM_UID.test(u))) {
    throw new PlanItemError('invalid_handoff', 400, `Choose between 1 and ${HANDOFF_ITEMS_MAX} accepted items to send.`);
  }
  const plan = await currentPlan(env, projectId, scope);
  if (!plan) throw new PlanItemError('no_plan', 409, 'Prepare the plan first. Only accepted items are sent.');
  if (plan.status === 'paused') throw new PlanItemError('plan_paused', 409, 'The plan is paused. Record a new decision to resume.');
  const out: SendItem[] = [];
  for (const uid of [...new Set(uids as string[])]) {
    const item = await loadItem(env, uid);
    // The route already admitted only this venture's founders; an item of another venture is refused.
    if (!item || item.project_id !== projectId) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
    if (!['accepted', 'edited'].includes(item.status) || !item.landed_table || !item.landed_id) {
      throw new PlanItemError('not_accepted', 409, 'Only accepted items are sent. Accept this item first.');
    }
    if (item.kind === 'connect-door') throw new PlanItemError('not_accepted', 409, 'A Connect door is not sent to a tool. Open it to connect the tool.');
    out.push({ uid: item.uid, module: item.module, kind: item.kind, marker: item.marker, landed_table: item.landed_table, landed_id: item.landed_id,
      payload: parse(item.decided_payload_json || item.payload_json) || {}, evidence: parse(item.evidence_json) || [] });
  }
  return out;
}

type HandoffRow = { provider: Provider; items: SendItem[]; target: string | null; text: string | null; marker: string | null };

function handoffStatement(env: Env, userId: number, projectId: number, row: HandoffRow, uid: string, hash: string | null) {
  const modules = [...new Set(row.items.map(i => i.module))];
  const one = row.items.length === 1 ? row.items[0] : null;
  return env.DB.prepare(`INSERT INTO build_handoffs (uid, project_id, provider, module, record_table, record_id, plan_item_uids, target, prompt_text, prompt_chars, text_hash, marker, opened_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL)`)
    .bind(uid, projectId, row.provider, modules.length === 1 ? modules[0] : null, one?.landed_table ?? null, one?.landed_id ?? null,
      JSON.stringify(row.items.map(i => i.uid)), row.target, row.text, row.text == null ? null : row.text.length, hash, row.marker, userId, projectId);
}

/**
 * POST /api/cycles/build/plan/handoffs: one press of Send to…. Every check
 * runs before anything is written; the rows and the activity line are one
 * batch.
 */
export async function sendHandoff(env: Env, user: User, projectId: number, scope: string, body: any) {
  const provider = String(body?.provider ?? '') as Provider;
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new PlanItemError('invalid_handoff', 400, 'Choose Lovable, GitHub, Notion or Vercel.');
  const items = await sendItems(env, projectId, scope, body?.items);
  let repository: string | null = null;
  if (body?.repository != null && body.repository !== '') {
    if (typeof body.repository !== 'string' || !REPO.test(body.repository)) throw new PlanItemError('invalid_handoff', 400, 'Choose a repository as owner/name.');
    repository = body.repository;
  }
  if (provider === 'vercel' && !repository) throw new PlanItemError('invalid_handoff', 400, 'Choose the repository Vercel imports.');
  if ((provider === 'github' || provider === 'vercel') && repository && !(await pickedRepositories(env, user.id, projectId)).includes(repository)) {
    throw new PlanItemError('repository_not_picked', 403, 'Pick this repository on your GitHub connection first.');
  }

  const rows: HandoffRow[] = [];
  const out: Record<string, unknown> = { provider };
  if (provider === 'lovable') {
    const plan = await currentPlan(env, projectId, scope);
    const brief = parse(plan?.brief_json) || {};
    delete brief[SEEN_KEY];
    const wording = plan ? await latestWording(env, user.id, { id: plan.id, uid: plan.uid, status: plan.status }) : null;
    const text = lovableText(items, brief, wording?.kept?.prompt ?? null);
    if (text.length > LOVABLE_PROMPT_MAX) {
      throw new PlanItemError('too_long', 422, `The prompt is ${text.length} characters; Lovable takes ${LOVABLE_PROMPT_MAX}. Send fewer items.`, { prompt_chars: text.length, max: LOVABLE_PROMPT_MAX });
    }
    await privacyCheck(env, [{ key: 'prompt', text }]);
    rows.push({ provider, items, target: 'lovable.dev', text, marker: items.map(i => i.marker).join(' ') });
    // Lovable's "Build with URL" link: the prompt rides in the fragment, which is never sent to a server.
    Object.assign(out, { text, prompt_chars: text.length, link: `https://lovable.dev/?autosubmit=true#prompt=${encodeURIComponent(text)}` });
  } else if (provider === 'github') {
    const issues = items.map(i => ({ item: i, ...issueText(i) }));
    await privacyCheck(env, issues.map(x => ({ key: x.item.uid, text: `${x.title}\n\n${x.body}` })));
    for (const x of issues) rows.push({ provider, items: [x.item], target: repository, text: `${x.title}\n\n${x.body}`, marker: x.item.marker });
    out.issues = issues.map(x => ({
      plan_item_uid: x.item.uid, marker: x.item.marker, title: x.title, body: x.body,
      url: repository ? `https://github.com/${repository}/issues/new?title=${encodeURIComponent(x.title)}&body=${encodeURIComponent(x.body)}` : null,
    }));
    out.markdown = issues.map(x => `## ${x.title}\n\n${x.body}`).join('\n\n---\n\n');
    out.repository = repository;
  } else if (provider === 'notion') {
    const pages = items.map(i => ({ item: i, text: pageText(i) }));
    await privacyCheck(env, pages.map(p => ({ key: p.item.uid, text: p.text })));
    const markdown = pages.map(p => p.text).join('\n\n---\n\n');
    rows.push({ provider, items, target: null, text: markdown, marker: items.map(i => i.marker).join(' ') });
    Object.assign(out, { markdown, pages: pages.map(p => ({ plan_item_uid: p.item.uid, marker: p.item.marker, markdown: p.text })) });
  } else {
    // Vercel takes no text, so it carries no marker: a deploy is read back through the linked must-have.
    rows.push({ provider, items, target: repository, text: null, marker: null });
    Object.assign(out, { repository, link: `https://vercel.com/new/import?s=${encodeURIComponent(`https://github.com/${repository}`)}` });
  }

  const handoffs: { uid: string; plan_item_uids: string[]; marker: string | null }[] = [];
  const stmts = [];
  for (const row of rows) {
    const uid = crypto.randomUUID();
    stmts.push(handoffStatement(env, user.id, projectId, row, uid, row.text == null ? null : await sha256(row.text)));
    handoffs.push({ uid, plan_item_uids: row.items.map(i => i.uid), marker: row.marker });
  }
  stmts.push(logCycleWriteStatement(env, { projectId, userId: user.id, cycle: 'build', module: items[0].module as BuildModuleSlug, entityId: 'project',
    action: 'build_plan_handoff', summary: `${items.length === 1 ? 'Plan item' : `${items.length} plan items`} sent to ${PROVIDER_WORDS[provider]}` }));
  const results = await env.DB.batch(stmts);
  if (!results[0]?.meta?.changes) throw new PlanItemError('not_this_project', 404, 'This plan does not belong to this venture.');
  console.info('[build-handoff] recorded', { provider, handoffs: handoffs.length, items: items.length });
  return { ...out, handoffs };
}

/** The venture's handoffs, newest first. The text is the venture's team's only. */
export async function listHandoffs(env: Env, projectId: number, team: boolean) {
  const rows = (await env.DB.prepare(`SELECT uid, provider, module, record_table, record_id, plan_item_uids, target, prompt_text, prompt_chars, text_hash, marker, opened_at
    FROM build_handoffs WHERE project_id = ? ORDER BY opened_at DESC, id DESC LIMIT 200`).bind(projectId).all<any>()).results || [];
  return rows.map(r => ({
    uid: r.uid, provider: r.provider, module: r.module, record_table: r.record_table, record_id: r.record_id,
    plan_item_uids: parse(r.plan_item_uids) || [], target: r.target, prompt_chars: r.prompt_chars, text_hash: r.text_hash,
    markers: r.marker ? String(r.marker).split(' ') : [], opened_at: r.opened_at,
    ...(team ? { prompt_text: r.prompt_text } : {}),
  }));
}

// ─────────────────────────────────────────────── Back in

export type FedItem = { externalId: string; kind: 'issue' | 'pull_request'; title: string; body: unknown };
export type LinkTarget = { plan_item_uid: string; marker: string; module: string; landed_table: string; landed_id: string; title: string | null };

/**
 * The fed items on one page that name a known marker. A marker is known when
 * its item is on this venture and landed, which only an accepted item is. An item whose link the
 * founder dismissed lands as its own row. One read, or two when a marker is
 * found; none when no body names one.
 */
export async function markerLinks(env: Env, projectId: number, items: FedItem[]): Promise<{ links: Map<string, LinkTarget>; reads: number }> {
  const links = new Map<string, LinkTarget>();
  const named = items.map(i => ({ i, markers: markersIn(i.body) })).filter(x => x.markers.length);
  if (!named.length) return { links, reads: 0 };
  const markers = [...new Set(named.flatMap(x => x.markers))];
  const known = (await env.DB.prepare(`SELECT i.uid, i.marker, i.module, i.landed_table, i.landed_id,
      COALESCE(json_extract(q.decided_payload_json, '$.title'), json_extract(q.payload_json, '$.title')) AS title
    FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    WHERE i.project_id = ? AND i.marker IN (SELECT value FROM json_each(?))
      AND i.landed_table IS NOT NULL AND i.landed_id IS NOT NULL`).bind(projectId, JSON.stringify(markers)).all<any>()).results || [];
  if (!known.length) return { links, reads: 1 };
  const byMarker = new Map(known.map(k => [k.marker, k]));
  const candidates = named.filter(x => x.markers.some(m => byMarker.has(m)));
  const dismissed = new Set(((await env.DB.prepare(`SELECT source_ref FROM ai_rail_proposals
    WHERE record_ref = ? AND rail_option = ? AND status = 'discarded' AND source_ref IN (SELECT value FROM json_each(?))`)
    .bind(`project:${projectId}`, LINK_OPTION, JSON.stringify(candidates.map(x => x.i.externalId))).all<{ source_ref: string }>()).results || []).map(r => r.source_ref));
  for (const x of candidates) {
    if (dismissed.has(x.i.externalId)) continue;
    const k = byMarker.get(x.markers.find(m => byMarker.has(m))!)!;
    links.set(x.i.externalId, { plan_item_uid: k.uid, marker: k.marker, module: k.module, landed_table: k.landed_table, landed_id: String(k.landed_id), title: k.title ?? null });
  }
  return { links, reads: 2 };
}

/** A fed item's link proposal, filed for the connection's owner, the founder who connected it. */
export function linkProposalStatement(env: Env, userId: number, projectId: number, fed: FedItem, target: LinkTarget) {
  const payload = { plan_item_uid: target.plan_item_uid, marker: target.marker, provider: 'github', fed: fed.externalId, fed_kind: fed.kind,
    title: String(fed.title || '').slice(0, 300), landed_table: target.landed_table, landed_id: target.landed_id };
  return env.DB.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, source_kind, source_ref, source_label)
    SELECT ?, ?, 'Founder.Build.Plan', ?, ?, 'proposal', ?, 'connector', ?, 'Connector'
    WHERE NOT EXISTS (SELECT 1 FROM ai_rail_proposals WHERE record_ref = ? AND rail_option = ? AND source_ref = ? AND status IN ('proposed', 'accepted'))`)
    .bind(crypto.randomUUID(), userId, LINK_OPTION, `project:${projectId}`, JSON.stringify(payload), fed.externalId, `project:${projectId}`, LINK_OPTION, fed.externalId);
}

/**
 * The table the feed itself writes for a fed kind. A link re-points the
 * ledger only to a row of that table, so GitHub's updates (`github.ts`,
 * `github/mvp.ts`) never touch a row of another table.
 */
const FED_TABLE: Record<string, string> = { issue: 'roadmap_okrs', pull_request: 'mvp_features' };

/**
 * Points the fed item's ledger row at the plan's row, when it is unlinked, the
 * tables agree, and the link (`linkUid`) is the accepted one this batch wrote.
 */
function followStatement(env: Env, projectId: number, fed: string, fedKind: string, table: string, id: string, linkUid: string) {
  return env.DB.prepare(`UPDATE connector_fed_items SET local_table = ?, local_id = ?
    WHERE project_id = ? AND external_id = ? AND local_id IS NULL AND ? = ?
      AND EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ? AND status = 'accepted')`)
    .bind(table, Number(id), projectId, fed, FED_TABLE[fedKind] ?? '', table, linkUid);
}

type LinkRow = { uid: string; status: string; payload_json: string; source_ref: string; created_at: string; decided_at: string | null };

async function linkOf(env: Env, projectId: number, uid: string): Promise<LinkRow> {
  if (!ITEM_UID.test(uid)) throw new PlanItemError('not_this_project', 404, 'This link does not belong to this venture.');
  const row = await env.DB.prepare(`SELECT uid, status, payload_json, source_ref, created_at, decided_at FROM ai_rail_proposals
    WHERE uid = ? AND record_ref = ? AND rail_option = ?`).bind(uid, `project:${projectId}`, LINK_OPTION).first<LinkRow>();
  if (!row) throw new PlanItemError('not_this_project', 404, 'This link does not belong to this venture.');
  return row;
}

/** The plan item a link names, still accepted and landed, or marker_unknown. */
async function liveTarget(env: Env, user: User, projectId: number, itemUid: unknown) {
  const item = typeof itemUid === 'string' && ITEM_UID.test(itemUid) ? await loadItem(env, itemUid) : null;
  if (!item || item.project_id !== projectId || !['accepted', 'edited'].includes(item.status) || !item.landed_table || !item.landed_id) {
    throw new PlanItemError('marker_unknown', 409, 'The plan item this names is no longer accepted on this venture, so it cannot be linked.');
  }
  assertFounder(item, user);
  return item;
}

const view = (r: LinkRow) => {
  const p = parse(r.payload_json) || {};
  return { uid: r.uid, status: r.status, provider: p.provider ?? 'github', fed: r.source_ref, fed_kind: p.fed_kind ?? null, title: p.title ?? null,
    plan_item_uid: p.plan_item_uid ?? null, marker: p.marker ?? null, by: p.by ?? 'marker', created_at: r.created_at, decided_at: r.decided_at };
};

/** The venture's link proposals and links. A partner sees only what was linked. */
export async function listLinks(env: Env, projectId: number, partner: boolean) {
  const rows = (await env.DB.prepare(`SELECT uid, status, payload_json, source_ref, created_at, decided_at FROM ai_rail_proposals
    WHERE record_ref = ? AND rail_option = ? AND status IN ('proposed', 'accepted') AND (? = 0 OR status = 'accepted')
    ORDER BY id DESC LIMIT 200`).bind(`project:${projectId}`, LINK_OPTION, partner ? 1 : 0).all<LinkRow>()).results || [];
  return rows.map(view);
}

/** Link: the proposal is accepted, and the ledger follows the plan's row where the tables agree. */
export async function acceptLink(env: Env, user: User, projectId: number, uid: string) {
  const row = await linkOf(env, projectId, uid);
  if (row.status !== 'proposed') throw new PlanItemError('decided', 409, 'This link is already decided.');
  const p = parse(row.payload_json) || {};
  const item = await liveTarget(env, user, projectId, p.plan_item_uid);
  const [claim] = await env.DB.batch([
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'accepted', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status = 'proposed'`).bind(uid),
    followStatement(env, projectId, row.source_ref, String(p.fed_kind), item.landed_table!, item.landed_id!, uid),
    logCycleWriteStatement(env, { projectId, userId: user.id, cycle: 'build', module: item.module as BuildModuleSlug, entityId: 'project',
      action: 'build_plan_linked', summary: 'A GitHub item linked to the plan' }),
  ]);
  if (!claim.meta?.changes) throw new PlanItemError('decided', 409, 'This link is already decided.');
  return view((await linkOf(env, projectId, uid)));
}

/** Not this one: never proposed again, and the next sync lands the item as its own row. */
export async function dismissLink(env: Env, _user: User, projectId: number, uid: string) {
  const row = await linkOf(env, projectId, uid);
  if (row.status !== 'proposed') throw new PlanItemError('decided', 409, 'This link is already decided.');
  const [claim] = await env.DB.batch([
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'discarded', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND status = 'proposed'`).bind(uid),
    env.DB.prepare('DELETE FROM connector_fed_items WHERE project_id = ? AND external_id = ? AND local_id IS NULL').bind(projectId, row.source_ref),
  ]);
  if (!claim.meta?.changes) throw new PlanItemError('decided', 409, 'This link is already decided.');
  return view((await linkOf(env, projectId, uid)));
}

/**
 * Link by hand: a fed GitHub item with no marker, linked to an accepted item.
 * It is recorded as an accepted link. The ledger follows the plan's row only
 * when the item is unlinked; a row the feed already made stays as it is.
 */
export async function linkByHand(env: Env, user: User, itemUid: string, fed: unknown) {
  const item = await loadItem(env, itemUid);
  if (!item) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  assertFounder(item, user);
  if (!['accepted', 'edited'].includes(item.status) || !item.landed_table || !item.landed_id) {
    throw new PlanItemError('not_accepted', 409, 'Only an accepted item is linked. Accept this item first.');
  }
  if (typeof fed !== 'string' || !FED.test(fed)) throw new PlanItemError('invalid_handoff', 400, 'Choose a GitHub issue or pull request that arrived through your connection.');
  const ledger = await env.DB.prepare(`SELECT kind FROM connector_fed_items WHERE project_id = ? AND external_id = ? LIMIT 1`).bind(item.project_id, fed).first<{ kind: string }>();
  if (!ledger) throw new PlanItemError('not_this_project', 404, 'That GitHub item has not arrived on this venture.');
  const fedKind = fed.startsWith('issue:') ? 'issue' : 'pull_request';
  const taken = await env.DB.prepare(`SELECT 1 FROM ai_rail_proposals WHERE record_ref = ? AND rail_option = ? AND source_ref = ? AND status IN ('proposed', 'accepted') LIMIT 1`)
    .bind(`project:${item.project_id}`, LINK_OPTION, fed).first();
  if (taken) throw new PlanItemError('already_linked', 409, 'This GitHub item is already linked or waiting for your decision.');
  const uid = crypto.randomUUID();
  const payload = { plan_item_uid: item.uid, marker: item.marker, provider: 'github', fed, fed_kind: fedKind, title: null, by: 'hand', landed_table: item.landed_table, landed_id: item.landed_id };
  const [ins] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, source_kind, source_ref, source_label, status, decided_payload_json, decided_at)
      SELECT ?, ?, 'Founder.Build.Plan', ?, ?, 'proposal', ?, 'connector', ?, 'Connector', 'accepted', ?, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM ai_rail_proposals WHERE record_ref = ? AND rail_option = ? AND source_ref = ? AND status IN ('proposed', 'accepted'))`)
      .bind(uid, user.id, LINK_OPTION, `project:${item.project_id}`, JSON.stringify(payload), fed, JSON.stringify(payload), `project:${item.project_id}`, LINK_OPTION, fed),
    followStatement(env, item.project_id, fed, fedKind, item.landed_table, item.landed_id, uid),
    logCycleWriteStatement(env, { projectId: item.project_id, userId: user.id, cycle: 'build', module: item.module as BuildModuleSlug, entityId: 'project',
      action: 'build_plan_linked', summary: 'A GitHub item linked to the plan by hand' }),
  ]);
  if (!ins.meta?.changes) throw new PlanItemError('already_linked', 409, 'This GitHub item is already linked or waiting for your decision.');
  return view((await linkOf(env, item.project_id, uid)));
}
