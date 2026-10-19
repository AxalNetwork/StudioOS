/**
 * D690 (#1692) — Validate's six one-record reads, as CO:362-367 draws them,
 * with each record's actions and its module's `form-options`.
 *
 * Every read is fixed, bound SQL over a record the route has already proven
 * is the venture's (`ownedRow`). Every action calls the writer its PATCH or
 * POST route calls (`services/validateWriters.ts`, `services/interviewWriters.ts`),
 * so a record and a route never write the same row two ways. Sections carry
 * their store's gate (decision 2): what an interview session holds is a
 * writer's, and a quote whose interview did not agree to be quoted reaches
 * anyone else as `QUOTE_WITHHELD`. What is not data is "Not recorded" with
 * its reason, or is not drawn (decision 15). Decision numbers are D690's.
 */
import { verdictSpec } from './verdict';
import type { User } from '../../types';
import { canWrite, ownsVenture } from '../../routes/_founder_validate_helpers';
import { sessionAudioParts, sessionReceiptLines } from '../../routes/founder_validate_sessions';
import { sessionPlacementRows } from '../../routes/founder_validate_structure';
import { loadSession } from '../interviewSessions';
import {
  MODULES, QUOTE_WITHHELD, claimsOf, heldDate, interviewState, isHeld, loadInterviews,
  loadSegments, loadSeverities, segmentsOf, supportsByGroup, themesOf,
  type ClaimStatus, type HypRow, type InterviewRow, type LinkRow,
} from '../cycleValidate';
import { getPainGroupsView, loadPainGroupModel, normPhrase, resolvePhrase, safeParseStrings, severityLevel, type PainGroupModel } from '../painGroups';
import { linkCandidatesToDirectory } from '../competitorDirectoryLink';
import { KPI_LABEL, evidenceFor } from '../validateEvidence';
import { deleteInterview, updateInterviewDetails } from '../interviewWriters';
import {
  COMPETITOR_SIGNAL_TYPES, DEMAND_STATUSES, EVIDENCE_KINDS, EVIDENCE_STRENGTHS, EXPERIMENT_STATUSES, KPI_KEYS,
  SEGMENT_URGENCIES, WAITLIST_TARGET_KEY, WATCH_DEFAULTS, WATCH_KEYS, WriterError,
  addCompetitorSignal, addEvidence, addExperiment, attachDemandEvidence, attachQuote, competitorNameNorm, deleteTheme,
  latestKpis, linkTheme, markDemandToConfirm, mergeTheme, openDemandEvidence, parseWatch, setExperimentStatus,
  splitTheme, stopCompetitor, unlinkEvidence, updateCompetitor, updateDemandSignal, updateHypothesis, updateSegment,
  updateTheme,
} from '../validateWriters';
import type { ActionResult, ModuleSpec, RecordAction, RecordContent, RecordContext, RecordFact, Row, Store } from './types';

type Any = Record<string, any>;
type Body = Record<string, unknown> | FormData;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Oct", in UTC, as the canvas writes a date; null when there is none. */
function dMon(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : null;
}
/** "Sep 2026", for "tracked since". */
function monYear(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(raw ?? ''));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : null;
}
const joined = (...parts: Array<string | null | undefined>) => parts.filter((p) => p != null && p !== '').join(' · ');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fact = (label: string, value: string | number | null | undefined, reason: string): RecordFact =>
  value == null || value === '' ? { label, value: null, reason } : { label, value };
const today = () => new Date().toISOString().slice(0, 10);
const opts = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.map(([value, label]) => ({ value, label }));
const isWriter = (ctx: RecordContext) => canWrite(ctx.project, ctx.user);
const userId = (ctx: RecordContext) => Number(ctx.user.id);
const field = (body: Body, key: string): unknown => (body instanceof FormData ? body.get(key) ?? undefined : body[key]);
const refId = (raw: unknown): string | number => (typeof raw === 'number' || typeof raw === 'string' ? raw : '');
const money = (cents: number | null | undefined, currency: string | null | undefined) =>
  cents == null ? null : `${(Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${String(currency || 'usd').toUpperCase()}`;

/** A writer's refusal, as the status and sentence the route answers with. */
async function refusing(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await work(); } catch (err) {
    if (err instanceof WriterError) {
      throw new Response(JSON.stringify({ detail: err.sentence }), { status: err.status, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}
/** `ownedRow` passed before the spec ran, so a missing row is a race with a delete. */
const vanished = () => new Response(JSON.stringify({ detail: 'Record not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

/** One read per request, shared by the record, its sections and its actions. */
function memo<T>(name: string) {
  const cache = new WeakMap<RecordContext, Map<string, Promise<T>>>();
  return (ctx: RecordContext, id: string, load: () => Promise<T>): Promise<T> => {
    let byId = cache.get(ctx);
    if (!byId) { byId = new Map(); cache.set(ctx, byId); }
    const key = `${name}:${id}`;
    let hit = byId.get(key);
    if (!hit) { hit = load(); byId.set(key, hit); }
    return hit;
  };
}

/** A held date from a row read with its own columns. */
const heldOf = (r: Any) => heldDate({ done_at: r.done_at ?? null, interview_date: r.interview_date ?? null, created_at: r.created_at ?? null });
const vctx = (ctx: RecordContext) => ({ env: ctx.env, projectId: ctx.projectId, today: today(), canWrite: isWriter(ctx) });

const SEVERITY: Record<string, [string, string]> = { severe: ['Severe', 'bad'], real: ['Real', 'amb'], mild: ['Mild', 'grey'] };
const FIT: Record<string, [string, string]> = { strong: ['Strong', 'ok'], partial: ['Partial', 'vio'], none: ['Weak', 'grey'] };
const CLAIM: Record<ClaimStatus, [string, string]> = {
  untested: ['Untested', 'grey'], testing: ['Testing', 'vio'], supported: ['Supported', 'ok'],
  refuted: ['Refuted', 'bad'], inconclusive: ['Inconclusive', 'grey'], not_recorded: ['Fit not recorded', 'amb'],
};
const STRENGTH: Record<string, string> = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const DIRECTION: Record<string, string> = { supports: 'Supporting', contradicts: 'Contradicting' };

/** The venture's owners, the only people a claim may name (decision 12). */
async function ventureOwners(ctx: RecordContext): Promise<Array<{ value: string; label: string }>> {
  if (ctx.project.founder_id == null) return [];
  const res = await ctx.env.DB.prepare(
    `SELECT id, name, role, founder_id, spinout_lab_active FROM users
      WHERE founder_id = ? AND is_active = 1 ORDER BY name, id`,
  ).bind(ctx.project.founder_id).all<User & { name: string | null }>();
  return (res.results || []).filter((u) => ownsVenture(ctx.project, u))
    .map((u) => ({ value: String(u.id), label: u.name || `User ${u.id}` }));
}

async function claimOptions(ctx: RecordContext) {
  const res = await ctx.env.DB.prepare(
    'SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id',
  ).bind(ctx.projectId).all<{ id: number; code: string; claim: string }>();
  return (res.results || []).map((h) => ({ value: String(h.id), label: joined(h.code, h.claim) }));
}

// ── Problem discovery: one pain group ────────────────────────────────────────

type ThemeData = {
  group: { id: number; title: string; created_by: number | null; created_at: string | null };
  theme: ReturnType<typeof themesOf>[number] | null;
  interviews: InterviewRow[];
  held: number;
  model: PainGroupModel;
  hyps: HypRow[];
  links: LinkRow[];
};
const themeMemo = memo<ThemeData>('theme');

function loadTheme(ctx: RecordContext, id: string): Promise<ThemeData> {
  return themeMemo(ctx, id, async () => {
    const c = vctx(ctx);
    const group = await ctx.env.DB.prepare('SELECT id, title, created_by, created_at FROM pain_groups WHERE id = ? AND project_id = ?')
      .bind(Number(id), ctx.projectId).first<ThemeData['group']>();
    if (!group) throw vanished();
    const [interviews, model, sev, hypRes, linkRes] = await Promise.all([
      loadInterviews(c), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), loadSeverities(c),
      ctx.env.DB.prepare(
        `SELECT h.id, h.code, h.claim, h.sort_order, h.retired_at, h.sprint, h.owner_user_id, NULL AS owner_name, h.inconclusive_at, h.updated_at
           FROM hypotheses h WHERE h.project_id = ? AND h.retired_at IS NULL ORDER BY h.sort_order, h.id`,
      ).bind(ctx.projectId).all<HypRow>(),
      ctx.env.DB.prepare(
        `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction, l.strength, l.created_at
           FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id
          WHERE h.project_id = ? AND h.retired_at IS NULL`,
      ).bind(ctx.projectId).all<LinkRow>(),
    ]);
    const hyps = hypRes.results || [];
    const links = linkRes.results || [];
    const theme = themesOf(interviews, model, sev, c.today, supportsByGroup(hyps, links))
      .find((t) => t.group_id != null && Number(t.group_id) === Number(group.id)) ?? null;
    return { group, theme, interviews, held: interviews.filter(isHeld).length, model, hyps, links };
  });
}

/** Each interview's phrases that resolve to this group, once per interview and phrase. */
function quotesOf(d: ThemeData) {
  const out: Array<{ iv: InterviewRow; phrase: string }> = [];
  for (const iv of d.interviews) {
    const seen = new Set<string>();
    for (const p of safeParseStrings(iv.pains_json)) {
      const display = p.trim();
      const norm = normPhrase(display);
      if (!norm || seen.has(norm)) continue;
      if (resolvePhrase(norm, display, d.model).groupId !== Number(d.group.id)) continue;
      seen.add(norm);
      out.push({ iv, phrase: display });
    }
  }
  return out.sort((a, b) => String(heldDate(b.iv) ?? '').localeCompare(String(heldDate(a.iv) ?? '')));
}

/** Every phrase no group holds, then every grouped one, for New theme and Attach (decision 6). */
async function quoteChoices(ctx: RecordContext, exceptGroup: number | null = null) {
  const c = vctx(ctx);
  const [interviews, model] = await Promise.all([loadInterviews(c), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true })]);
  const titles = new Map(model.groups.map((g) => [Number(g.id), g.title]));
  const unthemed: Array<{ value: string; label: string; interview_id: number; phrase: string; theme: null }> = [];
  const themed: Array<{ value: string; label: string; interview_id: number; phrase: string; theme: string }> = [];
  for (const iv of interviews) {
    const seen = new Set<string>();
    for (const p of safeParseStrings(iv.pains_json)) {
      const display = p.trim();
      const norm = normPhrase(display);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const gid = resolvePhrase(norm, display, model).groupId;
      if (gid != null && gid === exceptGroup) continue;
      const label = `"${display}" · ${joined(iv.interviewee_name, dMon(heldDate(iv)))}`;
      const value = `${iv.id}|${display}`;
      if (gid == null) unthemed.push({ value, label, interview_id: Number(iv.id), phrase: display, theme: null });
      else themed.push({ value, label, interview_id: Number(iv.id), phrase: display, theme: `in ${titles.get(Number(gid)) ?? 'another theme'}` });
    }
  }
  return { unthemed, themed };
}

/** A quote choice is "<interview id>|<phrase>"; a client may send the two fields instead. */
function quoteOf(body: Body): { interview_id: unknown; phrase: unknown } {
  const raw = field(body, 'quote');
  if (typeof raw === 'string' && raw.includes('|')) {
    const at = raw.indexOf('|');
    return { interview_id: raw.slice(0, at), phrase: raw.slice(at + 1) };
  }
  return { interview_id: field(body, 'interview_id'), phrase: field(body, 'phrase') };
}

const problemDiscovery: ModuleSpec = {
  read: 'read', write: 'write', store: 'pain_groups',
  activityType: 'validate.problem-discovery',
  async record(ctx, id): Promise<RecordContent> {
    const d = await loadTheme(ctx, id);
    const t = d.theme;
    const n = t?.mentions ?? 0;
    const sev = t?.severity ? SEVERITY[t.severity] : null;
    const trend = t ? t.last_30d - t.prior_30d : null;
    return {
      title: d.group.title,
      sub: `Mentioned in ${n} of ${d.held} interviews`,
      pills: [
        ...(sev ? [{ text: sev[0], tone: sev[1] }] : []),
        ...(d.held > 0 && n * 2 >= d.held ? [{ text: 'Frequent', tone: 'vio' }] : []),
      ],
      facts: [
        fact('How often', n > 0 ? plural(n, 'interview', 'interviews') : null, 'No interview names it yet'),
        fact('How severe', sev?.[0], 'No quote judged yet'),
        t && t.first_mention
          ? { label: 'Trend', value: trend === 0 ? 'No change in 30 days' : `${trend! > 0 ? '▲' : '▼'} ${Math.abs(trend!)} in 30 days` }
          : { label: 'Trend', value: null, reason: 'No dated mention' },
        fact('First heard', dMon(t?.first_mention), 'No dated mention'),
      ],
      createdBy: d.group.created_by, createdAt: d.group.created_at,
    };
  },
  sections: [
    {
      key: 'quotes', title: 'Quotes',
      read: async (ctx, id) => {
        const d = await loadTheme(ctx, id);
        const writer = isWriter(ctx);
        return {
          rows: quotesOf(d).map(({ iv, phrase }) => ({
            a: writer || iv.quote_consent === 1 ? `"${phrase}"` : QUOTE_WITHHELD,
            b: joined(iv.interviewee_name, dMon(heldDate(iv))),
            c: iv.quote_consent === 1 ? 'Consented' : 'No quote consent',
            tone: iv.quote_consent === 1 ? 'ok' : 'grey',
          })),
          empty: 'No quote names this theme yet.',
          action: 'attach-quote',
        };
      },
    },
    {
      key: 'hypotheses', title: 'Hypotheses it feeds',
      read: async (ctx, id) => {
        const d = await loadTheme(ctx, id);
        const claims = claimsOf(d.hyps, d.links, d.interviews, d.model);
        const rows: Row[] = [];
        for (const l of d.links.filter((x) => Number(x.pain_group_id) === Number(d.group.id))) {
          const claim = claims.find((c) => c.id === Number(l.hypothesis_id));
          if (!claim) continue;
          const [word, tone] = CLAIM[claim.status];
          rows.push({ a: joined(claim.code, claim.claim), b: DIRECTION[l.direction] ?? 'Supporting', c: word, tone,
            href: `/validate/experiments/${claim.id}?project=${ctx.projectId}` });
        }
        return { rows, empty: 'Feeds no hypothesis yet.', action: 'link' };
      },
    },
    {
      key: 'segments', title: 'Segments', side: true,
      read: async (ctx, id) => {
        const d = await loadTheme(ctx, id);
        const [segments, view] = await Promise.all([
          loadSegments(vctx(ctx)), getPainGroupsView(ctx.env, ctx.projectId, { strict: true }),
        ]);
        const by = new Map<number, number>();
        for (const { iv } of quotesOf(d)) if (iv.segment_id != null) by.set(Number(iv.segment_id), (by.get(Number(iv.segment_id)) ?? 0) + 1);
        const rows: Row[] = segments.filter((s) => by.has(Number(s.id)))
          .map((s) => ({ a: s.name, b: plural(by.get(Number(s.id))!, 'mention', 'mentions') }));
        // D704 decision 6 (S1, #1666): the pain map's per-theme ICP and fit
        // counts, the ones the ICP only filter narrows on. With no fit recorded
        // on any interview, one line says so, never "0 of".
        const g = view.groups.find((x) => Number(x.id) === Number(d.group.id));
        const named = d.theme?.mentions ?? 0;
        if (!view.icp_recorded) rows.push({ a: 'ICP fit', b: 'Not recorded on any interview yet' });
        else if (g && named > 0) {
          rows.push({ a: 'Your ICP', b: `strong or partial fit · ${g.icp_count} of ${plural(named, 'interview', 'interviews')}` });
          if (g.fit_unrecorded_count > 0) rows.push({ a: 'Fit not recorded', b: plural(g.fit_unrecorded_count, 'interview', 'interviews') });
        }
        return { rows, empty: 'No interview that names it has a segment.' };
      },
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const d = await loadTheme(ctx, id);
    const others = d.model.groups.filter((g) => Number(g.id) !== Number(d.group.id))
      .map((g) => ({ value: String(g.id), label: g.title }));
    const mine = quotesOf(d).map(({ phrase }) => phrase).filter((p, i, a) => a.indexOf(p) === i);
    const choices = await quoteChoices(ctx, Number(d.group.id));
    const claims = await claimOptions(ctx);
    const themeId = Number(d.group.id);
    const actions: RecordAction[] = [];
    if (others.length) {
      actions.push({
        key: 'merge', label: 'Merge into…', kind: 'form',
        form: { title: 'Merge into another theme', cta: 'Merge', foot: 'Its quotes and links move; its title stays as a phrase of the theme it joins.',
          fields: [{ key: 'into', label: 'Theme', kind: 'CH', options: others, required: true }] },
        references: (body) => [{ store: 'pain_groups', id: refId(field(body, 'into')) }],
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await mergeTheme(c.env, { projectId: c.projectId, userId: userId(c), themeId, into: field(body, 'into') }) })),
      });
    }
    if (mine.length > 1) {
      actions.push({
        key: 'split', label: 'Split', kind: 'form',
        form: { title: 'Split into a new theme', cta: 'Split',
          fields: [
            { key: 'title', label: 'New theme', kind: 'T', required: true },
            { key: 'phrases', label: 'Quotes that move', kind: 'CK', options: mine.map((p) => ({ value: p, label: `"${p}"` })), required: true },
          ] },
        execute: (c, _id, body) => refusing(async () => {
          const raw = body instanceof FormData ? body.getAll('phrases') : body.phrases;
          return { ok: true, record: await splitTheme(c.env, { projectId: c.projectId, userId: userId(c), themeId, phrases: raw, title: field(body, 'title') }) };
        }),
      });
    }
    actions.push(
      {
        key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
        form: { title: 'Edit theme', cta: 'Save', foot: 'Applies to quotes not judged yet.',
          fields: [
            { key: 'title', label: 'Theme', kind: 'T', value: d.group.title, required: true },
            { key: 'severity', label: 'How severe', kind: 'CH', options: opts([['mild', 'Mild'], ['real', 'Real'], ['severe', 'Severe']]),
              value: d.theme?.severity ?? undefined, note: 'Mild: a nuisance. Real: costs time or money. Severe: blocks the job.' },
          ] },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateTheme(c.env, {
          projectId: c.projectId, userId: userId(c), themeId, title: field(body, 'title'), severity: field(body, 'severity'),
        }) })),
      },
      {
        key: 'delete', label: 'Delete', kind: 'write', tone: 'danger',
        confirm: { title: 'Delete this theme?', body: 'Its quotes stay on their interviews, unthemed. Its links to hypotheses go.', cta: 'Delete' },
        execute: (c) => refusing(async () => { await deleteTheme(c.env, { projectId: c.projectId, userId: userId(c), themeId }); return { ok: true }; }),
      },
      {
        key: 'attach-quote', label: 'Attach a quote', kind: 'form',
        form: { title: 'Attach a quote', cta: 'Attach',
          fields: [{ key: 'quote', label: 'Quote', kind: 'CH', required: true,
            options: [...choices.unthemed, ...choices.themed].map((q) => ({ value: q.value, label: q.theme ? `${q.label} · ${q.theme}` : q.label })) }] },
        references: (body) => [{ store: 'discovery_interviews', id: refId(quoteOf(body).interview_id) }],
        execute: (c, _id, body) => refusing(async () => {
          const q = quoteOf(body);
          await attachQuote(c.env, { projectId: c.projectId, userId: userId(c), themeId, interview_id: q.interview_id, phrase: q.phrase });
          return { ok: true };
        }),
      },
      {
        key: 'link', label: 'Link', kind: 'form',
        form: { title: 'Link to a hypothesis', cta: 'Link',
          fields: [
            { key: 'hypothesis_id', label: 'Hypothesis', kind: 'CH', options: claims, required: true },
            { key: 'direction', label: 'Direction', kind: 'CH', options: opts([['supports', 'Supporting'], ['contradicts', 'Contradicting']]), value: 'supports' },
          ] },
        references: (body) => [{ store: 'hypotheses', id: refId(field(body, 'hypothesis_id')) }],
        execute: (c, _id, body) => refusing(async () => {
          await linkTheme(c.env, { projectId: c.projectId, userId: userId(c), themeId, hypothesis_id: field(body, 'hypothesis_id'), direction: field(body, 'direction') });
          return { ok: true };
        }),
      },
    );
    return actions;
  },
  /** New theme's quotes, unthemed first, and the hypotheses it may feed. */
  async formOptions(ctx) {
    const { unthemed, themed } = await quoteChoices(ctx);
    return {
      quotes: [...unthemed, ...themed].map(({ value, label, interview_id, phrase, theme }) => ({ value, label, interview_id, phrase, theme })),
      unthemed_total: unthemed.length,
      hypotheses: await claimOptions(ctx),
    };
  },
};

// ── Customer research: one interview ─────────────────────────────────────────

const STATE_WORD: Record<string, [string, string]> = {
  failed: ['Failed', 'bad'], recording: ['Recording', 'vio'],
  waiting_consent: ['Waiting for consent', 'amb'], consent_declined: ['Declined in WhatsApp', 'bad'],
  waiting_messages: ['Waiting for messages', 'amb'],
  waiting_transcript: ['Waiting for the call transcript', 'amb'], processing: ['Processing', 'vio'],
  ready: ['Ready to review', 'amb'], reviewed: ['Reviewed', 'ok'], lead: ['Lead', 'grey'], invited: ['Invited', 'grey'],
  booked: ['Booked', 'vio'], logged: ['Logged', 'grey'],
};
const CONSENT_WORD: Record<string, string> = {
  verbal: 'Said yes out loud', written: 'In writing', in_app: 'In the app', pre_agreed: 'Agreed beforehand', chat_reply: 'Agreed in the chat',
};
const IMPORTED: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', zoom: 'Zoom', google_meet: 'Google Meet' };

type InterviewData = {
  iv: Any;
  session: Any | null;
  segment: string | null;
  chunks: number;
};
const interviewMemo = memo<InterviewData>('interview');

function loadInterview(ctx: RecordContext, id: string): Promise<InterviewData> {
  return interviewMemo(ctx, id, async () => {
    const iv = await ctx.env.DB.prepare(
      `SELECT i.*, g.name AS segment_name FROM discovery_interviews i
         LEFT JOIN customer_segments g ON g.id = i.segment_id AND g.project_id = i.project_id
        WHERE i.id = ? AND i.project_id = ?`,
    ).bind(Number(id), ctx.projectId).first<Any>();
    if (!iv) throw vanished();
    // The latest session by id, as the list reads it (decision 9).
    const session = await ctx.env.DB.prepare(
      'SELECT * FROM interview_sessions WHERE interview_id = ? AND project_id = ? ORDER BY id DESC LIMIT 1',
    ).bind(Number(id), ctx.projectId).first<Any>();
    const chunks = session
      ? Number((await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ?').bind(session.id).first<{ n: number }>())?.n ?? 0)
      : 0;
    return { iv, session: session ?? null, segment: iv.segment_name ?? null, chunks };
  });
}

function capturedWord(d: InterviewData): string {
  const s = d.session;
  if (!s) return 'Entered by hand';
  const via = String(s.submitted_via ?? '').trim();
  if (via) return `Imported from ${IMPORTED[via] ?? s.submitted_via_name ?? 'an assistant'}`;
  if (s.channel === 'text') return 'Pasted in StudioOS';
  if (s.channel === 'manual') return 'Entered by hand';
  return 'Recorded in StudioOS';
}

/** Yes when a pain was judged Severe or Real, No when every judged pain is Mild. */
async function needToHave(ctx: RecordContext, interviewId: number): Promise<string | null> {
  const res = await ctx.env.DB.prepare('SELECT severity FROM interview_pain_severities WHERE interview_id = ?')
    .bind(interviewId).all<{ severity: string }>();
  const levels = (res.results || []).map((r) => severityLevel(r.severity)).filter(Boolean);
  if (!levels.length) return null;
  return levels.some((l) => l === 'severe' || l === 'real') ? 'Yes' : 'No';
}

const hhmmss = (ms: unknown) => {
  const t = Math.max(0, Math.floor(Number(ms) / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const parseJson = (raw: unknown) => { try { return raw ? JSON.parse(String(raw)) : null; } catch { return null; } };
/** What a placement points at, in its own words. */
function placementTarget(kind: string, p: Any | null): string {
  if (!p) return 'Not recorded';
  if (kind === 'pain_severity') return String(p.phrase ?? 'Pain theme');
  if (kind === 'icp_fit') return 'ICP fit';
  if (kind === 'segment') return String(p.name ?? 'Segment');
  if (kind === 'demand_signal') return 'Demand signal';
  if (kind === 'evidence') return 'Hypothesis';
  if (kind === 'competitor_mention') return String(p.name ?? 'Competitor');
  return 'Market fact';
}
const PLACEMENT_STATUS: Record<string, [string, string]> = { pending: ['Pending', 'amb'], accepted: ['Accepted', 'ok'], discarded: ['Discarded', 'grey'] };

const customerResearch: ModuleSpec = {
  read: 'read', write: 'write', store: 'discovery_interviews',
  activityType: 'validate.customer-research',
  async record(ctx, id): Promise<RecordContent> {
    const d = await loadInterview(ctx, id);
    const iv = d.iv;
    const role = iv.interviewee_role ? String(iv.interviewee_role) : null;
    const company = iv.interviewee_company ? String(iv.interviewee_company) : null;
    const who = role && company ? `${role} at ${company}` : role ?? company;
    const minutes = Number(d.session?.active_ms) > 0 ? Math.max(1, Math.round(Number(d.session?.active_ms) / 60_000))
      : Number(iv.recording_duration_sec) > 0 ? Math.max(1, Math.round(Number(iv.recording_duration_sec) / 60)) : null;
    const state = interviewState(d.session ? { status: d.session.status, submitted_via: d.session.submitted_via, processing_stage: d.session.processing_stage, consent_status: d.session.consent_status } : null, iv.stage ?? null);
    const fit = iv.icp_fit ? FIT[String(iv.icp_fit)] : null;
    const method = d.session?.consent_method ? CONSENT_WORD[String(d.session.consent_method)] : null;
    return {
      title: String(iv.interviewee_name ?? 'Interview'),
      sub: joined(who, dMon(heldOf(iv)), minutes != null ? `${minutes} min` : null),
      pills: [
        ...(fit ? [{ text: `${fit[0]} fit`, tone: fit[1] }] : []),
        { text: STATE_WORD[state][0], tone: STATE_WORD[state][1] },
      ],
      facts: [
        { label: 'Captured', value: capturedWord(d) },
        fact('Consent', method, d.session ? 'No consent method recorded' : 'No session recorded'),
        fact('ICP fit', fit ? joined(fit[0], d.segment) : null, 'No fit recorded'),
        fact('Need-to-have', await needToHave(ctx, Number(iv.id)), 'No pain judged yet'),
      ],
      createdAt: iv.created_at ?? null,
    };
  },
  sections: [
    {
      key: 'transcript', title: 'Transcript', gate: 'write',
      read: async (ctx, id) => {
        const d = await loadInterview(ctx, id);
        if (!d.session) return { rows: [], empty: 'No session recorded.' };
        const segs = await ctx.env.DB.prepare(
          `SELECT id, source, start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
            WHERE session_id = ? AND source = (SELECT CASE WHEN EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ? AND source = 'final') THEN 'final' ELSE 'live' END)
            ORDER BY start_ms, id`,
        ).bind(d.session.id, d.session.id).all<Any>();
        const placements = await sessionPlacementRows(ctx.env, Number(d.session.id));
        return {
          rows: (segs.results || []).map((s) => {
            const cited = placements.find((p) => p.cite_from != null && p.cite_to != null
              && Number(s.start_ms) < Number(p.cite_to) && Number(s.end_ms ?? s.start_ms) > Number(p.cite_from));
            return {
              a: joined(`${hhmmss(s.start_ms)}`, s.speaker_label), b: `"${s.text}"`,
              ...(cited ? { c: `→ ${placementTarget(cited.kind, parseJson(cited.edited_payload_json) ?? parseJson(cited.payload_json))}`, tone: 'vio' } : {}),
            };
          }),
          empty: 'No transcript yet.',
        };
      },
    },
    {
      key: 'placements', title: 'Eadwyn’s placements', gate: 'write',
      read: async (ctx, id) => {
        const d = await loadInterview(ctx, id);
        if (!d.session) return { rows: [], empty: 'No session recorded.' };
        const rows = await sessionPlacementRows(ctx.env, Number(d.session.id));
        return {
          rows: rows.map((p) => {
            const quote = parseJson(p.citation_json)?.quote;
            const [word, tone] = PLACEMENT_STATUS[String(p.status)] ?? ['Not recorded', 'grey'];
            return {
              a: joined(quote ? `"${quote}"` : null, `→ ${placementTarget(String(p.kind), parseJson(p.edited_payload_json) ?? parseJson(p.payload_json))}`),
              b: p.status === 'pending' ? 'Accept · Edit · Discard' : joined(dMon(p.decided_at)),
              c: word, tone, href: `/validate/session/${d.session!.id}?project=${ctx.projectId}`,
            };
          }),
          empty: 'Eadwyn has placed nothing from this session.',
        };
      },
    },
    {
      key: 'fed', title: 'What it fed', side: true,
      read: async (ctx, id) => {
        const d = await loadInterview(ctx, id);
        const model = await loadPainGroupModel(ctx.env, ctx.projectId, { strict: true });
        const groups = new Set<number>();
        for (const p of safeParseStrings(d.iv.pains_json)) {
          const gid = model.aliasByNorm.get(normPhrase(p));
          if (gid) groups.add(Number(gid));
        }
        let supports = 0; let contradicts = 0;
        if (groups.size) {
          const links = await ctx.env.DB.prepare(
            `SELECT l.pain_group_id, l.direction FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id
              WHERE h.project_id = ? AND h.retired_at IS NULL`,
          ).bind(ctx.projectId).all<{ pain_group_id: number; direction: string }>();
          for (const l of links.results || []) {
            if (!groups.has(Number(l.pain_group_id))) continue;
            if (l.direction === 'contradicts') contradicts += 1; else supports += 1;
          }
        }
        const fit = d.iv.icp_fit ? FIT[String(d.iv.icp_fit)] : null;
        return {
          rows: [
            { a: 'Pain themes', b: String(groups.size) },
            { a: 'Hypotheses', b: `${supports} supports · ${contradicts} contradicts` },
            { a: 'ICP fit', b: fit ? joined(fit[0], d.segment) : 'Not recorded' },
          ],
        };
      },
    },
    {
      key: 'cost', title: 'Cost', side: true, gate: 'write',
      read: async (ctx, id) => {
        const d = await loadInterview(ctx, id);
        if (!d.session) return { rows: [], empty: 'No session recorded.' };
        const lines = await sessionReceiptLines(ctx.env, Number(d.session.id));
        return {
          rows: lines.map((l) => ({
            a: joined(String(l.kind ?? ''), l.model ? String(l.model) : null),
            b: `$${(Number(l.cost_microusd || 0) / 1_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`,
          })),
          empty: 'Nothing was charged for this session.',
        };
      },
    },
    {
      key: 'session', title: 'Session', side: true, gate: 'write',
      read: async (ctx, id) => {
        const d = await loadInterview(ctx, id);
        const state = d.session ? interviewState({ status: d.session.status, submitted_via: d.session.submitted_via, processing_stage: d.session.processing_stage, consent_status: d.session.consent_status }, d.iv.stage ?? null) : null;
        // A channel session still waiting opens its own page (D694), a chat waiting for consent too (D754).
        return state === 'waiting_messages' || state === 'waiting_transcript' || state === 'waiting_consent'
          ? { rows: [{ a: STATE_WORD[state][0], b: 'Open the session →', href: `/validate/session/${d.session?.id}?project=${ctx.projectId}` }] }
          : { rows: [], empty: 'Nothing waiting.' };
      },
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const d = await loadInterview(ctx, id);
    const interviewId = Number(d.iv.id);
    const actions: RecordAction[] = [
      {
        key: 'edit-details', label: 'Edit details', kind: 'form',
        form: { title: 'Edit details', cta: 'Save', fields: [
          { key: 'interviewee_name', label: 'Name', kind: 'T', value: d.iv.interviewee_name ?? '', required: true },
          { key: 'interviewee_company', label: 'Company', kind: 'T', value: d.iv.interviewee_company ?? '' },
        ] },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateInterviewDetails(c.env, {
          projectId: c.projectId, userId: userId(c), interviewId,
          interviewee_name: field(body, 'interviewee_name'), interviewee_company: field(body, 'interviewee_company'),
        }) })),
      },
      {
        key: 'delete', label: 'Delete', kind: 'write', tone: 'danger',
        confirm: { title: 'Delete this interview?', body: 'Its sessions, audio and transcript go with it.', cta: 'Delete' },
        execute: (c) => refusing(async () => ({ ok: true, record: await deleteInterview(c.env, { projectId: c.projectId, userId: userId(c), interviewId }) })),
      },
    ];
    if (d.session && d.chunks > 0) {
      const sessionId = Number(d.session.id);
      actions.push({
        key: 'open-recording', label: 'Open recording', kind: 'write', tone: 'primary',
        // The same `parts` as `GET /sessions/:id/audio` (decision 11).
        execute: async (c) => {
          const session = await loadSession(c.env, sessionId);
          if (!session || Number(session.project_id) !== c.projectId) throw vanished();
          const parts = await sessionAudioParts(c.env, session, userId(c));
          if (!parts) throw new Response(JSON.stringify({ detail: 'This session has no recorded audio.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
          return { ok: true, open: { parts } };
        },
      });
    }
    return actions;
  },
};

// ── Ideal customer profile: one segment ──────────────────────────────────────

const URGENCY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const segmentMemo = memo<{ s: Any; total: number; summary: ReturnType<typeof segmentsOf>['segments'][number] | null; interviews: InterviewRow[] }>('segment');

function loadSegment(ctx: RecordContext, id: string) {
  return segmentMemo(ctx, id, async () => {
    const s = await ctx.env.DB.prepare('SELECT * FROM customer_segments WHERE id = ? AND project_id = ?').bind(Number(id), ctx.projectId).first<Any>();
    if (!s) throw vanished();
    const c = vctx(ctx);
    const [segments, interviews] = await Promise.all([loadSegments(c), loadInterviews(c)]);
    const summary = segmentsOf(segments, interviews).segments.find((x) => Number(x.id) === Number(s.id)) ?? null;
    return { s, total: segments.length, summary, interviews };
  });
}

/** The segment's held interviews, since `score_since` when it is set (decision 13). */
function scoredAgainst(seg: Any, interviews: InterviewRow[]) {
  const since = typeof seg.score_since === 'string' ? seg.score_since.slice(0, 10) : null;
  return interviews.filter((i) => isHeld(i) && Number(i.segment_id) === Number(seg.id) && (!since || String(heldDate(i) ?? '') >= since));
}

const icp: ModuleSpec = {
  read: 'read', write: 'write', store: 'customer_segments',
  activityType: 'validate.ideal-customer-profile',
  async record(ctx, id): Promise<RecordContent> {
    const { s, total, summary } = await loadSegment(ctx, id);
    const evidence = summary?.evidence;
    return {
      title: String(s.name),
      sub: joined(`One of ${plural(total, 'segment', 'segments')}`, s.updated_at ? `updated ${dMon(s.updated_at)}` : null),
      pills: evidence ? [{ text: `${STRENGTH[evidence]} evidence`, tone: evidence === 'pattern' ? 'vio' : 'grey' }] : [],
      facts: [
        { label: 'Interviews', value: summary?.interviews ?? 0 },
        { label: 'Strong fit', value: summary?.strong ?? 0 },
        fact('Urgency', URGENCY[String(s.urgency)] ?? null, 'Not set'),
        fact('Value promised', s.value_promised, 'Not written yet'),
      ],
      createdAt: s.created_at ?? null,
    };
  },
  sections: [
    {
      key: 'steps', title: 'Five steps',
      read: async (ctx, id) => {
        const { s } = await loadSegment(ctx, id);
        const step = (a: string, v: unknown, needsSource = false): Row => {
          const text = v == null || String(v).trim() === '' ? null : String(v);
          if (!text) return { a, b: 'Not written yet', c: 'Missing', tone: 'amb' };
          return needsSource ? { a, b: text, c: 'Needs a source', tone: 'amb' } : { a, b: text, c: 'Done', tone: 'ok' };
        };
        return {
          rows: [
            step('Who they are', s.who_they_are), step('Context', s.context), step('Job to be done', s.job_to_be_done),
            step('Urgency', URGENCY[String(s.urgency)] ?? null),
            step('Value promised', s.value_promised, !s.value_source),
          ],
          action: 'edit',
        };
      },
    },
    {
      key: 'interviews', title: 'Interviews scored against it',
      read: async (ctx, id) => {
        const { s, interviews } = await loadSegment(ctx, id);
        // Fit is a label; no score is computed, so none is drawn (decision 15).
        return {
          rows: scoredAgainst(s, interviews).map((i) => {
            const fit = i.icp_fit ? FIT[i.icp_fit] : null;
            return { a: String(i.interviewee_name ?? 'Interview'), b: dMon(heldDate(i)) ?? '', c: fit ? fit[0] : 'Not recorded', tone: fit ? fit[1] : 'grey',
              href: `/validate/customer-research/${i.id}?project=${ctx.projectId}` };
          }),
          empty: 'No interview is in this segment yet.',
        };
      },
    },
    {
      key: 'themes', title: 'Pain themes', side: true,
      read: async (ctx, id) => {
        const { s, interviews } = await loadSegment(ctx, id);
        const model = await loadPainGroupModel(ctx.env, ctx.projectId, { strict: true });
        const titles = new Map(model.groups.map((g) => [Number(g.id), g.title]));
        const by = new Map<number, number>();
        for (const iv of scoredAgainst(s, interviews)) {
          const seen = new Set<number>();
          for (const p of safeParseStrings(iv.pains_json)) {
            const gid = model.aliasByNorm.get(normPhrase(p));
            if (gid && !seen.has(Number(gid))) { seen.add(Number(gid)); by.set(Number(gid), (by.get(Number(gid)) ?? 0) + 1); }
          }
        }
        return {
          rows: [...by.entries()].sort((a, b) => b[1] - a[1])
            .map(([gid, n]) => ({ a: titles.get(gid) ?? 'Pain theme', b: plural(n, 'mention', 'mentions') })),
          empty: 'Its interviews name no theme yet.',
        };
      },
    },
    {
      key: 'persona', title: 'Persona card', side: true,
      read: async () => ({ rows: [{ a: 'Export', b: 'PDF', action: 'export-persona' }] }),
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const { s } = await loadSegment(ctx, id);
    const segmentId = Number(s.id);
    return [
      { key: 'compare-segments', label: 'Compare segments', kind: 'link', href: `/validate/ideal-customer-profile?project=${ctx.projectId}` },
      // #1658's client action draws the PDF; PNG is not built (decision 15).
      { key: 'export-persona', label: 'Export persona', kind: 'link', href: `/validate/ideal-customer-profile/${segmentId}?project=${ctx.projectId}&export=persona` },
      {
        key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
        form: {
          title: 'Edit segment', cta: 'Save', foot: 'Interviews are listed against it with their ICP fit.',
          fields: [
            { key: 'name', label: 'Segment', kind: 'T', value: s.name, required: true },
            { key: 'who_they_are', label: 'Who they are', kind: 'T', value: s.who_they_are ?? '', placeholder: '[Role] at [company type], [size], [where]' },
            { key: 'context', label: 'Context', kind: 'T', value: s.context ?? '' },
            { key: 'job_to_be_done', label: 'Job to be done', kind: 'T', value: s.job_to_be_done ?? '', placeholder: '[What they are trying to get done]' },
            { key: 'urgency', label: 'Urgency', kind: 'CH', options: SEGMENT_URGENCIES.map((u) => ({ value: u, label: URGENCY[u] })), value: s.urgency ?? undefined },
            { key: 'value_promised', label: 'Value promised', kind: 'T', value: s.value_promised ?? '', placeholder: '[What changes for them]' },
            { key: 'value_source', label: 'Source for the value', kind: 'T', value: s.value_source ?? '' },
            { key: 'score_since', label: 'Score against interviews since', kind: 'T', input: 'date', value: s.score_since ?? '' },
          ],
        },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateSegment(c.env, {
          projectId: c.projectId, userId: userId(c), segmentId,
          name: field(body, 'name'), description: field(body, 'description'), who_they_are: field(body, 'who_they_are'),
          context: field(body, 'context'), job_to_be_done: field(body, 'job_to_be_done'), urgency: field(body, 'urgency'),
          value_promised: field(body, 'value_promised'), value_source: field(body, 'value_source'), score_since: field(body, 'score_since'),
        }) })),
      },
    ];
  },
  async formOptions() { return {}; },
};

// ── Market intelligence: one competitor ──────────────────────────────────────

const SIGNAL_TYPE: Record<string, string> = { mention: 'Mention', funding: 'Funding', launch: 'Launch', hiring: 'Hires', pricing: 'Pricing', other: 'Other' };
const PRICE: Record<string, string> = { lower: 'Lower than ours', similar: 'About the same as ours', higher: 'Higher than ours' };
const DEPTH: Record<string, string> = { narrower: 'Narrower', similar: 'About the same', broader: 'Broader' };
const competitorMemo = memo<{ c: Any; tracking: Any | null; watch: Record<string, boolean>; signals: Any[] }>('competitor');

function loadCompetitor(ctx: RecordContext, id: string) {
  return competitorMemo(ctx, id, async () => {
    const c = await ctx.env.DB.prepare(
      `SELECT c.* FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
        WHERE c.id = ? AND a.project_id = ?`,
    ).bind(id, ctx.projectId).first<Any>();
    if (!c) throw vanished();
    const norm = competitorNameNorm(String(c.name));
    const tracking = await ctx.env.DB.prepare('SELECT * FROM competitor_tracking WHERE project_id = ? AND name_norm = ?')
      .bind(ctx.projectId, norm).first<Any>();
    const watch = tracking ? parseWatch(tracking.watch_json) : { ...WATCH_DEFAULTS };
    // Every signal on a candidate of this name in the venture's analyses, as the list groups them.
    const sigs = await ctx.env.DB.prepare(
      `SELECT s.*, COALESCE(s.observed_on, substr(s.created_at, 1, 10)) AS on_day
         FROM competitor_signals s JOIN competitor_analyses a ON a.id = s.analysis_id
         JOIN competitor_candidates c ON c.id = s.candidate_id
        WHERE a.project_id = ? AND substr(lower(trim(c.name)), 1, 120) = ?
        ORDER BY on_day DESC, s.created_at DESC`,
    ).bind(ctx.projectId, norm).all<Any>();
    // Decision 8: a funding, launch or hiring signal shows only while its toggle is on.
    const signals = (sigs.results || []).filter((s) => !(WATCH_KEYS as readonly string[]).includes(s.signal_type) || watch[s.signal_type] !== false);
    return { c, tracking: tracking ?? null, watch, signals };
  });
}

function fundingToDate(signals: Any[]): { value: string | null; reason: string } {
  const funded = signals.filter((s) => s.signal_type === 'funding' && s.amount_cents != null);
  if (!funded.length) return { value: null, reason: 'No funding amount recorded' };
  const currencies = new Set(funded.map((s) => String(s.currency || 'usd').toLowerCase()));
  if (currencies.size > 1) return { value: null, reason: 'Amounts are in more than one currency' };
  return { value: money(funded.reduce((a, s) => a + Number(s.amount_cents), 0), funded[0].currency), reason: '' };
}

const market: ModuleSpec = {
  read: 'read', write: 'write', store: 'competitor_candidates',
  activityType: 'validate.market-intelligence',
  async record(ctx, id): Promise<RecordContent> {
    const { c, tracking, signals } = await loadCompetitor(ctx, id);
    const kind = c.category === 'adjacent' ? 'Adjacent' : 'Direct';
    const latest = signals[0] ?? null;
    const funding = fundingToDate(signals);
    const stopped = !!tracking?.stopped_at;
    return {
      title: String(c.name),
      sub: joined(`${kind} competitor`, monYear(tracking?.created_at ?? c.created_at) ? `tracked since ${monYear(tracking?.created_at ?? c.created_at)}` : null),
      pills: [{ text: kind, tone: kind === 'Direct' ? 'bad' : 'grey' }, stopped ? { text: 'Stopped', tone: 'grey' } : { text: 'Watching', tone: 'vio' }],
      facts: [
        fact('Latest signal', latest ? joined(latest.label || SIGNAL_TYPE[latest.signal_type] || latest.signal_type, dMon(latest.on_day)) : null, 'No signal recorded'),
        fact('Funding to date', funding.value, funding.reason),
        { label: 'Headcount', value: null, reason: 'No public figure found' },
        fact('Source', latest?.source_url ?? latest?.source_kind ?? c.url ?? null, 'No source recorded'),
      ],
      createdBy: tracking?.created_by ?? null, createdAt: c.created_at ?? null,
    };
  },
  sections: [
    {
      key: 'signals', title: 'Signals',
      read: async (ctx, id) => {
        const { signals } = await loadCompetitor(ctx, id);
        return {
          rows: signals.map((s) => {
            const amount = s.signal_type === 'funding' ? money(s.amount_cents, s.currency) : null;
            return {
              a: joined(s.label || SIGNAL_TYPE[s.signal_type] || s.signal_type, amount),
              b: joined(s.source_url ?? s.source_kind, dMon(s.on_day)),
              c: SIGNAL_TYPE[s.signal_type] ?? 'Other', tone: s.signal_type === 'funding' ? 'vio' : 'grey',
            };
          }),
          // No watch job runs (decision 8, D-s).
          empty: 'Signals appear as you record them or re-run the analysis.',
          action: 'add-signal',
        };
      },
    },
    {
      key: 'positioning', title: 'Positioning',
      read: async (ctx, id) => {
        const { tracking } = await loadCompetitor(ctx, id);
        return { rows: [
          { a: 'Price', b: PRICE[String(tracking?.price_position)] ?? 'Not recorded' },
          { a: 'Depth', b: DEPTH[String(tracking?.depth_position)] ?? 'Not recorded' },
          { a: 'Why it matters', b: tracking?.why_it_matters ?? 'Not recorded' },
        ] };
      },
    },
    {
      key: 'research', title: 'Research › Companies', side: true,
      read: async (ctx, id) => {
        const { c } = await loadCompetitor(ctx, id);
        const link = await linkCandidatesToDirectory(ctx.env.DB, [{ id: c.id, name: c.name, domain: c.domain, url: c.url }]);
        const uid = link.byId.get(String(c.id)) ?? null;
        if (link.status === 'unreadable') return { rows: [{ a: 'Unreadable', b: 'Research › Companies could not be read', tone: 'grey' }] };
        return uid
          ? { rows: [{ a: 'Profile', b: 'Open →', href: `/research/companies/company/${encodeURIComponent(uid)}` }] }
          : { rows: [], empty: 'No profile in Research › Companies.' };
      },
    },
    {
      key: 'watching', title: 'Watching for', side: true,
      read: async (ctx, id) => {
        const { watch } = await loadCompetitor(ctx, id);
        return { rows: [
          { a: 'Funding', b: watch.funding ? 'on' : 'off' },
          { a: 'Launches', b: watch.launch ? 'on' : 'off' },
          { a: 'Hires', b: watch.hiring ? 'on' : 'off' },
        ] };
      },
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const { c, tracking, watch } = await loadCompetitor(ctx, id);
    const candidateId = String(c.id);
    const actions: RecordAction[] = [];
    if (!tracking?.stopped_at) {
      actions.push({
        key: 'stop', label: 'Stop tracking', kind: 'write', tone: 'danger',
        confirm: { title: 'Stop tracking this competitor?', body: 'It leaves the list. Its signals stay.', cta: 'Stop tracking' },
        execute: (x) => refusing(async () => { await stopCompetitor(x.env, { projectId: x.projectId, userId: userId(x), candidateId }); return { ok: true }; }),
      });
    }
    actions.push(
      {
        key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
        form: { title: 'Edit competitor', cta: 'Save', fields: [
          { key: 'kind', label: 'Kind', kind: 'CH', options: opts([['direct', 'Direct'], ['adjacent', 'Adjacent']]), value: c.category === 'adjacent' ? 'adjacent' : 'direct',
            note: 'Direct: solves the same problem for the same customer. Adjacent: one of the two.' },
          { key: 'watch', label: 'Watch for', kind: 'CK', options: opts([['funding', 'Funding'], ['launch', 'Launches'], ['hiring', 'Hires']]),
            value: WATCH_KEYS.filter((k) => watch[k]) },
          { key: 'price_position', label: 'Price', kind: 'CH', options: opts([['lower', 'Lower than ours'], ['similar', 'About the same'], ['higher', 'Higher than ours']]), value: tracking?.price_position ?? undefined },
          { key: 'depth_position', label: 'Depth', kind: 'CH', options: opts([['narrower', 'Narrower'], ['similar', 'About the same'], ['broader', 'Broader']]), value: tracking?.depth_position ?? undefined },
          { key: 'why', label: 'Why it matters', kind: 'T', value: tracking?.why_it_matters ?? '', placeholder: '[One line, optional]' },
        ] },
        execute: (x, _id, body) => refusing(async () => {
          // A checklist sends the keys it holds; the writer takes the three switches.
          const raw = body instanceof FormData ? body.getAll('watch') : body.watch;
          const watchBody = Array.isArray(raw) ? Object.fromEntries(WATCH_KEYS.map((k) => [k, raw.includes(k)])) : raw;
          await updateCompetitor(x.env, {
            projectId: x.projectId, userId: userId(x), candidateId, kind: field(body, 'kind'), watch: watchBody, why: field(body, 'why'),
            price_position: field(body, 'price_position'), depth_position: field(body, 'depth_position'),
          });
          return { ok: true };
        }),
      },
      {
        key: 'add-signal', label: 'Add a signal', kind: 'form',
        form: { title: 'Add a signal', cta: 'Add', fields: [
          { key: 'signal_type', label: 'Kind', kind: 'CH', options: COMPETITOR_SIGNAL_TYPES.map((t) => ({ value: t, label: SIGNAL_TYPE[t] })), value: 'funding', required: true },
          { key: 'label', label: 'What happened', kind: 'T', placeholder: 'Raised a Series A', required: true },
          { key: 'amount_cents', label: 'Amount', kind: 'T', input: 'money', note: 'Funding only.' },
          { key: 'currency', label: 'Currency', kind: 'T', placeholder: 'usd' },
          { key: 'source_url', label: 'Source', kind: 'T', placeholder: 'https://' },
          { key: 'observed_on', label: 'Date', kind: 'T', input: 'date' },
        ] },
        execute: (x, _id, body) => refusing(async () => ({ ok: true, record: await addCompetitorSignal(x.env, {
          projectId: x.projectId, userId: userId(x), candidateId, signal_type: field(body, 'signal_type'), label: field(body, 'label'),
          amount_cents: field(body, 'amount_cents'), currency: field(body, 'currency'), source_url: field(body, 'source_url'), observed_on: field(body, 'observed_on'),
        }) })),
      },
    );
    return actions;
  },
  /**
   * Add competitor's Company (decision 8): the caller's own analysed companies
   * the venture does not track, then, with `q`, up to 20 directory matches.
   */
  async formOptions(ctx, query) {
    const trackedRes = await ctx.env.DB.prepare(
      `SELECT DISTINCT substr(lower(trim(c.name)), 1, 120) AS n FROM competitor_candidates c
         JOIN competitor_analyses a ON a.id = c.analysis_id
        WHERE a.project_id = ?
          AND NOT EXISTS (SELECT 1 FROM competitor_tracking t WHERE t.project_id = a.project_id
                           AND t.name_norm = substr(lower(trim(c.name)), 1, 120) AND t.stopped_at IS NOT NULL)`,
    ).bind(ctx.projectId).all<{ n: string }>();
    const tracked = new Set((trackedRes.results || []).map((r) => r.n));
    const own = await ctx.env.DB.prepare(
      `SELECT c.id, c.name, c.url, c.domain FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
        WHERE a.user_id = ? ORDER BY lower(c.name), c.id LIMIT 200`,
    ).bind(Number(ctx.user.id)).all<Any>();
    const seen = new Set<string>();
    const candidates = (own.results || []).filter((c) => {
      const n = competitorNameNorm(String(c.name));
      if (!n || tracked.has(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    }).map((c) => ({ value: String(c.id), label: String(c.name), website: c.url ?? c.domain ?? null }));
    const q = String(query.q ?? '').trim().slice(0, 120).toLowerCase();
    let directory: Array<{ value: string; label: string; website: string | null; country: string | null }> | undefined;
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const res = await ctx.env.DB.prepare(
        `SELECT uid, name, website, country FROM research_company_directory
          WHERE lower(name) LIKE ? ESCAPE '\\' OR lower(COALESCE(website, '')) LIKE ? ESCAPE '\\'
          ORDER BY lower(name), uid LIMIT 40`,
      ).bind(like, like).all<Any>();
      directory = (res.results || []).filter((r) => !tracked.has(competitorNameNorm(String(r.name)))).slice(0, 20)
        .map((r) => ({ value: String(r.uid), label: String(r.name), website: r.website ?? null, country: r.country ?? null }));
    }
    return { candidates, ...(directory ? { directory } : {}) };
  },
};

// ── Demand and urgency signals: one demand record ────────────────────────────

const KIND: Record<string, string> = {
  loi: 'Letter of intent', pre_sale: 'Pre-sale', waitlist: 'Waitlist sign-up', need_to_have: 'Need-to-have mention', would_pay: 'Would pay',
};
const STATUS: Record<string, [string, string]> = { confirmed: ['Confirmed', 'ok'], counted: ['Counted', 'ok'], to_confirm: ['To confirm', 'amb'] };
const PERIOD: Record<string, string> = { month: '/ month', year: '/ year', once: '' };

type DemandData =
  | { prefix: 'signal'; row: Any }
  | { prefix: 'revenue'; row: Any }
  | { prefix: 'waitlist'; row: Any };
const demandMemo = memo<DemandData>('demand');

function loadDemandRecord(ctx: RecordContext, id: string): Promise<DemandData> {
  return demandMemo(ctx, id, async () => {
    const n = Number(id.replace(/^[a-z]+-/, ''));
    if (id.startsWith('signal-')) {
      const row = await ctx.env.DB.prepare(
        `SELECT d.*, i.interviewee_name, i.interview_date, i.done_at, i.created_at AS iv_created_at, i.segment_id,
                g.name AS segment_name
           FROM demand_signals d
           LEFT JOIN discovery_interviews i ON i.id = d.interview_id AND i.project_id = d.project_id
           LEFT JOIN customer_segments g ON g.id = i.segment_id AND g.project_id = d.project_id
          WHERE d.id = ? AND d.project_id = ?`,
      ).bind(n, ctx.projectId).first<Any>();
      if (!row) throw vanished();
      return { prefix: 'signal', row };
    }
    if (id.startsWith('revenue-')) {
      const row = await ctx.env.DB.prepare(
        "SELECT * FROM revenue_entries WHERE id = ? AND project_id = ? AND revenue_type IN ('deposit', 'pilot')",
      ).bind(n, ctx.projectId).first<Any>();
      if (!row) throw vanished();
      return { prefix: 'revenue', row };
    }
    // A sign-up's name only: an address is never drawn.
    const row = await ctx.env.DB.prepare(
      "SELECT id, name, created_at FROM waitlist_signups WHERE id = ? AND project_id = ? AND (audience IS NULL OR audience = 'customer')",
    ).bind(n, ctx.projectId).first<Any>();
    if (!row) throw vanished();
    return { prefix: 'waitlist', row };
  });
}

/** Decision 7: only the waitlist has a bar. */
async function waitlistBar(ctx: RecordContext): Promise<{ bar: number | null; count: number }> {
  const bar = await ctx.env.DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
    .bind(ctx.projectId, WAITLIST_TARGET_KEY).first<{ target_value: number }>();
  const n = await ctx.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM waitlist_signups WHERE project_id = ? AND (audience IS NULL OR audience = 'customer'))
          + (SELECT COUNT(*) FROM demand_signals WHERE project_id = ? AND kind = 'waitlist' AND status IN ('confirmed', 'counted')) AS n`,
  ).bind(ctx.projectId, ctx.projectId).first<{ n: number }>();
  return { bar: bar ? Number(bar.target_value) : null, count: Number(n?.n ?? 0) };
}

const demandKind = (d: DemandData) => (d.prefix === 'signal' ? String(d.row.kind) : d.prefix === 'revenue' ? 'pre_sale' : 'waitlist');

const demand: ModuleSpec = {
  read: 'read', write: 'write', store: 'demand_records',
  activityType: 'validate.demand-signals',
  async record(ctx, id): Promise<RecordContent> {
    const d = await loadDemandRecord(ctx, id);
    const kind = demandKind(d);
    const word = KIND[kind] ?? kind;
    const who = d.prefix === 'signal' ? d.row.who : d.prefix === 'revenue' ? d.row.customer : d.row.name;
    const amount = d.prefix === 'waitlist' ? null : money(d.row.amount_cents, d.row.currency);
    const period = d.prefix === 'signal' ? PERIOD[String(d.row.period)] ?? '' : '';
    const date = d.prefix === 'signal' ? d.row.signal_date : d.prefix === 'revenue' ? d.row.received_on : String(d.row.created_at ?? '').slice(0, 10);
    const status = d.prefix === 'signal' ? STATUS[String(d.row.status)] ?? ['To confirm', 'amb'] : d.prefix === 'revenue' ? STATUS.confirmed : STATUS.counted;
    const bar = kind === 'waitlist' ? await waitlistBar(ctx) : null;
    const amountReason = kind === 'need_to_have' || kind === 'waitlist' ? 'Amounts are for pre-sales and letters of intent only' : 'No amount recorded';
    return {
      title: joined(word, who),
      sub: joined(amount ? `${amount}${period ? ` ${period}` : ''}` : null, dMon(date) ? `recorded ${dMon(date)}` : null),
      pills: [{ text: status[0], tone: status[1] }, { text: word, tone: 'vio' }],
      facts: [
        { label: 'Kind', value: word },
        fact('Amount', amount ? `${amount}${period ? ` ${period}` : ''}` : null, amountReason),
        fact('Date', dMon(date), 'No date recorded'),
        bar
          ? fact('Counts toward', bar.bar != null ? `Waitlist bar · ${bar.count} of ${bar.bar}` : null, 'No bar set')
          : { label: 'Counts toward', value: null, reason: 'No bar is set for this kind' },
      ],
      createdBy: d.prefix === 'signal' ? d.row.created_by ?? null : null,
      createdAt: d.row.created_at ?? null,
    };
  },
  sections: [
    {
      key: 'evidence', title: 'Evidence',
      read: async (ctx, id) => {
        const d = await loadDemandRecord(ctx, id);
        if (d.prefix === 'revenue') {
          return { rows: [{ a: 'Revenue ledger', b: joined(d.row.revenue_type === 'pilot' ? 'Pilot' : 'Deposit', dMon(d.row.received_on)), c: d.row.verification ? String(d.row.verification) : 'Recorded', tone: 'ok' }] };
        }
        if (d.prefix === 'waitlist') return { rows: [{ a: 'Signed up themselves', b: dMon(d.row.created_at) ?? '', c: 'Counted', tone: 'ok' }] };
        const rows: Row[] = [];
        if (d.row.evidence_file_key) rows.push({ a: String(d.row.evidence_file_name ?? 'Evidence file'), b: 'Open', c: 'Stored', tone: 'ok', action: 'open-evidence' });
        if (d.row.interview_id != null) {
          rows.push({ a: 'Interview', b: joined(d.row.interviewee_name, dMon(heldDate({ done_at: d.row.done_at, interview_date: d.row.interview_date, created_at: d.row.iv_created_at }))),
            c: 'Linked', tone: 'vio', href: `/validate/customer-research/${d.row.interview_id}?project=${ctx.projectId}` });
        }
        return { rows, empty: 'No file or interview attached.', action: 'attach' };
      },
    },
    {
      key: 'feeds', title: 'Feeds',
      read: async (ctx, id) => {
        const d = await loadDemandRecord(ctx, id);
        const res = await ctx.env.DB.prepare(
          `SELECT l.direction, l.strength, h.id, h.code, h.claim FROM hypothesis_evidence_links l
             JOIN hypotheses h ON h.id = l.hypothesis_id AND h.project_id = l.project_id
            WHERE l.project_id = ? AND l.kind = 'signal' AND l.ref_id = ? ORDER BY l.id`,
        ).bind(ctx.projectId, id).all<Any>();
        const rows: Row[] = (res.results || []).map((r) => ({
          a: joined(r.code, r.claim), b: DIRECTION[r.direction] ?? 'Supporting', c: STRENGTH[r.strength] ?? 'Strength not recorded',
          tone: r.direction === 'contradicts' ? 'bad' : 'ok', href: `/validate/experiments/${r.id}?project=${ctx.projectId}`,
        }));
        if (demandKind(d) === 'waitlist') {
          const bar = await waitlistBar(ctx);
          rows.push({ a: 'Demand bar', b: 'Waitlist', c: bar.bar != null ? `${bar.count} of ${bar.bar}` : 'No bar set', tone: bar.bar != null && bar.count >= bar.bar ? 'ok' : 'amb' });
        }
        return { rows, empty: 'Feeds no hypothesis yet.' };
      },
    },
    {
      key: 'who', title: 'Who', side: true,
      read: async (ctx, id) => {
        const d = await loadDemandRecord(ctx, id);
        // A customer and their segment; never a sign-up's address.
        if (d.prefix === 'signal') return { rows: [{ a: String(d.row.who ?? 'Not recorded'), b: d.row.segment_name ?? 'No segment' }] };
        if (d.prefix === 'revenue') return { rows: [{ a: String(d.row.customer ?? 'Not recorded'), b: 'Revenue ledger' }] };
        return { rows: [{ a: String(d.row.name ?? 'A sign-up with no name'), b: 'Waitlist' }] };
      },
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const d = await loadDemandRecord(ctx, id);
    // A `revenue-` record is the ledger's and a `waitlist-` record the person's own.
    if (d.prefix !== 'signal') return [];
    const signalId = Number(d.row.id);
    const interviews = await ctx.env.DB.prepare(
      'SELECT id, interviewee_name, interview_date, done_at, created_at FROM discovery_interviews WHERE project_id = ? ORDER BY id DESC LIMIT 200',
    ).bind(ctx.projectId).all<Any>();
    const ivOptions = (interviews.results || []).map((i) => ({ value: String(i.id), label: joined(i.interviewee_name, dMon(heldOf(i))) }));
    const actions: RecordAction[] = [];
    if (d.row.status !== 'to_confirm') {
      actions.push({
        key: 'mark-to-confirm', label: 'Mark to confirm', kind: 'write',
        execute: (c) => refusing(async () => { await markDemandToConfirm(c.env, { projectId: c.projectId, userId: userId(c), signalId }); return { ok: true }; }),
      });
    }
    actions.push(
      {
        key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
        form: { title: 'Edit signal', cta: 'Save', foot: 'Waitlist sign-ups count toward the bar you set.', fields: [
          { key: 'kind', label: 'Kind', kind: 'CH', value: d.row.kind,
            options: opts([['need_to_have', 'Need-to-have mention'], ['waitlist', 'Waitlist sign-up'], ['pre_sale', 'Pre-sale'], ['loi', 'Letter of intent']]) },
          { key: 'who', label: 'Who', kind: 'T', value: d.row.who ?? '', placeholder: '[Customer, lead or interviewee]' },
          { key: 'amount_cents', label: 'Amount', kind: 'T', input: 'money', value: d.row.amount_cents ?? '', note: 'Pre-sales and letters of intent only.' },
          { key: 'signal_date', label: 'Date', kind: 'T', input: 'date', value: d.row.signal_date ?? '' },
          { key: 'status', label: 'Status', kind: 'CH', value: d.row.status, options: DEMAND_STATUSES.filter((s) => s !== 'counted').map((s) => ({ value: s, label: STATUS[s][0] })),
            note: 'To confirm: said, not yet in writing.' },
        ] },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateDemandSignal(c.env, {
          projectId: c.projectId, userId: userId(c), signalId, kind: field(body, 'kind'), who: field(body, 'who'),
          amount_cents: field(body, 'amount_cents'), currency: field(body, 'currency'), period: field(body, 'period'),
          signal_date: field(body, 'signal_date'), status: field(body, 'status'), note: field(body, 'note'),
        }) })),
      },
      {
        key: 'attach', label: 'Attach', kind: 'form',
        form: { title: 'Attach evidence', cta: 'Attach', fields: [
          { key: 'file', label: 'File', kind: 'T', input: 'file', note: 'PDF, PNG, JPEG or WebP, up to 20 MB.' },
          { key: 'interview_id', label: 'Interview', kind: 'CH', options: ivOptions },
        ] },
        references: (body) => {
          const raw = field(body, 'interview_id');
          return raw == null || raw === '' ? [] : [{ store: 'discovery_interviews' as Store, id: refId(raw) }];
        },
        execute: (c, _id, body) => refusing(async () => {
          const file = field(body, 'file');
          return { ok: true, record: await attachDemandEvidence(c.env, {
            projectId: c.projectId, userId: userId(c), signalId,
            file: file && typeof file === 'object' && 'arrayBuffer' in (file as object) ? file as File : null,
            interview_id: field(body, 'interview_id'),
          }) };
        }),
      },
    );
    if (d.row.evidence_file_key) {
      actions.push({
        key: 'open-evidence', label: 'Open evidence', kind: 'write',
        execute: (c) => refusing(async () => ({ ok: true, ...(await openDemandEvidence(c.env, { projectId: c.projectId, userId: userId(c), signalId })) })),
      });
    }
    return actions;
  },
  /** Attach's interviews. */
  async formOptions(ctx) {
    const res = await ctx.env.DB.prepare(
      'SELECT id, interviewee_name, interview_date, done_at, created_at FROM discovery_interviews WHERE project_id = ? ORDER BY id DESC LIMIT 200',
    ).bind(ctx.projectId).all<Any>();
    return { interviews: (res.results || []).map((i) => ({ value: String(i.id), label: joined(i.interviewee_name, dMon(heldOf(i))) })) };
  },
};

// ── Experiments and evidence: one hypothesis ─────────────────────────────────

const EXPERIMENT_STATUS: Record<string, [string, string]> = { planned: ['Planned', 'grey'], running: ['Running', 'vio'], done: ['Done', 'ok'] };
const EVIDENCE_KIND: Record<string, string> = { interview: 'Interview', signal: 'Demand signal', metric: 'KPI', experiment: 'Experiment' };

type HypothesisData = { h: Any; claim: ReturnType<typeof claimsOf>[number] | null; links: LinkRow[]; model: PainGroupModel };
const hypothesisMemo = memo<HypothesisData>('hypothesis');

function loadHypothesis(ctx: RecordContext, id: string): Promise<HypothesisData> {
  return hypothesisMemo(ctx, id, async () => {
    const h = await ctx.env.DB.prepare(
      `SELECT h.*, u.name AS owner_name FROM hypotheses h LEFT JOIN users u ON u.id = h.owner_user_id
        WHERE h.id = ? AND h.project_id = ?`,
    ).bind(Number(id), ctx.projectId).first<Any>();
    if (!h) throw vanished();
    const [links, interviews, model] = await Promise.all([
      ctx.env.DB.prepare('SELECT id, hypothesis_id, pain_group_id, direction, strength, created_at FROM hypothesis_pain_links WHERE hypothesis_id = ?')
        .bind(Number(h.id)).all<LinkRow>(),
      loadInterviews(vctx(ctx)), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }),
    ]);
    // Decision 13: the status and counts the list shows, from the same reader.
    const claim = claimsOf([h as HypRow], links.results || [], interviews, model)[0] ?? null;
    return { h, claim, links: links.results || [], model };
  });
}

const experiments: ModuleSpec = {
  read: 'read', write: 'write', store: 'hypotheses',
  activityType: 'validate.experiments',
  async record(ctx, id): Promise<RecordContent> {
    const { h, claim } = await loadHypothesis(ctx, id);
    const status = claim ? CLAIM[claim.status] : null;
    return {
      title: String(h.claim),
      sub: joined(h.owner_name ? `Owner ${h.owner_name}` : null, dMon(h.deadline) ? `deadline ${dMon(h.deadline)}` : null) || 'No owner or deadline set',
      pills: [
        ...(h.retired_at ? [{ text: 'Retired', tone: 'grey' }] : status ? [{ text: status[0], tone: status[1] }] : []),
        ...(h.sprint ? [{ text: String(h.sprint), tone: 'grey' }] : []),
      ],
      facts: [
        fact('Proves it', h.success_bar, 'No success bar written'),
        fact('Disproves it', h.disproof, 'No condition written'),
        { label: 'Evidence', value: `${claim?.supporting ?? 0} for · ${claim?.contradicting ?? 0} against` },
        fact('Strength', claim?.strength ? STRENGTH[claim.strength] : null, 'No strength recorded'),
      ],
      createdBy: h.created_by ?? null, createdAt: h.created_at ?? null,
    };
  },
  sections: [
    {
      key: 'evidence', title: 'Evidence',
      read: async (ctx, id) => {
        const items = await evidenceFor({ env: ctx.env, projectId: ctx.projectId }, { hypothesisId: Number(id) });
        return {
          rows: items.map((e) => ({
            a: e.label, b: joined(EVIDENCE_KIND[e.kind], dMon(e.date)),
            c: joined(e.direction === 'contradicts' ? 'Contradicts' : 'Supports', e.strength ? STRENGTH[e.strength] : null),
            tone: e.direction === 'contradicts' ? 'bad' : e.strength === 'measured' ? 'ok' : 'vio',
            action: { key: 'unlink', body: { link: e.link } },
          })),
          empty: 'No evidence linked yet.',
          action: 'add-evidence',
        };
      },
    },
    {
      key: 'experiments', title: 'Experiments',
      read: async (ctx, id) => {
        const res = await ctx.env.DB.prepare(
          'SELECT id, title, method, target, result, status FROM hypothesis_experiments WHERE hypothesis_id = ? AND project_id = ? ORDER BY id',
        ).bind(Number(id), ctx.projectId).all<Any>();
        return {
          rows: (res.results || []).map((x) => {
            const [word, tone] = EXPERIMENT_STATUS[String(x.status)] ?? ['Planned', 'grey'];
            return { a: String(x.title), b: joined(x.method, x.target ? `target ${x.target}` : null, x.result), c: word, tone,
              action: { key: 'experiment-status', body: { experiment_id: Number(x.id) } } };
          }),
          empty: 'No experiment yet.',
          action: 'add-experiment',
        };
      },
    },
    {
      key: 'themes', title: 'Pain themes', side: true,
      read: async (ctx, id) => {
        const { links, model } = await loadHypothesis(ctx, id);
        const titles = new Map(model.groups.map((g) => [Number(g.id), g.title]));
        return {
          rows: links.map((l) => ({ a: titles.get(Number(l.pain_group_id)) ?? 'Pain theme', b: DIRECTION[l.direction] ?? 'Supporting',
            href: `/validate/problem-discovery/${l.pain_group_id}?project=${ctx.projectId}` })),
          empty: 'Links to no theme yet.',
        };
      },
    },
    {
      // Eadwyn's check is not built (decision 15): the founder's own condition.
      key: 'disproof', title: 'What would prove this wrong', side: true,
      read: async (ctx, id) => {
        const { h } = await loadHypothesis(ctx, id);
        return h.disproof ? { rows: [{ a: String(h.disproof) }] } : { rows: [], empty: 'No condition written.' };
      },
    },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const { h } = await loadHypothesis(ctx, id);
    const hypothesisId = Number(h.id);
    const owners = await ventureOwners(ctx);
    const experimentsRes = await ctx.env.DB.prepare('SELECT id, title FROM hypothesis_experiments WHERE hypothesis_id = ? AND project_id = ? ORDER BY id')
      .bind(hypothesisId, ctx.projectId).all<{ id: number; title: string }>();
    const items = await evidenceFor({ env: ctx.env, projectId: ctx.projectId }, { hypothesisId });
    const unlinkable = [...new Map(items.map((e) => [e.link, e])).values()];
    const choices = await evidenceChoices(ctx);
    const actions: RecordAction[] = [];
    // Decision 14: with Verdict, which #1704 adds to `MODULES`.
    if ((MODULES as ReadonlyArray<{ slug: string }>).some((m) => m.slug === 'verdict')) {
      actions.push({ key: 'record-decision', label: 'Record a decision', kind: 'link',
        href: `/validate/verdict/new?project=${ctx.projectId}&for=h-${hypothesisId}` });
    }
    actions.push(
      {
        key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
        form: { title: 'Edit hypothesis', cta: 'Save', foot: 'Its status comes from the evidence linked to it.', fields: [
          { key: 'claim', label: 'Claim', kind: 'T', value: h.claim, required: true },
          { key: 'success_bar', label: 'What would prove it', kind: 'T', value: h.success_bar ?? '' },
          { key: 'disproof', label: 'What would disprove it', kind: 'T', value: h.disproof ?? '' },
          { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: owners, value: h.owner_user_id != null ? String(h.owner_user_id) : undefined },
          { key: 'deadline', label: 'Deadline', kind: 'T', input: 'date', value: h.deadline ?? '' },
          { key: 'sprint', label: 'Sprint', kind: 'T', value: h.sprint ?? '' },
          { key: 'inconclusive', label: 'Inconclusive', kind: 'CK', options: opts([['true', 'Mark inconclusive']]), value: h.inconclusive_at ? ['true'] : [] },
          { key: 'retired', label: 'Retired', kind: 'CK', options: opts([['true', 'Retire this hypothesis']]), value: h.retired_at ? ['true'] : [] },
        ] },
        execute: (c, _id, body) => refusing(async () => {
          const flag = (k: string) => {
            const v = body instanceof FormData ? body.getAll(k) : body[k];
            if (v === undefined) return undefined;
            return Array.isArray(v) ? v.includes('true') : v === true || v === 'true';
          };
          return { ok: true, record: await updateHypothesis(c.env, {
            projectId: c.projectId, userId: userId(c), hypothesisId, claim: field(body, 'claim'), success_bar: field(body, 'success_bar'),
            disproof: field(body, 'disproof'), deadline: field(body, 'deadline'), sprint: field(body, 'sprint'),
            owner_user_id: field(body, 'owner_user_id'), inconclusive: flag('inconclusive'), retired: flag('retired'),
          }) };
        }),
      },
      {
        key: 'add-evidence', label: 'Add evidence', kind: 'form',
        form: { title: 'Add evidence', cta: 'Add', fields: [
          { key: 'kind', label: 'Kind', kind: 'CH', options: EVIDENCE_KINDS.map((k) => ({ value: k, label: EVIDENCE_KIND[k] })), required: true },
          { key: 'ref_id', label: 'Evidence', kind: 'CH', options: choices.map((x) => ({ value: x.value, label: `${EVIDENCE_KIND[x.kind]} · ${x.label}` })), required: true },
          { key: 'direction', label: 'Direction', kind: 'CH', options: opts([['supports', 'Supporting'], ['contradicts', 'Contradicting']]), value: 'supports' },
          { key: 'strength', label: 'Strength', kind: 'CH', options: EVIDENCE_STRENGTHS.map((s) => ({ value: s, label: STRENGTH[s] })) },
        ] },
        // The writer checks a KPI key against the venture's own metrics.
        references: (body) => {
          const kind = String(field(body, 'kind') ?? '');
          const ref = refId(field(body, 'ref_id'));
          if (kind === 'interview') return [{ store: 'discovery_interviews', id: ref }];
          if (kind === 'signal') return [{ store: 'demand_records', id: ref }];
          if (kind === 'experiment') return [{ store: 'hypothesis_experiments', id: ref }];
          return [];
        },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addEvidence(c.env, {
          projectId: c.projectId, userId: userId(c), hypothesisId, kind: field(body, 'kind'), ref_id: field(body, 'ref_id'),
          direction: field(body, 'direction'), strength: field(body, 'strength'),
        }) })),
      },
      {
        key: 'unlink', label: 'Unlink evidence', kind: 'form',
        form: { title: 'Unlink evidence', cta: 'Unlink', fields: [
          { key: 'link', label: 'Evidence', kind: 'CH', options: unlinkable.map((e) => ({ value: e.link, label: e.label })), required: true },
        ] },
        references: (body) => {
          const link = String(field(body, 'link') ?? '');
          if (link.startsWith('pain-')) return [{ store: 'hypothesis_pain_links', id: link.slice(5) }];
          if (link.startsWith('evidence-')) return [{ store: 'hypothesis_evidence_links', id: link.slice(9) }];
          return [{ store: 'hypothesis_evidence_links', id: '' }];
        },
        execute: (c, _id, body) => refusing(async () => {
          await unlinkEvidence(c.env, { projectId: c.projectId, userId: userId(c), hypothesisId, link: field(body, 'link') });
          return { ok: true };
        }),
      },
      {
        key: 'add-experiment', label: 'Add an experiment', kind: 'form',
        form: { title: 'Add an experiment', cta: 'Add', fields: [
          { key: 'title', label: 'Experiment', kind: 'T', required: true },
          { key: 'method', label: 'Method', kind: 'T', placeholder: 'Landing page, interviews…' },
          { key: 'target', label: 'Target', kind: 'T', placeholder: '40 sign-ups' },
        ] },
        execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addExperiment(c.env, {
          projectId: c.projectId, userId: userId(c), hypothesisId, title: field(body, 'title'), method: field(body, 'method'), target: field(body, 'target'),
        }) })),
      },
    );
    if ((experimentsRes.results || []).length) {
      actions.push({
        key: 'experiment-status', label: 'Update an experiment', kind: 'form',
        form: { title: 'Update an experiment', cta: 'Save', fields: [
          { key: 'experiment_id', label: 'Experiment', kind: 'CH', required: true,
            options: (experimentsRes.results || []).map((x) => ({ value: String(x.id), label: x.title })) },
          { key: 'status', label: 'Status', kind: 'CH', required: true, options: EXPERIMENT_STATUSES.map((s) => ({ value: s, label: EXPERIMENT_STATUS[s][0] })) },
          { key: 'result', label: 'Result', kind: 'T' },
        ] },
        references: (body) => [{ store: 'hypothesis_experiments', id: refId(field(body, 'experiment_id')) }],
        execute: (c, _id, body) => refusing(async () => {
          await setExperimentStatus(c.env, { projectId: c.projectId, userId: userId(c), hypothesisId,
            experiment_id: field(body, 'experiment_id'), status: field(body, 'status'), result: field(body, 'result') });
          return { ok: true };
        }),
      });
    }
    return actions;
  },
  /** New hypothesis and Add evidence: themes, owners, sprints and the evidence candidates. */
  async formOptions(ctx) {
    const [model, owners, sprints, evidence] = await Promise.all([
      loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), ventureOwners(ctx),
      ctx.env.DB.prepare(
        `SELECT DISTINCT sprint FROM hypotheses WHERE project_id = ? AND retired_at IS NULL AND sprint IS NOT NULL AND trim(sprint) != '' ORDER BY sprint`,
      ).bind(ctx.projectId).all<{ sprint: string }>(),
      evidenceChoices(ctx),
    ]);
    return {
      themes: model.groups.map((g) => ({ value: String(g.id), label: g.title })),
      owners,
      sprints: (sprints.results || []).map((r) => ({ value: r.sprint, label: r.sprint })),
      evidence,
    };
  },
};

/** Add evidence's candidates (decision 4): interviews, demand records, KPI keys and experiments. */
async function evidenceChoices(ctx: RecordContext): Promise<Array<{ kind: string; value: string; label: string }>> {
  const [ivs, signals, revenue, signups, kpis, exps] = await Promise.all([
    ctx.env.DB.prepare('SELECT id, interviewee_name, interview_date, done_at, created_at FROM discovery_interviews WHERE project_id = ? ORDER BY id DESC LIMIT 200')
      .bind(ctx.projectId).all<Any>(),
    ctx.env.DB.prepare('SELECT id, kind, who, signal_date FROM demand_signals WHERE project_id = ? ORDER BY signal_date DESC, id DESC LIMIT 200')
      .bind(ctx.projectId).all<Any>(),
    ctx.env.DB.prepare("SELECT id, customer, received_on FROM revenue_entries WHERE project_id = ? AND revenue_type IN ('deposit', 'pilot') ORDER BY received_on DESC, id DESC LIMIT 200")
      .bind(ctx.projectId).all<Any>(),
    ctx.env.DB.prepare("SELECT id, name, created_at FROM waitlist_signups WHERE project_id = ? AND (audience IS NULL OR audience = 'customer') ORDER BY id DESC LIMIT 200")
      .bind(ctx.projectId).all<Any>(),
    latestKpis(ctx.env, ctx.projectId),
    ctx.env.DB.prepare('SELECT id, title FROM hypothesis_experiments WHERE project_id = ? ORDER BY id DESC LIMIT 200')
      .bind(ctx.projectId).all<Any>(),
  ]);
  return [
    ...(ivs.results || []).map((i) => ({ kind: 'interview', value: String(i.id), label: joined(i.interviewee_name, dMon(heldOf(i))) })),
    ...(signals.results || []).map((s) => ({ kind: 'signal', value: `signal-${s.id}`, label: joined(KIND[s.kind] ?? s.kind, s.who, dMon(s.signal_date)) })),
    ...(revenue.results || []).map((r) => ({ kind: 'signal', value: `revenue-${r.id}`, label: joined('Pre-sale', r.customer, dMon(r.received_on)) })),
    ...(signups.results || []).map((w) => ({ kind: 'signal', value: `waitlist-${w.id}`, label: joined('Waitlist sign-up', w.name, dMon(w.created_at)) })),
    ...KPI_KEYS.filter((k) => kpis.has(k)).map((k) => ({ kind: 'metric', value: k, label: KPI_LABEL[k] })),
    ...(exps.results || []).map((x) => ({ kind: 'experiment', value: String(x.id), label: String(x.title) })),
  ];
}

export const VALIDATE_SPECS: Record<string, ModuleSpec> = {
  'problem-discovery': problemDiscovery,
  'customer-research': customerResearch,
  'ideal-customer-profile': icp,
  'market-intelligence': market,
  'demand-signals': demand,
  experiments,
  verdict: verdictSpec(),
};

