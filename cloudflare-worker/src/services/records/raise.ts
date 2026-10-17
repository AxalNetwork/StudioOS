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
 * WHAT IS DECLARED. Only actions whose handlers exist (as D690 S18-B does for
 * Build): Manage access on a file and Model a round on a holder, both links.
 * #1700's closing PR declares every other action and section action, each
 * with its handler, so a record never offers a button that does not run.
 *
 * Each record reads its own store and draws "Not recorded" with its reason
 * where no store holds a value (D-e). Activity is `raise.<slug>`, read through
 * D690's `activityFor`; an older record's "Created by" comes from its store's
 * creator column (decision 12, `cycleActivity.ts`).
 */
import type { ModuleSpec, RecordAction, RecordContent, RecordContext, RecordFact, Row, SectionSpec, Store } from './types';
import { activeGrant, ndaActive } from '../../routes/data_room';
import { investorCommitted, tierAdmits } from '../dataRoomAccess';
import {
  type Ctx, type ProspectRow, READINESS_ITEMS, TOOL_HREF, DILIGENCE_CHECKLIST, FIGURES, FIGURE_LABEL, INVESTOR_TYPE_LABEL,
  FUND_SECTIONS, FIT_LABEL, LIST_STAGE_LABEL, NEVER_EXPIRES, accessText, capIdOf, capEntryOf, checkInputs, checklistLabel,
  computeReadiness, fmtFigure, fundCells, groupOf, instrumentOf, loadCap, loadFunds, loadProspects, loadReadiness,
  loadVersions, prospectFunds, requestTitles,
} from '../raiseCycle';

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

/** What a record read loaded, for its sections; never sent (the route spreads the record). */
const loaded = new WeakMap<RecordContent, any>();
const loadedOf = (record: RecordContent) => loaded.get(record) ?? {};

function spec(store: Store, slug: string, record: ModuleSpec['record'], sections: SectionSpec[], actions: ModuleSpec['actions'] = async () => []): ModuleSpec {
  return { read: 'write', write: 'write', store, activityType: `raise.${slug}`, record, sections, actions };
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
    pills: s
      ? [{ text: `${Number(s.score)} / 10`, tone: s.score >= 8 ? 'ok' : s.score >= 5 ? 'amb' : 'bad' }, { text: cap1(String(s.evidence)), tone: 'vio' }]
      : [{ text: 'Not scored', tone: 'grey' }],
    facts: [
      fact('Score', s ? `${Number(s.score)} / 10` : null, notScored),
      fact('Evidence', s ? cap1(String(s.evidence)) : null, notScored),
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
    };
  }, { when: (id) => id === 'data_room' }),
  section('history', 'Score over time', async (_rc, _id, record) => {
    const { mine } = loadedOf(record);
    return { rows: [...(mine ?? [])].reverse().slice(0, 12).map((s: any) => ({ a: day(s.scored_at) ?? '', b: String(Number(s.score)) })), empty: 'Not scored yet.' };
  }, { side: true }),
  section('opens', 'Opens', async (rc, id) => {
    const o = OPENS[id];
    return o ? { rows: [{ a: o.a, b: 'Open →', href: o.href(rc) }] } : { rows: [], empty: 'Team is scored by a person; no tool reads it.' };
  }, { side: true }),
]);

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
    'SELECT start_from, based_on_version, why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?',
  ).bind(rc.projectId, n).first<{ start_from: string; based_on_version: number | null; why_now: string | null }>();
  const mismatches = Number(v?.mismatches ?? 0);
  const deck = v?.deck_version != null ? Number(v.deck_version) : null;
  const basedOn = !meta ? null
    : meta.start_from === 'version' && meta.based_on_version != null ? `v${meta.based_on_version}`
      : meta.start_from === 'blank' ? 'Blank' : 'The live deck';
  const out: RecordContent = {
    title: `v${n} · ${typeLabel(v?.investor_type).toLowerCase()}`,
    sub: [`Saved ${day(v?.saved_at) ?? 'on an unrecorded day'}`, deck != null ? `used by deck v${deck}` : null].filter(Boolean).join(' · '),
    pills: [{ text: typeLabel(v?.investor_type), tone: 'vio' }, { text: plural(mismatches, 'mismatch', 'mismatches'), tone: mismatches ? 'amb' : 'ok' }],
    facts: [
      fact('Investor type', typeLabel(v?.investor_type), ''),
      fact('Used by', deck != null ? `Pitch deck v${deck}` : null, 'No deck version was recorded with it'),
      fact('Mismatches', mismatches, ''),
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
    };
  }),
  // Each figure as the stored check found it: a mismatch, consistent, or not compared (decision 7).
  section('consistency', 'Consistency check', async (rc, id) => {
    const n = Number(id);
    const checks = await rc.env.DB.prepare(
      'SELECT figure, stated_value, metric_value FROM narrative_checks WHERE project_id = ? AND version = ? ORDER BY id',
    ).bind(rc.projectId, n).all<{ figure: string; stated_value: number; metric_value: number }>();
    const found = new Map((checks.results || []).map((c) => [c.figure, c]));
    const { stated, metrics } = await checkInputs(rc.env, rc.projectId, n);
    return {
      rows: FIGURES.map((f) => {
        const m = found.get(f);
        if (m) return { a: FIGURE_LABEL[f], b: `stated ${fmtFigure(f, Number(m.stated_value))} · metrics ${fmtFigure(f, Number(m.metric_value))}`, c: 'Mismatch', tone: 'bad' };
        if (stated.some((s) => s.figure === f) && metrics[f]) return { a: FIGURE_LABEL[f], b: 'consistent everywhere', c: 'OK', tone: 'ok' };
        return { a: FIGURE_LABEL[f], b: 'stated or stored in one place only', c: 'Not compared', tone: 'grey' };
      }),
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
]);

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
]);

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
      return { rows: [{ a: 'v1', b: [day(f?.created_at), f?.uploader].filter(Boolean).join(' · '), c: 'Current', tone: 'ok' }] };
    }
    return { rows: versions.map((v, i) => ({ a: `v${v.version}`, b: [day(v.created_at), v.name].filter(Boolean).join(' · '), ...(i === 0 ? { c: 'Current', tone: 'ok' } : {}) })) };
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
]);

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
], async (): Promise<RecordAction[]> => [
  { key: 'model-a-round', label: 'Model a round', kind: 'link', href: '/raise/cap-table/variants' },
]);

// ---------------------------------------------------------------------------
// Use of funds — id: the section key (decision 9)
// ---------------------------------------------------------------------------

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
]);

// ---------------------------------------------------------------------------
// Capital relationships — id: the prospect's id
// ---------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = { meeting: 'Meeting', intro: 'Intro', email: 'Email', call: 'Call', note: 'Note' };
const FIT_TONE: Record<string, string> = { fits: 'ok', outside: 'bad', unclear: 'grey' };

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
    return { rows, empty: 'No contact logged yet.' };
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
    return { rows: (res.results || []).map((f) => ({ a: `"${f.objection}"`, b: day(f.created_at) ?? '' })), empty: 'No feedback recorded.' };
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
]);

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
