/**
 * D5580 part 5 (#5580): what the HQ WorkGraph page shows, read off one
 * advisory snapshot (`studioos-pr-overlap-snapshot/v2`, scripts/lib/prRisk.mjs
 * `snapshot()`, served by GET /api/admin/workgraph/in-flight).
 *
 * The page is advice only: nothing here blocks, labels, merges or releases a
 * claim. Every count names the scan it came from; a partial scan's counts are
 * lower bounds ("at least"); a value the snapshot does not hold is Not recorded
 * with its reason, never 0 and never an empty list.
 */

export const TABS = [
  { key: 'in-flight', label: 'Work in flight', to: '/admin/workgraph/in-flight' },
  { key: 'pairs', label: 'PR pairs', to: '/admin/workgraph/pairs' },
  { key: 'evidence', label: 'PR evidence', to: '/admin/workgraph/evidence' },
];

export function tabOf(pathname) {
  const hit = TABS.find((t) => String(pathname || '').startsWith(t.to));
  return hit ? hit.key : 'in-flight';
}

/** The four actions, highest first (workIntent.mjs ranks them so). */
export const ACTIONS = [
  { key: 'serialize', label: 'Serialize', sym: '■' },
  { key: 'wait', label: 'Wait', sym: '▲' },
  { key: 'coordinate', label: 'Coordinate', sym: '◆' },
  { key: 'proceed', label: 'Proceed', sym: '✓' },
];
export const actionOf = (key) => ACTIONS.find((a) => a.key === key) || { key: String(key || ''), label: String(key || 'Unknown'), sym: '?' };

/** Risk classes, lowest to highest (prRisk.mjs `RISK`). */
export const RISK_CLASSES = [
  { key: 'same-path-disjoint-hunks', label: 'Same path, disjoint hunks', sym: '∥', why: 'both PRs edit the path; their changed lines do not meet' },
  { key: 'unknown-hunks', label: 'Same path, unknown hunks', sym: '?', why: 'both edit the path; the line ranges could not be compared' },
  { key: 'overlapping-hunks', label: 'Overlapping hunks', sym: '⧉', why: 'changed line ranges meet or overlap' },
  { key: 'dependency', label: 'Dependency', sym: '↳', why: 'a shared hub, API, schema, contract, manifest, baseline or generated path, or a migration stamp' },
  { key: 'critical', label: 'Critical', sym: '■', why: 'a shared migration, D1 schema or contract change that alters, drops or renames' },
];
export const riskClassOf = (key) => RISK_CLASSES.find((r) => r.key === key) || null;

/** Values no store holds yet: each reads Not recorded with this reason. */
export const NOT_RECORDED = {
  override: 'no override store yet',
  lifespan: 'claims record only a TTL',
  integrationOwner: 'integration owners not assigned yet',
  reviewDelay: 'review delay is not measured yet',
};

const SOURCE = { ref: 'Claim ref', 'claim-ref': 'Claim ref', status: 'STATUS comment', label: 'Slot label' };
export const sourceLabel = (s) => SOURCE[s] || (s ? String(s) : null);

/** "14:31 UTC" — the scan's own name, used beside every count. */
export function scanTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(11, 16) + ' UTC';
}
export function scanStamp(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)} UTC`;
}

export function ageWords(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/**
 * The read's answer, as the page's state. `read` is the body of
 * GET /api/admin/workgraph/in-flight, `error` a failed request.
 */
export function pageState(read, error) {
  if (error) {
    if (Number(error.status) === 403) return { kind: 'refused' };
    return { kind: 'unreadable', reason: 'the WorkGraph read failed' };
  }
  if (!read) return { kind: 'loading' };
  if (read.status === 'none') return { kind: 'none', reason: read.reason || 'no scan has been posted yet' };
  if (read.status === 'unreadable') return { kind: 'snapshot-unreadable', reason: read.reason || 'the stored scan could not be read', generatedAt: read.generated_at };
  if (read.status !== 'read' || !read.snapshot || typeof read.snapshot !== 'object') return { kind: 'unreadable', reason: 'the read answered in a shape this page does not know' };
  return {
    kind: 'read',
    snapshot: read.snapshot,
    generatedAt: read.generated_at,
    partial: Boolean(read.partial || read.snapshot.partial),
    stale: Boolean(read.stale),
    ageMinutes: Number.isFinite(read.age_minutes) ? read.age_minutes : null,
    staleAfter: Number.isFinite(read.stale_after_minutes) ? read.stale_after_minutes : null,
  };
}

/** Work in flight as the snapshot gave it: read, not read, or Unreadable. */
export function workOf(snapshot) {
  const w = snapshot?.workInFlight;
  if (!w || typeof w !== 'object') return { status: 'not read', reason: 'the scan carries no work-in-flight section', intents: [], refused: [], notes: [] };
  const status = w.status === 'read' ? 'read' : w.status === 'unreadable' ? 'unreadable' : 'not read';
  return {
    status,
    reason: w.reason || null,
    partial: Boolean(w.partial),
    intents: Array.isArray(w.intents) ? w.intents : [],
    refused: Array.isArray(w.refused) ? w.refused : [],
    notes: Array.isArray(w.notes) ? w.notes : [],
  };
}

/** The summary strip: claims held, each action, expired-still-held, refused. */
export function summary(work) {
  const counts = Object.fromEntries(ACTIONS.map((a) => [a.key, 0]));
  for (const i of work.intents) {
    const k = i?.recommendation?.action || 'proceed';
    if (k in counts) counts[k] += 1;
  }
  return {
    held: work.intents.length,
    actions: counts,
    expired: work.intents.filter((i) => i?.registration?.expired === true).length,
    refused: work.refused.length,
  };
}

/** A count as the page says it: a partial scan's is a lower bound. */
export const countWords = (n, atLeast) => (atLeast ? `≥ ${n}` : String(n));

/** The top folder a pair belongs to: its first shared path's, or "(stamps only)". */
export function moduleOf(pair) {
  const p = pair?.paths?.[0]?.path;
  if (typeof p === 'string' && p.includes('/')) return p.split('/')[0];
  if (typeof p === 'string' && p) return '(repository root)';
  return '(migration stamps only)';
}

/** Pairs grouped by top folder, groups in first-seen order, pairs in the scan's order. */
export function pairGroups(pairs) {
  const out = new Map();
  (Array.isArray(pairs) ? pairs : []).forEach((p, index) => {
    const m = moduleOf(p);
    if (!out.has(m)) out.set(m, []);
    out.get(m).push({ ...p, index });
  });
  return [...out.entries()].map(([module, rows]) => ({ module, rows }));
}

export const conflictWords = (v) => (v === 'yes' ? 'Conflict: Yes' : v === 'no' ? 'Conflict: No' : 'Not checked');

const span = (s) => (s.end < s.start ? `before ${s.start}` : s.start === s.end ? `L${s.start}` : `L${s.start}–${s.end}`);
/** One shared path's hunk proof, in words. */
export function hunkWords(h) {
  if (!h || typeof h !== 'object') return { kind: 'none', text: 'Hunks not compared for this path' };
  if (h.class === 'overlapping-hunks' && Array.isArray(h.ranges)) {
    return { kind: 'overlap', text: h.ranges.map((r) => `${span(r.a)} meets ${span(r.b)}`).join('; ') };
  }
  if (h.class === 'same-path-disjoint-hunks') {
    return { kind: 'disjoint', a: (h.a || []).map(span).join(', ') || 'none', b: (h.b || []).map(span).join(', ') || 'none', text: 'No changed line is shared.' };
  }
  return { kind: 'unknown', text: h.reason ? `Hunks unknown: ${h.reason}` : 'Hunks unknown' };
}

/** The four evidence readings, each its own words (never one score). */
export function mergeWords(m) {
  if (m?.status === 'conflict') return { tone: 'bad', text: 'Conflict' };
  if (m?.status === 'clean') return { tone: 'ok', text: 'Clean' };
  return { tone: 'unknown', text: 'Unknown', why: m?.reason || null };
}
export function checksWords(c) {
  switch (c?.status) {
    case 'failed': return { tone: 'bad', text: 'Failed', why: (c.failed || []).join(', ') || null };
    case 'pending': return { tone: 'pending', text: 'Pending', why: [...(c.pending || []), ...(c.missing || []).map((n) => `${n} (not reported yet)`)].join(', ') || null };
    case 'passing': return { tone: 'ok', text: 'Passing' };
    case 'none required': return { tone: 'neutral', text: 'None required' };
    default: return { tone: 'unknown', text: 'Unknown', why: c?.reason || null };
  }
}
export function queueWords(q) {
  if (q?.status !== 'measured') return { tone: 'unknown', text: 'Not measured', why: q?.reason || null };
  const max = q.maxMinutes == null ? '—' : `${q.maxMinutes} min`;
  const med = q.p50Minutes == null ? '—' : `${q.p50Minutes} min`;
  const still = q.stillQueued ? `; ${q.stillQueued} still queued (longest ${q.longestQueuedMinutes} min)` : '; none still queued';
  return { tone: 'neutral', text: `max ${max} · median ${med}`, why: `over ${q.jobs ?? 0} jobs${still}` };
}
export function baseWords(b) {
  if (b?.status !== 'measured') return { tone: 'unknown', text: 'Unknown', why: b?.reason || null };
  return { tone: 'neutral', text: `${b.behindBy} behind`, why: b.ageHours == null ? 'base age not recorded' : `base age ${b.ageHours} h` };
}

/** The claim a PR belongs to, if any intent lists it. */
export function claimOfPr(work, number) {
  const hit = work.intents.find((i) => Array.isArray(i.prs) && i.prs.includes(number));
  return hit ? hit.issue : null;
}

export const repoUrl = (repo) => (typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}` : null);
