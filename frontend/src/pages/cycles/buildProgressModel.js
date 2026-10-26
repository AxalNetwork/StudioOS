/**
 * D1070 (#2940) — Validate → Build part 7, as pure functions: Send to…
 * (VB6–VB8), Back in (VB9), Progress (VB10, VB15, VB22) and an item's
 * evidence trail (VB11). No React here, so `node --test` loads it alone.
 *
 * What each stage is read from, and only that (the canvas's rule: "Each dot
 * carries its source. Not recorded means no tool reports that stage, never
 * that it is not done."):
 *   - Accepted: the plan read's own `decided_at` (D1065, D1069). "Your accept".
 *   - Sent: `GET /plan/handoffs` (D1068), each row the founder's own press.
 *     "Your press".
 *   - In progress: an accepted link from `GET /plan/links` (D1068): what came
 *     back from a tool, linked by the founder. A copy to Notion, which
 *     reports nothing back, is "Not recorded".
 *   - Built, Live, Tested: no read carries a landed row's state or the day it
 *     changed, so each is "Not recorded" where it applies. Never "Not yet":
 *     that would claim it is not done.
 * A stage that does not apply to a kind (a test is never live) says so.
 */
import { KIND_WORD, SECTIONS, dayMon, isDecided, moduleName } from './buildPlanModel';

// ─────────────────────────────────────────────── Send to… (VB6–VB8)

export const LOVABLE_MAX = 4000;
export const PROVIDERS = [
  { id: 'lovable', label: 'Lovable' },
  { id: 'github', label: 'GitHub' },
  { id: 'notion', label: 'Notion' },
  { id: 'vercel', label: 'Vercel' },
];
export const providerWord = (id) => PROVIDERS.find((p) => p.id === id)?.label || 'A tool';

/** What each tab opens, said before anything is prepared ("Each tab says what it opens"). */
export const OPENS = {
  lovable: 'Build a clickable prototype in Lovable. It opens Lovable in a new tab with one prompt for these items. You build there with your own Lovable account.',
  github: 'Open one GitHub issue per item, each carrying its marker. GitHub opens a new issue with the text; you submit it there.',
  notion: 'One page per item, with its evidence and its marker, to copy or download and paste into Notion.',
  vercel: 'Put your repository on the web with your own Vercel account. It opens Vercel’s import page. Axal VC cannot deploy or change anything on Vercel.',
};
export const FOOTNOTE = {
  lovable: 'Opens Lovable in a new tab with this prompt. You build there with your own Lovable account. Axal VC does not see what you build until you link it.',
  github: 'GitHub opens a new issue with this text. You submit it there. It links back here when it arrives through your GitHub connection.',
  github_unconnected: 'Without a connection, copy each issue and paste it into GitHub yourself.',
  notion: 'Paste it into Notion. Notion reports nothing back, so what happens there is not recorded here.',
  vercel: 'Opens Vercel’s import page. Axal VC cannot deploy or change anything on Vercel.',
};
/** Said in the sheet before the press: preparing is what records the send (D1068 §1). */
export const PREPARE_NOTE = 'Preparing records that you sent these items to this tool, so it shows on Progress. Nothing opens until you press it.';
export const NOT_CONNECTED = 'Not connected';
export const PRIVACY_PASSED = 'Privacy check passed: no names, emails or quotes.';

/** The items a founder may send: accepted and landed (a door is opened, never sent). */
export function sendable(plan) {
  return SECTIONS.flatMap((s) => (plan?.modules?.[s.slug] || [])
    .filter((i) => isDecided(i) && i.kind !== 'connect-door' && i.landed_table && i.landed_id)
    .map((i) => ({ uid: i.uid, title: String(i.payload?.title ?? 'Plan item'), kind: i.kind, module: s.slug, marker: i.marker })));
}

/**
 * The repositories a tool may use: those the founder picked on their GitHub
 * connection for this venture (D1068 §2), from `GET /connectors` and
 * `GET /connectors/:uid/repositories`. None means "Not connected".
 */
export function githubConnection(list, projectId) {
  const items = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [];
  const gh = items.find((x) => x?.provider_key === 'github' && x?.status === 'connected'
    && Number(x?.config?.project_id) === Number(projectId));
  return gh ? gh.uid : null;
}
export const pickedRepositories = (repos) => (Array.isArray(repos?.selected) ? repos.selected.filter((r) => typeof r === 'string' && /^[\w.-]+\/[\w.-]+$/.test(r)) : []);

/** "1,840 / 4,000" — the prompt's own count from the Worker, never guessed. */
export const counterText = (n) => `${Number(n || 0).toLocaleString('en-US')} / ${LOVABLE_MAX.toLocaleString('en-US')}`;

/**
 * A refused send, in words. The privacy check names the item it found
 * something in (by its uid, never the words it matched); the Worker's own
 * sentence carries the rest.
 */
export function sendRefusal(e, items = []) {
  const code = e?.data?.code || e?.data?.error || e?.code || '';
  const title = (uid) => (uid === 'prompt' ? 'the prompt' : `“${items.find((i) => i.uid === uid)?.title || 'an item'}”`);
  if (code === 'pii_found') {
    const where = [...new Set((e?.data?.findings || []).map((f) => f?.in).filter(Boolean))].map(title);
    return {
      code,
      text: `The privacy check found a name, an email or a quote in ${where.length ? where.join(' and ') : 'what you sent'}. Nothing was sent or recorded.`,
      sub: 'Edit the item on the Plan tab so it holds none, then send again.',
    };
  }
  const said = e?.data?.message || e?.data?.detail || e?.message || '';
  return { code, text: said || 'It could not be prepared. Nothing was sent or recorded.', sub: null };
}

// ─────────────────────────────────────────────── Progress (VB10, VB15, VB22)

export const STAGES = ['accepted', 'sent', 'progress', 'built', 'live', 'tested'];
export const STAGE_WORD = { accepted: 'Accepted', sent: 'Sent', progress: 'In progress', built: 'Built', live: 'Live', tested: 'Tested' };
/** The chart's buckets and the legend, in the canvas's order. */
export const BUCKETS = [
  { id: 'accepted', label: 'Accepted' },
  { id: 'sent', label: 'Sent' },
  { id: 'progress', label: 'In progress' },
  { id: 'built', label: 'Built or live' },
  { id: 'notstarted', label: 'Not started' },
  { id: 'unrecorded', label: 'Not recorded' },
];
export const NOT_RECORDED_FOOT = 'Each dot carries its source. Not recorded means no tool reports that stage, never that it is not done.';
export const CHART_FOOT = 'Not started: accepted for Later on the roadmap. Not recorded: no read here carries that stage yet, or Notion reports nothing back after a copy.';
export const BUILT_UNREAD = 'Not recorded: no read here carries the day an item was built, so no week is drawn as 0.';

/** The stages a kind passes through; the rest "Does not apply". */
const APPLIES = {
  feature: STAGES,
  'must-have': STAGES,
  roadmap: STAGES,
  'prototype-test': ['accepted', 'sent', 'progress', 'tested'],
  risk: ['accepted', 'sent', 'progress'],
  'formation-step': ['accepted', 'sent', 'progress', 'built'],
  'connect-door': ['accepted', 'live'],
};
export const applies = (kind, stage) => (APPLIES[kind] || STAGES).includes(stage);

const FED_WORD = { issue: 'issue', pull_request: 'pull request' };
const UNREAD_LATER = 'No read here carries this stage yet';

/** One stage of one item: done (with its value and source), not yet, does not apply, or not recorded. */
const done = (text, source, at) => ({ state: 'done', text, source, at: at || null });
const notYet = { state: 'notyet', text: 'Not yet', source: null };
const na = { state: 'na', text: 'Does not apply', source: null };
const unrecorded = (source) => ({ state: 'unrecorded', text: 'Not recorded', source });

/**
 * Every accepted item's six stages, from the three reads. `handoffs` and
 * `links` may be null when their read failed: then Sent or In progress is
 * "Not recorded" with that reason, never "Not yet".
 */
export function progressRows(plan, handoffs, links) {
  const sentBy = new Map();
  for (const h of Array.isArray(handoffs) ? handoffs : []) {
    for (const uid of h.plan_item_uids || []) {
      const prev = sentBy.get(uid);
      if (!prev || String(h.opened_at) > String(prev.opened_at)) sentBy.set(uid, h);
    }
  }
  const linkedBy = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    if (l.status !== 'accepted' || !l.plan_item_uid) continue;
    const prev = linkedBy.get(l.plan_item_uid);
    if (!prev || String(l.decided_at) > String(prev.decided_at)) linkedBy.set(l.plan_item_uid, l);
  }
  const rows = [];
  for (const s of SECTIONS) {
    for (const i of plan?.modules?.[s.slug] || []) {
      if (!isDecided(i)) continue;
      const kind = i.kind;
      const stage = {};
      stage.accepted = done(dayMon(i.decided_at) || 'Date not recorded', 'Your accept', i.decided_at);
      const sent = sentBy.get(i.uid);
      if (!applies(kind, 'sent')) stage.sent = na;
      else if (handoffs == null) stage.sent = unrecorded('Sends could not be read');
      else stage.sent = sent ? done(`${providerWord(sent.provider)} · ${sent.provider === 'notion' ? 'copied' : 'opened'} ${dayMon(sent.opened_at) || ''}`.trim(), 'Your press', sent.opened_at) : notYet;
      const link = linkedBy.get(i.uid);
      if (!applies(kind, 'progress')) stage.progress = na;
      else if (links == null) stage.progress = unrecorded('Links could not be read');
      else if (link) stage.progress = done(`${providerWord(link.provider)} · ${FED_WORD[link.fed_kind] || 'item'} linked ${dayMon(link.decided_at) || ''}`.trim(), `Connector · ${providerWord(link.provider)}`, link.decided_at);
      else if (sent?.provider === 'notion') stage.progress = unrecorded('Notion reports nothing back');
      else stage.progress = notYet;
      for (const later of ['built', 'live', 'tested']) {
        stage[later] = applies(kind, later) ? unrecorded(UNREAD_LATER) : na;
      }
      rows.push({
        uid: i.uid, title: String(i.payload?.title ?? 'Plan item'), kind, kindWord: kindLine(i), module: s.slug, moduleWord: s.name,
        landed_table: i.landed_table || null, landed_id: i.landed_id || null, marker: i.marker || null, lane: i.payload?.lane || null,
        stages: stage, bucket: bucketOf(kind, stage, i.payload?.lane), last: lastChange(stage), tools: toolsOf(sent, link),
      });
    }
  }
  return rows;
}

const kindLine = (i) => (i.kind === 'roadmap' && i.payload?.lane ? `${KIND_WORD.roadmap} · ${i.payload.lane}` : KIND_WORD[i.kind] || 'Plan item');
const toolsOf = (sent, link) => [...new Set([sent?.provider, link?.provider].filter(Boolean))];

/** The furthest stage an item has reached, for the chart and the Stage filter. */
export function bucketOf(kind, stage, lane) {
  if (['built', 'live', 'tested'].some((k) => stage[k]?.state === 'done')) return 'built';
  if (stage.progress?.state === 'done') return 'progress';
  if (stage.progress?.state === 'unrecorded' && stage.sent?.state === 'done') return 'unrecorded';
  if (stage.sent?.state === 'done') return 'sent';
  if (kind === 'roadmap' && lane === 'Later') return 'notstarted';
  return 'accepted';
}

/** The latest stamp any stage carries: "Sort: Last change". */
export function lastChange(stage) {
  return STAGES.map((k) => stage[k]?.at).filter(Boolean).sort().pop() || null;
}

/** The chart's rows: per module, how many accepted items sit in each bucket (VB10). */
export function stageChart(rows) {
  return SECTIONS.map((s) => {
    const mine = rows.filter((r) => r.module === s.slug);
    const counts = Object.fromEntries(BUCKETS.map((b) => [b.id, mine.filter((r) => r.bucket === b.id).length]));
    return { module: s.slug, label: s.name, total: mine.length, counts, unrecorded: counts.unrecorded };
  }).filter((m) => m.total > 0);
}

/**
 * The chart's lead. Built and live are never read here (no read carries a
 * landed row's state), so the lead never says "0 of N are built": it says
 * they are not recorded.
 */
export function stageLead(rows) {
  const built = rows.filter((r) => r.bucket === 'built').length;
  if (!rows.length) return 'No item is accepted yet, so there is nothing to show by stage.';
  if (built) return `${built} of ${rows.length} accepted items are built or live.`;
  const sent = rows.filter((r) => r.stages.sent.state === 'done').length;
  return `${rows.length} accepted ${rows.length === 1 ? 'item' : 'items'}, ${sent} sent to a tool. Built and live are not recorded here yet.`;
}

/** The chart's text for a screen reader, naming any module with items not recorded. */
export function chartLabel(chart) {
  const total = chart.reduce((t, m) => t + m.total, 0);
  const missing = chart.filter((m) => m.unrecorded).map((m) => `In ${m.label}, ${m.unrecorded} ${m.unrecorded === 1 ? 'is' : 'are'} not recorded.`);
  return [`Accepted plan items by stage, per module: ${total} in all.`, ...missing].join(' ');
}

export const MODULE_FILTERS = SECTIONS.map((s) => [s.slug, s.name]);
export const STAGE_FILTERS = BUCKETS.map((b) => [b.id, b.label]);
export const TOOL_FILTERS = PROVIDERS.map((p) => [p.id, p.label]);
export const SORTS = [['last', 'Last change'], ['name', 'Name, A to Z'], ['module', 'Module']];
export const PROGRESS_FILTERS = { q: '', module: '', stage: '', tool: '' };

/** The table's rows after search, the three filters and the sort. */
export function filterRows(rows, f = PROGRESS_FILTERS, sort = 'last') {
  const q = String(f.q || '').trim().toLowerCase();
  const out = rows.filter((r) => (!q || r.title.toLowerCase().includes(q))
    && (!f.module || r.module === f.module) && (!f.stage || r.bucket === f.stage) && (!f.tool || r.tools.includes(f.tool)));
  const order = SECTIONS.map((s) => s.slug);
  if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'module') out.sort((a, b) => order.indexOf(a.module) - order.indexOf(b.module) || a.title.localeCompare(b.title));
  else out.sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')) || a.title.localeCompare(b.title));
  return out;
}

export const PER_PAGE = 25;
export function pageRows(rows, page, per = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * per;
  return { rows: rows.slice(start, start + per), page: at, pages, range: rows.length ? `${start + 1}–${Math.min(start + per, rows.length)} of ${rows.length}` : '0 of 0' };
}

/** A phone card's status line: the furthest recorded stage and its value (VB22a). */
export function phoneStatus(r) {
  const k = [...STAGES].reverse().find((s) => r.stages[s].state === 'done');
  return k ? `${STAGE_WORD[k]} · ${r.stages[k].text}` : 'Accepted';
}

/** The "as of" line: which reads Progress rests on. */
export function asOfLine(nowIso, tools) {
  const day = dayMon(nowIso) || '';
  const from = tools.length ? `read from ${tools.map(providerWord).join(', ')} and your presses` : 'read from your accepts and presses';
  return `As of ${day} · ${from}`;
}

// ─────────────────────────────────────────────── Back in (VB9)

/** The link proposals waiting for the founder, newest first: a row each. */
export function waitingLinks(links, plan) {
  const titles = new Map();
  for (const s of SECTIONS) for (const i of plan?.modules?.[s.slug] || []) titles.set(i.uid, { title: String(i.payload?.title ?? 'a plan item'), kind: KIND_WORD[i.kind] || 'item' });
  return (Array.isArray(links) ? links : []).filter((l) => l.status === 'proposed').map((l) => {
    const t = titles.get(l.plan_item_uid);
    const what = l.fed_kind === 'pull_request' ? 'Pull request' : l.fed_kind === 'issue' ? 'Issue' : 'An item';
    const num = /#(\d+)$/.exec(String(l.fed || ''))?.[1];
    return {
      uid: l.uid, source: `Connector · ${providerWord(l.provider)}`,
      line: `${what}${num ? ` #${num}` : ''}${l.title ? ` ‘${l.title}’` : ''} names ${l.marker || 'a plan marker'}.`,
      ask: t ? `Link to ${t.kind.toLowerCase()} ${t.title}?` : 'Link to its plan item?',
    };
  });
}
export const BACK_IN_FOOT = 'Nothing is linked until you press Link.';

// ─────────────────────────────────────────────── The evidence trail (VB11)

/**
 * One item's trail, oldest first: the evidence it rests on, the Verdict (a
 * founder's only; D693), the accept, each send, and what came back. The
 * stages no read carries end it as a dashed "Not recorded" node.
 */
export function trailNodes(row, trail, handoffs, links) {
  const nodes = [];
  for (const e of trail?.evidence || []) {
    nodes.push({ key: `e-${e.kind}-${e.ref}`, tone: 'evidence', text: String(e.label || 'Evidence'), sub: [e.source_label || 'Recorded', moduleOfEvidence(e.kind)].filter(Boolean).join(' · ') });
  }
  if (trail?.decision) {
    const word = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' }[trail.decision.decision] || 'Recorded';
    nodes.push({ key: 'decision', tone: 'you', text: `Verdict · ${word}${dayMon(trail.decision.decided_at) ? ` · ${dayMon(trail.decision.decided_at)}` : ''}`, sub: 'Your decision' });
  }
  nodes.push({ key: 'accepted', tone: 'you', text: `Accepted into ${row.moduleWord}${row.stages.accepted.at ? ` · ${dayMon(row.stages.accepted.at)}` : ''}`, sub: 'Your accept' });
  for (const h of (Array.isArray(handoffs) ? handoffs : []).filter((x) => (x.plan_item_uids || []).includes(row.uid)).sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)))) {
    nodes.push({ key: `h-${h.uid}`, tone: 'you', text: `${h.provider === 'notion' ? 'Copied for Notion' : `Opened in ${providerWord(h.provider)}`}${dayMon(h.opened_at) ? ` · ${dayMon(h.opened_at)}` : ''}`, sub: 'Your press' });
  }
  for (const l of (Array.isArray(links) ? links : []).filter((x) => x.status === 'accepted' && x.plan_item_uid === row.uid)) {
    nodes.push({ key: `l-${l.uid}`, tone: 'tool', text: `${providerWord(l.provider)} ${FED_WORD[l.fed_kind] || 'item'}${l.title ? ` ‘${l.title}’` : ''} · linked${dayMon(l.decided_at) ? ` ${dayMon(l.decided_at)}` : ''}`, sub: `Connector · ${providerWord(l.provider)}` });
  }
  for (const f of trail?.came_back || []) {
    nodes.push({ key: `f-${f.kind}-${f.first_seen_at}`, tone: 'tool', text: `${providerWord(f.source)} ${FED_WORD[f.kind] || f.kind || 'item'} arrived${dayMon(f.first_seen_at) ? ` · ${dayMon(f.first_seen_at)}` : ''}`, sub: `Connector · ${providerWord(f.source)}` });
  }
  const later = ['built', 'live', 'tested'].filter((k) => row.stages[k].state === 'unrecorded');
  if (later.length) {
    nodes.push({ key: 'missing', tone: 'missing', text: `Not recorded: ${later.map((k) => STAGE_WORD[k].toLowerCase()).join(', ')}.`, sub: 'No read here carries these stages yet. They appear once a tool reports them.' });
  }
  return nodes;
}
const EVIDENCE_MODULE = {
  theme: 'Problem discovery', interview: 'Customer research', hypothesis: 'Experiments and evidence', segment: 'Ideal customer profile',
  signal: 'Demand', decision: 'Verdict', commitment: 'Verdict',
};
const moduleOfEvidence = (k) => EVIDENCE_MODULE[k] || null;
export const TRAIL_FOOT = 'This trail is what Raise shows investors as evidence, once you choose to share it.';

/** The Build table an item's trail is read from (D1066 §6), or null for a door. */
export const trailTable = (row) => (row?.landed_table && row?.landed_id ? { table: row.landed_table, id: row.landed_id } : null);

// ─────────────────────────────────────────────── Who sees what (VB15, VB16, VB20)

export const OP_TITLE = 'Build plan';
export const OP_PILL = '● Operating Partner';
export const OP_LINE = 'You see what the founders accepted and what was built.';
/** VB20a: never a silent bounce. */
export const NOT_FOUNDER_ROLES = ['investor', 'advisor', 'exploring'];
export const NOT_FOUNDER_TITLE = 'This plan belongs to the venture’s founders.';
export const NOT_FOUNDER_LINE = 'Investors, advisors and explorers see a venture’s evidence only when its founders share it in Raise.';
/** Who may press Send, Link and Not this one: the venture's founder; the Worker checks it again. */
export const canAct = (role) => role !== 'admin' && role !== 'partner';
export { moduleName };
