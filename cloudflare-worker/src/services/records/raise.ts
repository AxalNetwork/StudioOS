/**
 * D691 (S19-B, #1699) — Raise's seven records on D690's contract (copy per
 * CO:375-381): Fundraising readiness, Investor narrative, Pitch deck, Data
 * room, Cap table, Use of funds and Capital relationships.
 *
 * WHO. Every gate is the module read's, `canWrite` (decision 2): the
 * venture's owner, an admitted Lab member on their own venture, or an admin.
 * A partner, an advisor member or an investor gets 403; a foreign id 404s in
 * `ownedRow` before any of this runs.
 *
 * WHAT IS DECLARED. Each action beside its handler (#1700 step 6), and each
 * handler calls the writer its PATCH, POST or PUT route calls
 * (`services/raiseWriters.ts`, `routes/data_room.ts`), so a record and a route
 * never write the same row two ways and each write logs its one row. Every id
 * an action body names is declared in `references`, so D690's route proves it
 * with `ownedRow` first. `formOptions` serves each module's Add form (step 9).
 *
 * Each record reads its own store and draws "Not recorded" with its reason
 * where no store holds a value (D-e). Activity is `raise.<slug>`, read through
 * D690's `activityFor`; an older record's "Created by" comes from its store's
 * creator column (decision 12, `cycleActivity.ts`).
 */
import type { ActionResult, ModuleSpec, RecordAction, RecordField, RecordContent, RecordContext, RecordFact, Row, SectionSpec, Store } from './types';
import { activeGrant, ndaActive, removeDataRoomFile, replaceDataRoomFile } from '../../routes/data_room';
import { ACCESS_TIERS, investorCommitted, tierAdmits } from '../dataRoomAccess';
import { SERVED_FUNDS, likeLiteral } from '../researchFundDirectory';
import { RAISE_STAGES } from '../../routes/contacts';
import {
  type Ctx, type ProspectRow, READINESS_ITEMS, TOOL_HREF, DILIGENCE_CHECKLIST, EVIDENCE, FIGURES, FIGURE_LABEL, INVESTOR_TYPES,
  INVESTOR_TYPE_LABEL, FUND_SECTIONS, FIT_LABEL, LIST_STAGE_LABEL, NEVER_EXPIRES, accessText, capIdOf, capEntryOf, checkInputs, consistencyCheck,
  checklistLabel, computeReadiness, fmtFigure, fundCells, groupOf, instrumentOf, loadCap, loadFunds, loadProspects, loadReadiness,
  loadVersions, prospectFunds, requestTitles,
} from '../raiseCycle';
import {
  CHECK_SOURCES, EVENT_KINDS, LINK_EXPIRY_DAYS, START_FROM, WriterError, addProspectFeedback, addSectionHire, duplicateNarrativeVersion,
  logProspectEvent, markProspectPassed, rescoreReadiness, revokeDeckLink, saveUseOfFunds, scoreReadinessItem, updateCapHolder,
  updateNarrativeVersion, updateProspect,
} from '../raiseWriters';

const ctxOf = (rc: RecordContext): Ctx => ({ env: rc.env, projectId: rc.projectId, today: new Date().toISOString().slice(0, 10) });
const day = (v: unknown): string | null => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const clock = (v: unknown): string => String(v ?? '').slice(11, 16);
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const typeLabel = (t: string | null | undefined) => INVESTOR_TYPE_LABEL[t ?? 'other'] ?? 'Other';
/** A fact with its value, or Not recorded with the reason no store holds one. */
const fact = (label: string, value: string | number | null | undefined, reason: string): RecordFact =>
  (value == null || value === '' ? { label, value: null, reason } : { label, value });
/** A module page or a record, addressed as D696's routes are, the venture kept. */
const raiseHref = (rc: RecordContext, slug: string, id?: string | number) =>
  `/raise/${slug}${id == null ? '' : `/${encodeURIComponent(String(id))}`}?project_id=${rc.projectId}`;
const section = (key: string, title: string, read: SectionSpec['read'], extra: Partial<SectionSpec> = {}): SectionSpec =>
  ({ key, title, gate: 'write', read, ...extra });
const duration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const bytes = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : v >= 1e3 ? `${Math.round(v / 1e3)} KB` : `${v} B`;
};

type Body = Record<string, unknown> | FormData;
const userId = (rc: RecordContext) => Number(rc.user.id);
const field = (body: Body, key: string): unknown => (body instanceof FormData ? body.get(key) ?? undefined : body[key]);
const opts = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.map(([value, label]) => ({ value, label }));
/** A JSON body as the writers take it; an action that is not multipart never receives FormData. */
const json = (body: Body): Record<string, unknown> => (body instanceof FormData ? Object.fromEntries(body.entries()) : body);
/** Only the keys a body sends, so an Edit changes what it names and nothing else. */
const picked = (body: Body, keys: readonly string[]) => {
  const b = json(body);
  return Object.fromEntries(keys.filter((k) => Object.prototype.hasOwnProperty.call(b, k)).map((k) => [k, b[k]]));
};
/** A form sends its fields as text: a plain number becomes one, an empty field null, anything else stays for the writer to refuse. */
const whole = (v: unknown): unknown => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : v === '' ? null : v);
const numeric = (b: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, keys.includes(k) ? whole(v) : v]));
/** A positive whole id named in a body, for `references`; anything else fails `ownedRow`. */
const refId = (raw: unknown): string | number => (typeof raw === 'number' || typeof raw === 'string' ? raw : '');

/** A writer's refusal, as the status and sentence its route answers with. */
async function refusing(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await work(); } catch (err) {
    if (err instanceof WriterError) {
      throw new Response(JSON.stringify({ detail: err.sentence }), { status: err.status, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}
const refuse = (status: number, sentence: string) => { throw new WriterError(status, sentence); };

/** What a record read loaded, for its sections; never sent (the route spreads the record). */
const loaded = new WeakMap<RecordContent, any>();
const loadedOf = (record: RecordContent) => loaded.get(record) ?? {};

/** The venture's uid, which the data-room writers' storage prefix is built from. */
async function projectUid(rc: RecordContext): Promise<{ id: number; uid: string }> {
  const p = await rc.env.DB.prepare('SELECT uid FROM projects WHERE id = ?').bind(rc.projectId).first<{ uid: string }>();
  if (!p?.uid) refuse(404, 'Project not found');
  return { id: rc.projectId, uid: String(p!.uid) };
}

/** The venture's prospects, for a link's investor or a holder's (names reach a form, never an id). */
async function prospectOptions(rc: RecordContext) {
  return (await loadProspects(rc.env, rc.projectId)).map((x) => ({
    value: String(x.id), label: [x.name, x.firm].filter(Boolean).join(' · ') || `Investor ${x.id}`,
  }));
}

/** The upload form's five folder names (CO:320), offered until each exists. */
const CANVAS_FOLDERS = ['Financials', 'Legal', 'Team', 'Product', 'Customers'] as const;
const TIER_LABEL: Record<string, string> = { invited: 'Invited investors', committed: 'Committed investors only', nobody: 'Nobody yet' };

function spec(
  store: Store, slug: string, record: ModuleSpec['record'], sections: SectionSpec[],
  actions: ModuleSpec['actions'], formOptions: NonNullable<ModuleSpec['formOptions']>,
): ModuleSpec {
  return { read: 'write', write: 'write', store, activityType: `raise.${slug}`, record, sections, actions, formOptions };
}

// ---------------------------------------------------------------------------
// Fundraising readiness — id: the item key (decision 3)
// ---------------------------------------------------------------------------

/** The tool or module each item's check reads, for Opens. Team is scored by a person and reads none. */
const OPENS: Record<string, { a: string; href: (rc: RecordContext) => string }> = {
  narrative: { a: 'Investor narrative', href: (rc) => raiseHref(rc, 'investor-narrative') },
  deck: { a: 'Pitch deck', href: () => TOOL_HREF.pitch },
  data_room: { a: 'Data room', href: () => TOOL_HREF.dataRoom },
  cap_table: { a: 'Cap table', href: () => TOOL_HREF.capTable },
  use_of_funds: { a: 'Use of funds', href: (rc) => raiseHref(rc, 'use-of-funds') },
  traction: { a: 'Metrics', href: () => TOOL_HREF.metrics },
};

const readiness = spec('readiness_items', 'fundraising-readiness', async (rc, id) => {
  const item = READINESS_ITEMS.find((i) => i.key === id)!;
  const { items, scores } = await loadReadiness(ctxOf(rc));
  const row = items.find((i) => i.item_key === id) ?? null;
  const mine = row ? scores.filter((s) => Number(s.item_id) === Number(row.id)) : [];
  const s = mine.at(-1) ?? null; // scores arrive oldest first
  const computed = id === 'team' ? null : (await computeReadiness(rc.env, rc.projectId)).find((c) => c.key === id) ?? null;
  const notScored = 'Not scored yet';
  const out: RecordContent = {
    title: item.label,
    sub: s ? `Readiness item · scored ${day(s.scored_at)}` : 'Readiness item · not scored yet',
    pills: s?.score != null
      ? [{ text: s.score == null ? 'Not scored' : `${Number(s.score)} / 10`, tone: s.score == null ? 'grey' : s.score >= 8 ? 'ok' : s.score >= 5 ? 'amb' : 'bad' }, { text: cap1(String(s.evidence)), tone: 'vio' }]
      : [{ text: 'Not scored', tone: 'grey' }],
    facts: [
      fact('Score', s?.score != null ? `${Number(s.score)} / 10` : null, notScored),
      fact('Evidence', s?.score != null ? cap1(String(s.evidence)) : null, s?.missing || notScored),
      fact('Missing', s ? String(s.missing ?? '').trim() || 'Nothing' : null, notScored),
      fact('Last scored', s ? day(s.scored_at) : null, notScored),
    ],
  };
  loaded.set(out, { mine, computed });
  return out;
}, [
  section('reads', 'What the score reads', async (_rc, id, record) => {
    const { computed } = loadedOf(record);
    if (id === 'team') return { rows: [], empty: 'Team is scored by a person, not by a check.' };
    return { rows: (computed?.reads ?? []) as Row[], empty: 'No check reads this item.' };
  }),
  // Decision 8: the Data room item only, from the diligence checklist; not services/dueDiligence.ts.
  section('mock-diligence', 'Mock diligence', async (rc) => {
    const res = await rc.env.DB.prepare(
      `SELECT checklist_item, name FROM data_room_files WHERE project_id = ? AND checklist_item IS NOT NULL
        ORDER BY updated_at DESC, id DESC`,
    ).bind(rc.projectId).all<{ checklist_item: string; name: string }>();
    const file = new Map<string, string>();
    for (const f of res.results || []) if (!file.has(f.checklist_item)) file.set(f.checklist_item, f.name);
    return {
      rows: DILIGENCE_CHECKLIST.map((c) => (file.has(c.key)
        ? { a: `"${c.label}"`, b: `cites ${file.get(c.key)}`, c: 'Answered', tone: 'ok' }
        : { a: `"${c.label}"`, b: 'file missing', c: 'Open', tone: 'bad' })),
      // Run again re-scores the Data room item (decision 8).
      action: 'rescore',
    };
  }, { when: (id) => id === 'data_room' }),
  section('history', 'Score over time', async (_rc, _id, record) => {
    const { mine } = loadedOf(record);
    return { rows: [...(mine ?? [])].reverse().slice(0, 12).map((s: any) => ({ a: day(s.scored_at) ?? '', b: s.score == null ? (s.missing || 'Not scored') : String(Number(s.score)) })), empty: 'Not scored yet.' };
  }, { side: true }),
  section('opens', 'Opens', async (rc, id) => {
    const o = OPENS[id];
    return o ? { rows: [{ a: o.a, b: 'Open →', href: o.href(rc) }] } : { rows: [], empty: 'Team is scored by a person; no tool reads it.' };
  }, { side: true }),
], async (_rc, id, record): Promise<RecordAction[]> => {
  // Team is scored by a person: a form over `PUT /readiness/team`'s writer.
  if (id === 'team') {
    const s = (loadedOf(record).mine ?? []).at(-1) ?? null;
    return [{
      key: 'score', label: 'Score', kind: 'form', tone: 'primary',
      form: { title: 'Score Team', cta: 'Save score', fields: [
        { key: 'score', label: 'Score', kind: 'CH', options: Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: `${n} / 10` })),
          value: s?.score != null ? String(Number(s.score)) : undefined, required: true },
        { key: 'evidence', label: 'Evidence', kind: 'CH', options: EVIDENCE.filter(e => e === 'anecdote' || e === 'pattern').map((e) => ({ value: e, label: cap1(e) })), value: s?.evidence ?? undefined, required: true },
        { key: 'missing', label: 'Missing', kind: 'T', value: s?.missing ?? '' },
      ] },
      execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await scoreReadinessItem(c.env, {
        projectId: c.projectId, userId: userId(c), key: 'team', score: field(body, 'score'), evidence: field(body, 'evidence'), missing: field(body, 'missing'),
      }) })),
    }];
  }
  // Re-score this item by its check; every earlier score is kept.
  return [{
    key: 'rescore', label: 'Re-score', kind: 'write', tone: 'primary',
    execute: (c, itemKey) => refusing(async () => ({ ok: true, record: await rescoreReadiness(c.env, {
      projectId: c.projectId, userId: userId(c), items: [itemKey], since: 'all',
    }) })),
  }];
}, async (rc) => {
  // The seven items with their last score; Team is scored by hand.
  const { scores } = await loadReadiness(ctxOf(rc)); // oldest first, so the last one kept is the newest
  const newest = new Map<string, any>();
  for (const sc of scores) newest.set(String(sc.item_key), sc);
  return {
    items: READINESS_ITEMS.map((i) => {
      const sc = newest.get(i.key);
      return { value: i.key, label: i.label, by_hand: i.key === 'team', last_scored: sc ? day(sc.scored_at) : null, score: sc?.score != null ? Number(sc.score) : null };
    }),
    since: opts([['all', 'Everything'], ['last', 'Since the last score']]),
    evidence: EVIDENCE.filter(e => e === 'anecdote' || e === 'pattern').map((e) => ({ value: e, label: cap1(e) })),
  };
});

// ---------------------------------------------------------------------------
// Investor narrative — id: the version number
// ---------------------------------------------------------------------------

/** The record's narrative rows: deck keys of the version (decision 7), and Why now from its meta. */
const NARRATIVE_ROWS: Array<[string, string | null]> = [
  ['One-liner', 'cover.thesis'], ['Problem', 'problem.framing'], ['Why now', null], ['Traction', 'traction.takeaway'], ['The ask', 'ask.title'],
];

const narrative = spec('spinout_deck_overrides', 'investor-narrative', async (rc, id) => {
  const n = Number(id);
  const versions = await loadVersions(ctxOf(rc));
  const v = versions.find((x) => Number(x.version) === n)!;
  const meta = await rc.env.DB.prepare(
    'SELECT start_from, based_on_version, why_now, check_against_json FROM narrative_version_meta WHERE project_id = ? AND version = ?',
  ).bind(rc.projectId, n).first<{ start_from: string; based_on_version: number | null; why_now: string | null; check_against_json: string | null }>();
  const mismatches = Number(v?.mismatches ?? 0);
  const compared = Number(v?.compared ?? 0);
  const basedOn = !meta ? null
    : meta.start_from === 'version' && meta.based_on_version != null ? `v${meta.based_on_version}`
      : meta.start_from === 'blank' ? 'Blank' : 'The live deck';
  const out: RecordContent = {
    title: `v${n} · ${typeLabel(v?.investor_type).toLowerCase()}`,
    sub: `Saved ${day(v?.saved_at) ?? 'on an unrecorded day'} · No deck reads this version.`,
    pills: [{ text: typeLabel(v?.investor_type), tone: 'vio' }, { text: compared ? plural(mismatches, 'mismatch', 'mismatches') : 'Nothing compared yet', tone: !compared ? 'grey' : mismatches ? 'amb' : 'ok' }],
    facts: [
      fact('Investor type', typeLabel(v?.investor_type), ''),
      fact('Deck use', 'No deck reads this version.', ''),
      fact('Mismatches', compared ? mismatches : null, 'Nothing compared yet'),
      fact('Based on', basedOn, 'Saved before versions recorded their source'),
    ],
  };
  loaded.set(out, { versions, meta });
  return out;
}, [
  section('narrative', 'The narrative', async (rc, id, record) => {
    const { meta } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      'SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ?',
    ).bind(rc.projectId, Number(id)).all<{ field_key: string; value: string }>();
    const words = new Map((res.results || []).map((w) => [w.field_key, String(w.value ?? '').trim()]));
    return {
      rows: NARRATIVE_ROWS.map(([a, key]) => {
        const text = key ? words.get(key) : String(meta?.why_now ?? '').trim();
        return text ? { a, b: text } : { a, b: '', c: 'Not recorded', tone: 'grey' };
      }),
      action: 'edit',
    };
  }),
  // Each current stated/metric comparison: mismatch, agreement, or not compared (D907).
  section('consistency', 'Consistency check', async (rc, id) => {
    const n = Number(id);
    const { stated, metrics } = await checkInputs(rc.env, rc.projectId, n);
    const found = consistencyCheck(stated, metrics);
    return {
      rows: [{ a: 'Pitch deck', b: 'No deck bindings are recorded.', c: 'Not compared', tone: 'grey' }, ...FIGURES.map((f) => {
        const m = found.find(m => m.figure === f);
        if (m) return { a: FIGURE_LABEL[f], b: `stated ${fmtFigure(f, Number(m.stated_value))} · metrics ${fmtFigure(f, Number(m.metric_value))}`, c: 'Mismatch', tone: 'bad' };
        if (stated.some((s) => s.figure === f && Number.isFinite(s.value)) && Number.isFinite(metrics[f]?.value)) return { a: FIGURE_LABEL[f], b: 'consistent everywhere', c: 'OK', tone: 'ok' };
        return { a: FIGURE_LABEL[f], b: 'stated or stored in one place only', c: 'Not compared', tone: 'grey' };
      })],
    };
  }),
  section('feedback', 'Investor feedback', async (rc) => {
    const res = await rc.env.DB.prepare(
      `SELECT f.objection, COUNT(*) AS n FROM raise_prospect_feedback f JOIN raise_prospects p ON p.id = f.prospect_id
        WHERE p.project_id = ? GROUP BY f.objection ORDER BY n DESC, f.objection LIMIT 10`,
    ).bind(rc.projectId).all<{ objection: string; n: number }>();
    return { rows: (res.results || []).map((r) => ({ a: `"${r.objection}"`, b: `raised ${plural(Number(r.n), 'time', 'times')}` })), empty: 'No investor feedback recorded.' };
  }, { side: true }),
  section('versions', 'Versions', async (rc, id, record) => {
    const { versions } = loadedOf(record);
    return {
      rows: (versions ?? []).filter((x: any) => String(x.version) !== id).slice(0, 12).map((x: any) => ({
        a: `v${x.version} · ${typeLabel(x.investor_type).toLowerCase()}`, b: day(x.saved_at) ?? '', href: raiseHref(rc, 'investor-narrative', x.version),
      })),
      empty: 'No other version saved.',
    };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { versions, meta } = loadedOf(record);
  const v = (versions ?? []).find((x: any) => String(x.version) === id);
  const words = await rc.env.DB.prepare(
    "SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key IN ('cover.thesis', 'ask.title')",
  ).bind(rc.projectId, Number(id)).all<{ field_key: string; value: string }>();
  const word = (key: string) => (words.results || []).find((w) => w.field_key === key)?.value ?? '';
  let against: string[] = [...CHECK_SOURCES];
  try { const parsed = JSON.parse(String((meta as any)?.check_against_json ?? '')); if (Array.isArray(parsed)) against = parsed; } catch { /* the default */ }
  return [
    // The next version, started from this one (decision 7).
    {
      key: 'duplicate', label: 'Duplicate', kind: 'write',
      execute: (c, version) => refusing(async () => ({ ok: true, record: await duplicateNarrativeVersion(c.env, { projectId: c.projectId, userId: userId(c), version }) })),
    },
    // PATCH /narrative-versions/:version's writer; Start from is set when a version is made.
    {
      key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
      form: { title: `Edit v${id}`, cta: 'Save version', fields: [
        { key: 'investor_type', label: 'Investor type', kind: 'CH', options: INVESTOR_TYPES.map((t) => ({ value: t, label: typeLabel(t) })), value: v?.investor_type ?? undefined, required: true },
        { key: 'one_liner', label: 'One-liner', kind: 'T', value: word('cover.thesis') },
        { key: 'why_now', label: 'Why now', kind: 'T', value: (meta as any)?.why_now ?? '' },
        { key: 'ask', label: 'The ask', kind: 'T', value: word('ask.title') },
        { key: 'check_against', label: 'Check against', kind: 'CK', options: opts([['deck', 'Pitch deck'], ['metrics', 'Metrics']]), value: against },
      ] },
      execute: (c, version, body) => refusing(async () => {
        const b = json(body);
        if ('start_from' in b) refuse(400, 'Start from is set when the version is made');
        return { ok: true, record: await updateNarrativeVersion(c.env, {
          projectId: c.projectId, userId: userId(c), version,
          investorType: b.investor_type, basedOnVersion: b.based_on_version, oneLiner: b.one_liner, whyNow: b.why_now, ask: b.ask, checkAgainst: b.check_against,
        }) };
      }),
      references: (body) => (field(body, 'based_on_version') == null ? [] : [{ store: 'spinout_deck_overrides', id: refId(field(body, 'based_on_version')) }]),
    },
  ];
}, async (rc) => {
  // Investor types, saved versions to start from, and the two check sources (decision 7).
  const versions = await loadVersions(ctxOf(rc));
  return {
    investor_types: INVESTOR_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
    start_from: START_FROM.map((k) => ({ value: k, label: k === 'live' ? 'The live deck' : k === 'version' ? 'A saved version' : 'Blank' })),
    versions: versions.map((x) => ({ value: String(x.version), label: `v${x.version} · ${typeLabel(x.investor_type).toLowerCase()}` })),
    check_against: opts([['deck', 'Pitch deck'], ['metrics', 'Metrics']]),
  };
});

// ---------------------------------------------------------------------------
// Pitch deck — id: the share token's id
// ---------------------------------------------------------------------------

const pitch = spec('pitch_deck_share_tokens', 'pitch-deck', async (rc, id) => {
  const t = await rc.env.DB.prepare(
    `SELECT t.id, t.created_at, t.expires_at, t.revoked_at, t.view_count, t.investor_label, t.allow_download, t.allow_forwarding,
            d.version AS deck_version, p.id AS prospect_ref, p.name AS prospect_name, p.firm AS prospect_firm,
            (SELECT COALESCE(SUM(v.read_seconds), 0) FROM deck_share_views v WHERE v.share_token_id = t.id) AS seconds,
            (SELECT s.slide_index FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
              WHERE v.share_token_id = t.id GROUP BY s.slide_index HAVING SUM(s.seconds) > 0
              ORDER BY SUM(s.seconds) DESC, s.slide_index LIMIT 1) AS top_slide
       FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
       LEFT JOIN raise_prospects p ON p.id = t.prospect_id AND p.project_id = d.project_id
      WHERE t.id = ? AND d.project_id = ?`,
  ).bind(Number(id), rc.projectId).first<any>();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const state = t.revoked_at ? 'revoked' : String(t.expires_at) < now ? 'expired' : 'active';
  const never = String(t.expires_at).startsWith(NEVER_EXPIRES.slice(0, 10));
  const investor = [t.prospect_name, t.prospect_firm].filter(Boolean).join(' · ')
    || String(t.investor_label ?? '').trim() || `Link created ${day(t.created_at) ?? 'on an unrecorded day'}`;
  const expires = state === 'revoked' ? 'Revoked' : never ? 'Never' : day(t.expires_at);
  const out: RecordContent = {
    title: `${investor} · link`,
    sub: [`Deck v${Number(t.deck_version)}`,
      state === 'revoked' ? `revoked ${day(t.revoked_at) ?? ''}`.trim() : never ? 'never expires' : `${state === 'expired' ? 'expired' : 'expires'} ${day(t.expires_at)}`].join(' · '),
    pills: [state === 'active' ? { text: 'Active', tone: 'ok' } : state === 'expired' ? { text: 'Expired', tone: 'grey' } : { text: 'Revoked', tone: 'bad' }],
    facts: [
      fact('Views', Number(t.view_count) || 0, ''),
      fact('Time on deck', `${Math.round((Number(t.seconds) || 0) / 60)} min`, ''),
      fact('Most read', t.top_slide == null ? null : `Slide ${Number(t.top_slide) + 1}`, 'No slide time recorded'),
      fact('Expires', expires, 'No expiry recorded'),
    ],
  };
  loaded.set(out, { t });
  return out;
}, [
  // No city: only a hashed IP is stored (decision 1, D-q).
  section('views', 'Views', async (rc, id) => {
    const res = await rc.env.DB.prepare(
      `SELECT v.created_at, v.read_seconds,
              (SELECT MIN(s.slide_index) FROM deck_view_slides s WHERE s.view_id = v.id AND s.seconds > 0) AS first_slide,
              (SELECT MAX(s.slide_index) FROM deck_view_slides s WHERE s.view_id = v.id AND s.seconds > 0) AS last_slide
         FROM deck_share_views v WHERE v.share_token_id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 20`,
    ).bind(Number(id)).all<{ created_at: string; read_seconds: number; first_slide: number | null; last_slide: number | null }>();
    return {
      rows: (res.results || []).map((v) => ({
        a: `${day(v.created_at) ?? ''} · ${clock(v.created_at)}`,
        b: [`${Math.round((Number(v.read_seconds) || 0) / 60)} min`, v.first_slide == null ? null
          : `slides ${Number(v.first_slide) + 1}–${Number(v.last_slide) + 1}`].filter(Boolean).join(' · '),
      })),
      empty: 'Not opened yet.',
    };
  }),
  section('slides', 'Time per slide', async (rc, id) => {
    const res = await rc.env.DB.prepare(
      `SELECT s.slide_index, SUM(s.seconds) AS seconds FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
        WHERE v.share_token_id = ? GROUP BY s.slide_index HAVING SUM(s.seconds) > 0 ORDER BY seconds DESC, s.slide_index LIMIT 12`,
    ).bind(Number(id)).all<{ slide_index: number; seconds: number }>();
    return { rows: (res.results || []).map((r) => ({ a: `Slide ${Number(r.slide_index) + 1}`, b: duration(Number(r.seconds)) })), empty: 'No slide time recorded.' };
  }),
  section('settings', 'Settings', async (_rc, _id, record) => {
    const { t } = loadedOf(record);
    return { rows: [{ a: 'Download', b: Number(t?.allow_download) === 0 ? 'Off' : 'On' }, { a: 'Forwarding', b: Number(t?.allow_forwarding) === 0 ? 'Off' : 'On' }] };
  }, { side: true }),
  section('investor', 'Investor', async (rc, _id, record) => {
    const { t } = loadedOf(record);
    if (t?.prospect_ref != null) {
      return { rows: [{ a: [t.prospect_name, t.prospect_firm].filter(Boolean).join(' · ') || 'Investor', b: 'Capital relationships →', href: raiseHref(rc, 'capital-relationships', t.prospect_ref) }] };
    }
    return { rows: [], empty: 'Not made for an investor in Capital relationships.' };
  }, { side: true }),
], async (_rc, _id, record): Promise<RecordAction[]> => {
  // No Copy link: the raw link is shown once, when it is made (decision 5).
  if (loadedOf(record).t?.revoked_at) return [];
  return [{
    key: 'revoke', label: 'Revoke', kind: 'write', tone: 'danger',
    confirm: { title: 'Revoke this link?', body: 'It stops opening at once. Its views stay.', cta: 'Revoke' },
    execute: (c, linkId) => refusing(async () => ({ ok: true, record: await revokeDeckLink(c.env, { projectId: c.projectId, userId: userId(c), linkId }) })),
  }];
}, async (rc) => {
  // New link: the venture's deck versions, its prospects, and the expiries.
  const decks = await rc.env.DB.prepare(
    'SELECT id, version, COALESCE(is_current, 0) AS is_current FROM pitch_decks WHERE project_id = ? ORDER BY version DESC, id DESC LIMIT 50',
  ).bind(rc.projectId).all<{ id: number; version: number; is_current: number }>();
  return {
    decks: (decks.results || []).map((d) => ({ value: String(d.id), label: `v${Number(d.version)}${Number(d.is_current) ? ' · current' : ''}` })),
    prospects: await prospectOptions(rc),
    expires: [...LINK_EXPIRY_DAYS.map((n) => ({ value: String(n), label: `${n} days` })), { value: 'never', label: 'Never' }],
  };
});

// ---------------------------------------------------------------------------
// Data room — id: the file's id; the record also carries its uid
// ---------------------------------------------------------------------------

/**
 * Who can open the file now (decision 6): each active grant, confirmed by
 * `activeGrant`, whose investor the file's tier and expiry admit
 * (`tierAdmits`, with `investorCommitted` for a committed-only file), and,
 * for an `nda` file, only once that investor's NDA is live (`ndaActive`),
 * the gate `data_room.ts` applies.
 */
async function admittedInvestors(rc: RecordContext, f: any): Promise<Array<{ id: number; name: string | null }>> {
  const res = await rc.env.DB.prepare(
    `SELECT g.investor_user_id, u.name FROM data_room_grants g LEFT JOIN users u ON u.id = g.investor_user_id
      WHERE g.project_id = ? AND g.status = 'active' ORDER BY g.id LIMIT 50`,
  ).bind(rc.projectId).all<{ investor_user_id: number; name: string | null }>();
  const out: Array<{ id: number; name: string | null }> = [];
  for (const g of res.results || []) {
    const investor = Number(g.investor_user_id);
    const grant = await activeGrant(rc.env, rc.projectId, investor);
    if (!grant) continue;
    const committed = f.access_tier === 'committed' ? await investorCommitted(rc.env, rc.projectId, investor) : false;
    if (!tierAdmits(f, committed)) continue;
    if (f.visibility === 'nda' && !(await ndaActive(rc.env, grant.granted_by_user_id, investor))) continue;
    out.push({ id: investor, name: g.name });
  }
  return out;
}

const dataRoom = spec('data_room_files', 'data-room', async (rc, id) => {
  const f = await rc.env.DB.prepare(
    `SELECT f.id, f.uid, f.name, f.folder_id, f.visibility, f.checklist_item, f.dd_request_id, f.access_tier, f.access_expires_at,
            f.size_bytes, f.created_at, d.name AS folder, u.name AS uploader
       FROM data_room_files f LEFT JOIN data_room_folders d ON d.id = f.folder_id LEFT JOIN users u ON u.id = f.uploaded_by_user_id
      WHERE f.id = ? AND f.project_id = ?`,
  ).bind(Number(id), rc.projectId).first<any>();
  const requestId = Number(f.dd_request_id);
  const titles = await requestTitles(ctxOf(rc), Number.isInteger(requestId) && requestId > 0 ? [requestId] : []);
  const answers = titles.get(requestId) ?? checklistLabel(f.checklist_item);
  const out: RecordContent = {
    title: String(f.name),
    uid: String(f.uid),
    sub: [f.folder ?? 'Top level', `uploaded ${day(f.created_at) ?? 'on an unrecorded day'}`, bytes(f.size_bytes)].filter(Boolean).join(' · '),
    pills: [answers ? { text: `Answers ${answers}`, tone: 'ok' } : { text: 'Answers nothing yet', tone: 'grey' },
      ...(f.visibility === 'nda' ? [{ text: 'NDA', tone: 'vio' }] : [])],
    facts: [
      fact('Folder', f.folder ?? 'Top level', ''),
      fact('Answers', answers, 'Not matched to a diligence request or a checklist item'),
      fact('Access', accessText(f), ''),
      fact('Watermark', null, 'The room does not watermark'),
    ],
  };
  loaded.set(out, { f, admitted: await admittedInvestors(rc, f), requestId: titles.has(requestId) ? requestId : null });
  return out;
}, [
  // Downloads and blocked tries; no per-file view is logged, so no row says Viewed (data_room.ts:26-30).
  section('opened', 'Who opened it', async (rc, id, record) => {
    const { admitted } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      `SELECT l.user_id, u.name, l.action, MAX(l.created_at) AS at FROM data_room_access_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.project_id = ? AND l.file_id = ? AND l.action IN ('download', 'blocked')
        GROUP BY l.user_id, l.action ORDER BY at DESC LIMIT 20`,
    ).bind(rc.projectId, Number(id)).all<{ user_id: number; name: string | null; action: string; at: string }>();
    const opened = res.results || [];
    const rows: Row[] = opened.map((r) => ({ a: r.name ?? 'An investor', b: day(r.at) ?? '', c: r.action === 'download' ? 'Downloaded' : 'Blocked', tone: r.action === 'download' ? 'ok' : 'bad' }));
    for (const g of admitted ?? []) {
      if (!opened.some((r) => Number(r.user_id) === g.id)) rows.push({ a: g.name ?? 'An investor', b: 'never', c: 'Not opened', tone: 'grey' });
    }
    return { rows, empty: 'Nobody outside the venture has opened it.' };
  }),
  section('versions', 'Versions', async (rc, id, record) => {
    const { f } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      `SELECT v.version, v.created_at, u.name FROM data_room_file_versions v LEFT JOIN users u ON u.id = v.uploaded_by
        WHERE v.file_id = ? ORDER BY v.version DESC LIMIT 12`,
    ).bind(Number(id)).all<{ version: number; created_at: string; name: string | null }>();
    const versions = res.results || [];
    // A file uploaded before 463 kept no versions: the file is its own first.
    if (versions.length === 0) {
      return { rows: [{ a: 'v1', b: [day(f?.created_at), f?.uploader].filter(Boolean).join(' · '), c: 'Current', tone: 'ok' }], action: 'replace' };
    }
    return {
      rows: versions.map((v, i) => ({ a: `v${v.version}`, b: [day(v.created_at), v.name].filter(Boolean).join(' · '), ...(i === 0 ? { c: 'Current', tone: 'ok' } : {}) })),
      action: 'replace',
    };
  }),
  section('access', 'Access', async (_rc, _id, record) => {
    const { f, admitted } = loadedOf(record);
    const rows: Row[] = (admitted ?? []).map((g: any) => ({ a: g.name ?? 'An investor', b: f?.visibility === 'nda' ? 'NDA live' : 'Can open it now' }));
    const until = day(f?.access_expires_at);
    if (until && rows.length) rows.push({ a: 'Expires', b: until });
    return { rows, empty: 'No investor can open it now.' };
  }, { side: true }),
  section('diligence', 'Diligence', async (rc, _id, record) => {
    const { f, requestId } = loadedOf(record);
    if (requestId != null) {
      const r = await rc.env.DB.prepare(
        `SELECT r.title, r.state FROM dd_requests r JOIN dd_cases c ON c.id = r.case_id
          WHERE r.id = ? AND c.subject_type = 'project' AND c.subject_id = ?`,
      ).bind(requestId, rc.projectId).first<{ title: string; state: string }>();
      if (r) return { rows: [{ a: 'Request', b: `${r.title} · ${r.state}` }] };
    }
    const label = checklistLabel(f?.checklist_item ?? null);
    return label ? { rows: [{ a: 'Checklist item', b: label }] } : { rows: [], empty: 'Not matched to a diligence request.' };
  }, { side: true }),
], async (rc): Promise<RecordAction[]> => [
  // Decision 6: grants and the NDA switches live in the file tool.
  { key: 'manage-access', label: 'Manage access', kind: 'link', tone: 'primary', href: `/raise/data-room?mode=workspace&project_id=${rc.projectId}` },
  // The current object becomes a version; the new one takes its place.
  {
    key: 'replace', label: 'Replace', kind: 'form', multipart: true,
    form: { title: 'Replace the file', sub: 'The current file is kept as a version.', cta: 'Replace', fields: [{ key: 'file', label: 'File', kind: 'T', input: 'file', required: true }] },
    execute: (c, fileId, body) => refusing(async () => {
      const file = body instanceof FormData ? body.get('file') : null;
      if (!file || typeof file === 'string') refuse(400, 'Choose a file');
      const blob = file as File;
      return { ok: true, record: await replaceDataRoomFile(c.env, {
        project: await projectUid(c), userId: userId(c), fileId: Number(fileId),
        bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type || null,
      }) };
    }),
  },
  // The same delete as `DELETE /:projectUid/files/:fileUid`, with its versions' objects.
  {
    key: 'remove', label: 'Remove', kind: 'write', tone: 'danger',
    confirm: { title: 'Remove this file?', body: 'The file and its earlier versions are deleted. Investors stop seeing it.', cta: 'Remove' },
    execute: (c, fileId) => refusing(async () => {
      const out = await removeDataRoomFile(c.env, { project: await projectUid(c), userId: userId(c), fileId: Number(fileId) });
      if (!out) refuse(404, 'File not found');
      return { ok: true, record: out };
    }),
  },
], async (rc) => {
  const { uid } = await projectUid(rc);
  const folders = await rc.env.DB.prepare(
    'SELECT uid, name FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL ORDER BY name, id LIMIT 100',
  ).bind(rc.projectId).all<{ uid: string; name: string }>();
  const have = new Set((folders.results || []).map((f) => f.name.trim().toLowerCase()));
  const requests = await rc.env.DB.prepare(
    `SELECT r.id, r.title FROM dd_requests r JOIN dd_cases c ON c.id = r.case_id
      WHERE c.subject_type = 'project' AND c.subject_id = ? AND COALESCE(r.state, 'requested') != 'reviewed'
      ORDER BY r.id LIMIT 100`,
  ).bind(rc.projectId).all<{ id: number; title: string }>();
  return {
    project_uid: uid,
    // A folder that exists goes by its uid; one of the canvas's five not made yet, by name (the upload's `folder_name`).
    folders: [
      ...(folders.results || []).map((f) => ({ value: f.uid, label: f.name })),
      ...CANVAS_FOLDERS.filter((n) => !have.has(n.toLowerCase())).map((n) => ({ folder_name: n, label: n })),
    ],
    requests: (requests.results || []).map((r) => ({ value: String(r.id), label: r.title })),
    checklist: DILIGENCE_CHECKLIST.map((c) => ({ value: c.key, label: c.label, area: c.area })),
    tiers: ACCESS_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] })),
  };
});

// ---------------------------------------------------------------------------
// Cap table — id: decision 4 (h-<holder>, e-<n>, pool)
// ---------------------------------------------------------------------------

function entryFor(id: string, inputs: any): { entry: any; type: string } | null {
  for (const [list, type] of [['founders', 'founder'], ['safes', 'safe'], ['rounds', 'preferred']] as const) {
    const entries = Array.isArray(inputs?.[list]) ? inputs[list] : [];
    const hit = entries.find((e: any) => (id.startsWith('h-') ? `h-${Number(e?.holder_id)}` === id : e?.key === id));
    if (hit) return { entry: hit, type };
  }
  return null;
}

const capTable = spec('cap_table_scenarios', 'cap-table', async (rc, id) => {
  const cap = await loadCap(ctxOf(rc));
  const row = cap.rows.find((r) => capIdOf(r, cap.inputs) === id) ?? null;
  const found = id === 'pool' ? null : (row ? { entry: capEntryOf(row, cap.inputs), type: row.type } : entryFor(id, cap.inputs));
  const type = row?.type ?? (id === 'pool' ? 'option_pool' : found?.type ?? 'founder');
  const entry = found?.entry ?? null;
  const name = row?.holder ?? (id === 'pool' ? 'Option Pool' : String(entry?.name ?? 'Holder'));
  const inst = row ? instrumentOf(row, cap.inputs) : { key: type === 'safe' ? 'safe' : 'common', text: type === 'safe' ? 'SAFE' : 'Common' };
  const short = inst.text.split(' · ')[0];
  const amount = type === 'safe' ? Number(entry?.amount) : type === 'preferred' ? Number(entry?.investment) : NaN;
  const capV = Number(entry?.cap);
  const disc = Number(entry?.discount);
  const capDiscount = type === 'safe'
    ? [Number.isFinite(capV) && capV > 0 ? `${usd(capV)} cap` : 'no cap', Number.isFinite(disc) && disc > 0 ? `${Math.round(disc * 100)}% discount` : 'no discount'].join(' · ')
    : null;
  const amountText = Number.isFinite(amount) && amount > 0 ? usd(amount)
    : type === 'founder' && Number(entry?.shares) > 0 ? `${Number(entry.shares).toLocaleString('en-US')} shares` : null;
  const noRound = 'No round is planned in the cap table';
  const out: RecordContent = {
    title: name,
    sub: [short, amountText, type === 'safe' && Number.isFinite(capV) && capV > 0 ? `${usd(capV)} cap` : null,
      row?.before != null ? `${row.before}% before the round` : null].filter(Boolean).join(' · '),
    pills: [{ text: short, tone: 'vio' },
      ...(type === 'safe' ? [{ text: cap.roundName ? `Converts at ${cap.roundName}` : 'Converts at next round', tone: 'grey' }] : [])],
    facts: [
      fact('Instrument', inst.text, ''),
      fact('Amount', amountText, type === 'option_pool' ? 'The pool holds options, not an investment' : 'No amount recorded'),
      fact('Cap · discount', capDiscount, 'Only a SAFE or a note has a cap'),
      fact('After round', cap.roundName && row?.after != null ? `${row.after}%` : null, noRound),
    ],
  };
  loaded.set(out, { cap, row, entry, type, name });
  return out;
}, [
  // At the planned round, as simulate converted it (its own event line), else Not recorded.
  section('conversion', 'Conversion', async (_rc, _id, record) => {
    const { cap, row, type, name } = loadedOf(record);
    if (!cap?.round) return { rows: [], empty: 'Not recorded: no round is planned in the cap table.' };
    const pre = cap.round.preMoney != null ? `At ${usd(cap.round.preMoney)} pre-money` : `At ${cap.round.name}`;
    if (type === 'safe') {
      const line = cap.round.events.find((e: string) => e.includes(`'${name}' converted`));
      const binding = line ? /\(binding: ([^)]+)\)/.exec(line)?.[1] : null;
      return { rows: [{ a: pre, b: binding ? `${binding} applies` : 'converts', c: row?.after != null ? `${row.after}%` : '', tone: 'vio' }] };
    }
    return {
      rows: [
        { a: 'Before the round', b: '', c: row?.before != null ? `${row.before}%` : '' },
        { a: pre, b: `after ${cap.round.name}`, c: row?.after != null ? `${row.after}%` : '', tone: 'vio' },
      ],
    };
  }),
  // The entry's prospect's SAFE documents, with their envelope's status; no side-letter store.
  section('documents', 'Documents', async (rc, _id, record) => {
    const { entry, type } = loadedOf(record);
    if (type === 'founder' || type === 'option_pool') return { rows: [], empty: 'No document is recorded for this holder.' };
    const rows: Row[] = [];
    const prospect = Number(entry?.prospect_id);
    if (Number.isInteger(prospect) && prospect > 0) {
      const res = await rc.env.DB.prepare(
        `SELECT s.created_at, e.status, e.completed_at FROM safe_issuances s JOIN raise_prospects p ON p.id = s.prospect_id AND p.project_id = s.project_id
           LEFT JOIN esign_envelopes e ON e.id = s.envelope_id
          WHERE s.project_id = ? AND s.prospect_id = ? ORDER BY s.id DESC LIMIT 5`,
      ).bind(rc.projectId, prospect).all<{ created_at: string; status: string | null; completed_at: string | null }>();
      for (const d of res.results || []) {
        const signed = d.status === 'completed' || d.status === 'signed';
        rows.push(signed
          ? { a: 'SAFE', b: `signed ${day(d.completed_at) ?? ''}`.trim(), c: 'Signed', tone: 'ok' }
          : d.status ? { a: 'SAFE', b: `sent ${day(d.created_at) ?? ''}`.trim(), c: cap1(d.status), tone: 'amb' }
            : { a: 'SAFE', b: `drafted ${day(d.created_at) ?? ''}`.trim(), c: 'Not sent', tone: 'grey' });
      }
    }
    rows.push({ a: 'Side letter', b: '', c: 'Not recorded', tone: 'grey' });
    return { rows };
  }),
  section('holder', 'Holder', async (rc, _id, record) => {
    const { entry, type, name } = loadedOf(record);
    const rows: Row[] = [];
    const prospect = Number(entry?.prospect_id);
    // The prospect is linked only while it is still this venture's (decision 4).
    if (Number.isInteger(prospect) && prospect > 0) {
      const p = await rc.env.DB.prepare('SELECT id FROM raise_prospects WHERE id = ? AND project_id = ?').bind(prospect, rc.projectId).first();
      if (p) rows.push({ a: name, b: 'Capital relationships →', href: raiseHref(rc, 'capital-relationships', prospect) });
    }
    rows.push({ a: 'Group', b: groupOf(type) });
    return { rows };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const actions: RecordAction[] = [{ key: 'model-a-round', label: 'Model a round', kind: 'link', href: '/raise/cap-table/variants' }];
  const { entry, type, name } = loadedOf(record);
  // A founder or a SAFE/note holder is edited through `updateHolder()`; the pool and a round's investors are set in the tool.
  if (type !== 'founder' && type !== 'safe') return actions;
  const money = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? String(Math.round(Number(v) * 100)) : '');
  const fields: RecordAction['form'] = { title: `Edit ${name}`, cta: 'Save holder', fields: type === 'founder'
    ? [
      { key: 'name', label: 'Holder', kind: 'T', value: name, required: true },
      { key: 'shares', label: 'Shares', kind: 'T', value: entry?.shares != null ? String(entry.shares) : '' },
    ]
    : [
      { key: 'name', label: 'Holder', kind: 'T', value: name, required: true },
      { key: 'amount_cents', label: 'Amount', kind: 'T', input: 'money', value: money(entry?.amount) },
      { key: 'cap_cents', label: 'Valuation cap', kind: 'T', input: 'money', value: money(entry?.cap) },
      { key: 'discount_pct', label: 'Discount', kind: 'T', value: Number(entry?.discount) > 0 ? String(Math.round(Number(entry.discount) * 100)) : '', note: 'A percentage.' },
      { key: 'prospect_id', label: 'Investor in Capital relationships', kind: 'CH', options: await prospectOptions(rc), value: entry?.prospect_id != null ? String(entry.prospect_id) : undefined },
    ] };
  actions.push({
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary', form: fields,
    execute: (c, holderId, body) => refusing(async () => {
      const b = json(body);
      if ('group' in b || 'instrument' in b) refuse(400, 'A holder keeps its group and instrument; add a new holder instead');
      const fields = numeric(b, ['shares', 'ownership_pct', 'amount_cents', 'cap_cents', 'discount_pct', 'prospect_id']);
      return { ok: true, record: await updateCapHolder(c.env, { projectId: c.projectId, user: c.user, id: holderId, body: fields }) };
    }),
    references: (body) => (field(body, 'prospect_id') == null || field(body, 'prospect_id') === '' ? [] : [{ store: 'raise_prospects', id: refId(field(body, 'prospect_id')) }]),
  });
  return actions;
}, async (rc) => ({
  // Only the three pairs `addHolder()` takes (decision 4).
  pairs: [
    { group: 'founders', instrument: 'common', label: 'Founders · Common' },
    { group: 'investors', instrument: 'safe', label: 'Investors · SAFE' },
    { group: 'investors', instrument: 'note', label: 'Investors · Convertible note' },
  ],
  vesting: [
    { value: 'none', label: 'None' },
    { value: '4y-1y', label: '4 years, 1-year cliff', total_months: 48, cliff_months: 12 },
    { value: 'custom', label: 'Custom' },
  ],
  prospects: await prospectOptions(rc),
}));

// ---------------------------------------------------------------------------
// Use of funds — id: the section key (decision 9)
// ---------------------------------------------------------------------------

/**
 * Edit split's fields: the raise, the runway, and each section's share and
 * milestone, keyed `<field>.<section key>`. The writer takes `sections` as a
 * list; `splitBody` builds it from these, or passes a body that sends one.
 */
function splitFields(f: Awaited<ReturnType<typeof loadFunds>> | undefined): RecordField[] {
  const fields: RecordField[] = [
    { key: 'amount_to_raise_cents', label: 'Amount to raise', kind: 'T', input: 'money', value: f?.target != null ? String(Math.round(f.target * 100)) : '' },
    { key: 'runway_months', label: 'Runway it buys', kind: 'T', placeholder: '[18] months', value: f?.runway != null ? String(f.runway) : '' },
  ];
  FUND_SECTIONS.forEach((s, i) => {
    const m = (f?.milestones ?? {})[s.key] as { label?: unknown; by?: unknown } | undefined;
    fields.push(
      { key: `pct.${s.key}`, label: s.label, kind: 'T', placeholder: '[%]', value: String(f?.alloc ? f.alloc[i] : 0) },
      { key: `milestone_label.${s.key}`, label: `${s.label} · milestone`, kind: 'T', value: typeof m?.label === 'string' ? m.label : '' },
      { key: `milestone_by.${s.key}`, label: `${s.label} · by`, kind: 'T', placeholder: 'YYYY-MM', value: typeof m?.by === 'string' ? m.by : '' },
    );
  });
  return fields;
}

function splitBody(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['amount_to_raise_cents', 'runway_months']) if (k in b) out[k] = whole(b[k]);
  if (Array.isArray(b.sections)) return { ...out, sections: b.sections };
  out.sections = FUND_SECTIONS.filter((s) => `pct.${s.key}` in b).map((s) => ({
    key: s.key, pct: whole(b[`pct.${s.key}`]),
    ...(`milestone_label.${s.key}` in b ? { milestone_label: b[`milestone_label.${s.key}`] } : {}),
    ...(`milestone_by.${s.key}` in b ? { milestone_by: b[`milestone_by.${s.key}`] } : {}),
  }));
  return out;
}

/** Edit split's sections with their current values (decision 9). */
async function fundsOptions(rc: RecordContext) {
  const f = await loadFunds(ctxOf(rc));
  return {
    sections: FUND_SECTIONS.map((s, i) => {
      const cells = fundCells(f, i);
      const m = (f.milestones ?? {})[s.key] as { label?: unknown; by?: unknown } | undefined;
      return {
        value: s.key, label: s.label, pct: f.alloc ? f.alloc[i] : 0, amount: cells.amount,
        milestone_label: typeof m?.label === 'string' ? m.label : null, milestone_by: typeof m?.by === 'string' ? m.by : null,
      };
    }),
    amount_to_raise: f.target, runway_months: f.runway,
  };
}

const funds = spec('use_of_funds', 'use-of-funds', async (rc, id) => {
  const f = await loadFunds(ctxOf(rc));
  const i = FUND_SECTIONS.findIndex((s) => s.key === id);
  const cells = fundCells(f, i);
  const share = f.alloc ? cells.share : null;
  const out: RecordContent = {
    title: `${cells.category}${share != null ? ` · ${share}%` : ''}`,
    sub: [cells.amount != null ? usd(cells.amount) : null, cells.monthly != null ? `${usd(cells.monthly)} a month` : null,
      cells.milestone ? `buys ${cells.milestone}` : null].filter(Boolean).join(' · ') || 'Not in the split yet',
    pills: [share != null && share > 0 ? { text: `${share}%`, tone: 'vio' } : { text: 'Not in the split', tone: 'grey' }],
    facts: [
      fact('Share', share != null ? `${share}%` : null, 'No split yet'),
      fact('Amount', cells.amount != null ? usd(cells.amount) : null, 'No raise target set'),
      fact('Monthly', cells.monthly != null ? usd(cells.monthly) : null, f.runway == null ? 'No runway set' : 'No raise target set'),
      fact('Milestone', cells.milestone, 'No milestone recorded'),
    ],
  };
  loaded.set(out, { f });
  return out;
}, [
  section('hires', 'Hires it funds', async (rc, id) => {
    const res = await rc.env.DB.prepare(
      'SELECT role, start_month, annual_cents FROM use_of_funds_hires WHERE project_id = ? AND category_key = ? ORDER BY start_month, id LIMIT 20',
    ).bind(rc.projectId, id).all<{ role: string; start_month: string | null; annual_cents: number | null }>();
    return {
      rows: (res.results || []).map((h) => ({ a: h.role, b: h.start_month ? `from ${h.start_month}` : '', c: h.annual_cents != null ? `${usd(Number(h.annual_cents) / 100)} / year` : '' })),
      empty: 'No hire is planned from this category.',
      action: 'add-hire',
    };
  }),
  section('actual', 'Actual against plan', async () => ({ rows: [], empty: 'Not recorded: no store splits spend by category.' })),
  section('feeds', 'Feeds', async (rc, _id, record) => {
    const { f } = loadedOf(record);
    const deck = await rc.env.DB.prepare(
      'SELECT version FROM pitch_decks WHERE project_id = ? ORDER BY COALESCE(is_current, 0) DESC, version DESC, id DESC LIMIT 1',
    ).bind(rc.projectId).first<{ version: number }>();
    return {
      rows: [
        { a: 'Use-of-funds slide', b: deck ? `Pitch deck v${Number(deck.version)}` : 'No deck yet' },
        { a: 'Runway model', b: f?.runway != null ? plural(Number(f.runway), 'month', 'months') : 'No runway set' },
      ],
    };
  }, { side: true }),
], async (_rc, _id, record): Promise<RecordAction[]> => [
  {
    key: 'add-hire', label: 'Add a hire', kind: 'form',
    form: { title: 'Add a hire', cta: 'Add hire', fields: [
      { key: 'role', label: 'Role', kind: 'T', placeholder: '[Senior engineer]', required: true },
      { key: 'start_month', label: 'Starts', kind: 'T', placeholder: 'YYYY-MM' },
      { key: 'annual_cents', label: 'Cost a year', kind: 'T', input: 'money' },
      { key: 'currency', label: 'Currency', kind: 'T', placeholder: 'usd' },
    ] },
    execute: (c, sectionKey, body) => refusing(async () => ({ ok: true, record: await addSectionHire(c.env, {
      projectId: c.projectId, userId: userId(c), sectionKey, body: numeric(picked(body, ['role', 'start_month', 'annual_cents', 'currency']), ['annual_cents']),
    }) })),
  },
  // Edit split is the whole split's PUT: every section is saved together, so it must still total 100.
  {
    key: 'edit-split', label: 'Edit split', kind: 'form', tone: 'primary',
    form: { title: 'Edit split', sub: 'How the round is spent, by category. Each buys a milestone.', cta: 'Save split', fields: splitFields(loadedOf(record).f) },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await saveUseOfFunds(c.env, {
      projectId: c.projectId, userId: userId(c), body: splitBody(json(body)),
    }) })),
  },
], async (rc) => fundsOptions(rc));

// ---------------------------------------------------------------------------
// Capital relationships — id: the prospect's id
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = { meeting: 'Meeting', intro: 'Intro', email: 'Email', call: 'Call', note: 'Note' };
const FIT_TONE: Record<string, string> = { fits: 'ok', outside: 'bad', unclear: 'grey' };

/**
 * Add investor's options (decision 10): the stages; with `q`, up to 20 funds
 * whose name matches, read only through SERVED_FUNDS, so a fund from a list
 * whose terms say 'not allowed' is never offered; and warm-path people from
 * the caller's own `network_connections`, name and company only.
 */
async function capitalOptions(rc: RecordContext, query: Record<string, string>) {
  const q = String(query.q ?? '').trim().slice(0, 120);
  let funds: Array<{ value: string; label: string }> | undefined;
  if (q) {
    const res = await rc.env.DB.prepare(
      `SELECT f.uid, f.name FROM ${SERVED_FUNDS} AS f WHERE f.name LIKE ? ESCAPE '\\' ORDER BY f.name, f.uid LIMIT 20`,
    ).bind(`%${likeLiteral(q)}%`).all<{ uid: string; name: string }>();
    funds = (res.results || []).map((f) => ({ value: String(f.uid), label: String(f.name) }));
  }
  const people = await rc.env.DB.prepare(
    'SELECT name, company FROM network_connections WHERE user_id = ? ORDER BY name, id LIMIT 200',
  ).bind(userId(rc)).all<{ name: string; company: string | null }>();
  return {
    stages: RAISE_STAGES.map((st) => ({ value: st, label: LIST_STAGE_LABEL[st] ?? st })),
    ...(funds ? { funds } : {}),
    warm_paths: (people.results || []).map((x) => ({ value: [x.name, x.company].filter(Boolean).join(' · '), label: [x.name, x.company].filter(Boolean).join(' · ') })),
  };
}

const capital = spec('raise_prospects', 'capital-relationships', async (rc, id) => {
  const ctx = ctxOf(rc);
  const p = (await loadProspects(rc.env, rc.projectId)).find((x) => String(x.id) === id) as ProspectRow;
  const fund = (await prospectFunds(ctx)).get(Number(id)) ?? null;
  const stage = LIST_STAGE_LABEL[p.stage] ?? p.stage;
  const next = p.next_step ? (p.next_step_due ? `${p.next_step} by ${p.next_step_due}` : p.next_step) : null;
  const out: RecordContent = {
    title: [p.name, p.firm].filter(Boolean).join(' · ') || 'Investor',
    sub: [stage, p.last_contact ? `last contact ${day(p.last_contact)}` : null, p.warm_path ? `warm ${p.warm_path}` : null].filter(Boolean).join(' · '),
    pills: [{ text: stage, tone: 'vio' }, ...(fund ? [{ text: FIT_LABEL[fund.fit], tone: FIT_TONE[fund.fit] }] : [])],
    facts: [
      fact('Stage', stage, ''),
      fact('Last contact', day(p.last_contact), 'No contact recorded'),
      fact('Next step', next, 'No next step set'),
      fact('Warm path', p.warm_path, 'No warm path recorded'),
    ],
  };
  loaded.set(out, { p, fund });
  return out;
}, [
  // The stored next step is the timeline's Next row (decision 10).
  section('timeline', 'Timeline', async (rc, id, record) => {
    const { p } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      'SELECT kind, note, done_at, created_at FROM raise_prospect_events WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
    ).bind(Number(id)).all<{ kind: string; note: string | null; done_at: string | null; created_at: string }>();
    const rows: Row[] = p?.next_step ? [{ a: p.next_step, b: p.next_step_due ? `due ${p.next_step_due}` : '', c: 'Next', tone: 'amb' }] : [];
    for (const e of res.results || []) {
      rows.push({ a: `${EVENT_LABEL[e.kind] ?? cap1(e.kind)} · ${day(e.created_at) ?? ''}`, b: e.note ?? '', c: e.done_at ? 'Done' : 'Open', tone: e.done_at ? 'ok' : 'amb' });
    }
    return { rows, empty: 'No contact logged yet.', action: 'log' };
  }),
  section('fit', 'Fit', async (_rc, _id, record) => {
    const { fund } = loadedOf(record);
    if (!fund) return { rows: [], empty: 'Not recorded: no fund from the directory is linked.' };
    return {
      rows: [
        { a: 'Thesis', b: [fund.focus, fund.sector].filter(Boolean).join(' · '), c: FIT_LABEL[fund.fit as keyof typeof FIT_LABEL], tone: FIT_TONE[fund.fit] },
        // The directory has no cheque size, so the fund's size carries no verdict (decision 10).
        { a: 'Fund size', b: fund.fundSizeCents != null ? usd(fund.fundSizeCents / 100) : 'Not recorded' },
      ],
    };
  }),
  section('feedback', 'Feedback', async (rc, id) => {
    const res = await rc.env.DB.prepare(
      'SELECT objection, created_at FROM raise_prospect_feedback WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
    ).bind(Number(id)).all<{ objection: string; created_at: string }>();
    return { rows: (res.results || []).map((f) => ({ a: `"${f.objection}"`, b: day(f.created_at) ?? '' })), empty: 'No feedback recorded.', action: 'add-feedback' };
  }, { side: true }),
  // Deck links made for this prospect, and the room's folders their account opened, matched by email.
  section('materials', 'Materials', async (rc, id) => {
    const rows: Row[] = [];
    const deck = await rc.env.DB.prepare(
      `SELECT COUNT(DISTINCT t.id) AS links, COUNT(v.id) AS views FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
         LEFT JOIN deck_share_views v ON v.share_token_id = t.id WHERE d.project_id = ? AND t.prospect_id = ?`,
    ).bind(rc.projectId, Number(id)).first<{ links: number; views: number }>();
    if (Number(deck?.links ?? 0) > 0) rows.push({ a: 'Deck link', b: `viewed ${Number(deck?.views ?? 0)}×` });
    const room = await rc.env.DB.prepare(
      `SELECT (SELECT COUNT(DISTINCT COALESCE(f.folder_id, 0)) FROM data_room_access_log l
                 JOIN data_room_files f ON f.id = l.file_id AND f.project_id = l.project_id
                 JOIN users u ON u.id = l.user_id
                 JOIN raise_prospects p ON p.id = ? AND p.project_id = l.project_id
                WHERE l.project_id = ? AND l.action = 'download' AND p.email IS NOT NULL AND LOWER(u.email) = LOWER(p.email)) AS opened,
              (SELECT COUNT(DISTINCT COALESCE(folder_id, 0)) FROM data_room_files WHERE project_id = ?) AS total`,
    ).bind(Number(id), rc.projectId, rc.projectId).first<{ opened: number; total: number }>();
    if (Number(room?.opened ?? 0) > 0) rows.push({ a: 'Data room', b: `${Number(room?.opened)} of ${plural(Number(room?.total ?? 0), 'folder', 'folders')}` });
    return { rows, empty: 'No material opened yet.' };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { p } = loadedOf(record);
  const own = await rc.env.DB.prepare('SELECT email, notes FROM raise_prospects WHERE id = ? AND project_id = ?')
    .bind(Number(id), rc.projectId).first<{ email: string | null; notes: string | null }>();
  const prospectId = (raw: string) => Number(raw);
  const actions: RecordAction[] = [
    {
      key: 'log', label: 'Log', kind: 'form',
      form: { title: 'Log a step', cta: 'Log', fields: [
        { key: 'kind', label: 'What', kind: 'CH', options: EVENT_KINDS.map((k) => ({ value: k, label: EVENT_LABEL[k] })), value: 'meeting', required: true },
        { key: 'note', label: 'Note', kind: 'T', placeholder: '[One line]' },
        { key: 'on', label: 'On', kind: 'T', input: 'date', note: 'A later date is due, not done.' },
      ] },
      execute: (c, id, body) => refusing(async () => ({ ok: true, record: await logProspectEvent(c.env, {
        projectId: c.projectId, userId: userId(c), prospectId: prospectId(id), body: picked(body, ['kind', 'note', 'on']),
      }) })),
    },
    {
      key: 'add-feedback', label: 'Add feedback', kind: 'form',
      form: { title: 'Add feedback', cta: 'Add', fields: [
        { key: 'objection', label: 'What they said', kind: 'T', required: true },
        { key: 'answer', label: 'Your answer', kind: 'T' },
      ] },
      execute: (c, id, body) => refusing(async () => ({ ok: true, record: await addProspectFeedback(c.env, {
        projectId: c.projectId, userId: userId(c), prospectId: prospectId(id), body: picked(body, ['objection', 'answer']),
      }) })),
    },
  ];
  if (p?.stage !== 'passed') {
    actions.push({
      key: 'mark-passed', label: 'Mark passed', kind: 'write', tone: 'danger',
      confirm: { title: 'Mark this investor passed?', cta: 'Mark passed' },
      execute: (c, id) => refusing(async () => ({ ok: true, record: await markProspectPassed(c.env, { projectId: c.projectId, userId: userId(c), prospectId: prospectId(id) }) })),
    });
  }
  actions.push({
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit investor', cta: 'Save investor', fields: [
      { key: 'name', label: 'Investor', kind: 'T', value: p?.name ?? '', required: true },
      { key: 'email', label: 'Email', kind: 'T', input: 'email', value: own?.email ?? '' },
      { key: 'stage', label: 'Stage', kind: 'CH', options: RAISE_STAGES.map((st) => ({ value: st, label: LIST_STAGE_LABEL[st] ?? st })), value: p?.stage ?? undefined, required: true },
      { key: 'warm_path', label: 'Warm path', kind: 'T', value: p?.warm_path ?? '' },
      { key: 'next_step', label: 'Next step', kind: 'T', value: p?.next_step ?? '' },
      { key: 'next_step_due', label: 'Due', kind: 'T', input: 'date', value: p?.next_step_due ?? '' },
      { key: 'notes', label: 'Notes', kind: 'T', value: own?.notes ?? '' },
    ] },
    execute: (c, id, body) => refusing(async () => ({ ok: true, record: await updateProspect(c.env, {
      projectId: c.projectId, userId: userId(c), prospectId: prospectId(id),
      body: picked(body, ['name', 'research_fund_uid', 'email', 'stage', 'warm_path', 'next_step', 'next_step_due', 'notes']),
    }) })),
  });
  return actions;
}, async (rc, query) => capitalOptions(rc, query));

/** Raise's module specs, by slug, as `services/records/index.ts` registers them. */
export const RAISE_RECORDS: Record<string, ModuleSpec> = {
  'fundraising-readiness': readiness,
  'investor-narrative': narrative,
  'pitch-deck': pitch,
  'data-room': dataRoom,
  'cap-table': capTable,
  'use-of-funds': funds,
  'capital-relationships': capital,
};
