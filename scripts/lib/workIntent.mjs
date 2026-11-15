/**
 * D5580 (#5580 part 2): the WorkIntent view and its soft proceed/coordinate/wait/serialize recommendation. Pure: the
 * CLI `../pr-overlap.mjs` reads GitHub and hands the rows in; `walkClaim` takes its commit reader handed in.
 *
 * A WorkIntent is DERIVED, never stored: it reads #5617's atomic claim ref (`refs/heads/claim/<issue>`, D5617), the
 * issue's STATUS comments and labels (AGENTS.md's fallback claim) and the claimant's open PRs. There is no second
 * claim store and no override store; #5618's fenced lease lives behind the Merge Control owner token and is not read.
 * Each intent carries a D5579 `WorkItem` projection; a WorkItem field the claim does not record is `null`.
 *
 * Predicted paths, first source that has any: the claim (v1 records none) → the linked open PRs' changed paths →
 * the holder's latest STATUS `files:` line → not recorded.
 *
 * Recommendation per intent against every other intent and every open PR no intent owns, highest wins:
 *   serialize   a critical path (part 1's CRITICAL, or an altering migration) or an exclusive resource: a shared
 *               migration file or stamp, a schema or contract path, or a release pointer
 *   wait        overlapping hunks, a shared dependency path (hub, manifest, API, baseline, generated) or an open
 *               dependency issue
 *   coordinate  a shared path with disjoint or unknown hunks, a predicted shared path, the same module, or a
 *               dependency whose state was not read
 *   proceed     none of these
 * Soft only: nothing here blocks, labels or merges.
 */
import { parseClaim } from './claims.mjs';
import { canonicalSlot } from './notificationRouting.mjs';
import { classify, escape } from './prOverlap.mjs';
import { criticalReason, DEPENDENCY_CLASSES } from './prRisk.mjs';

export const ACTIONS = ['proceed', 'coordinate', 'wait', 'serialize'];
export const STALE_BASE_HOURS = 72;
export const MAX_CLAIM_HOPS = 7;
export const STANDARD_SLOTS = 37;
const SHA = /^[a-f0-9]{40}$/;
const HOUR = 3600000;
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const CLAIMED_STATES = ['state:in-progress', 'state:blocked', 'state:review'];
const SOURCE_RANK = { ref: 0, status: 1, label: 2 };
const rank = a => ACTIONS.indexOf(a);
const iso = ms => Number.isFinite(ms) ? new Date(ms).toISOString() : null;
const labelNames = issue => (issue?.labels ?? []).map(l => typeof l === 'string' ? l : l?.name).filter(n => typeof n === 'string');

/** Exclusive resources (serialize). A release pointer is the file that says what the next release is. */
export function exclusiveReason(path) {
  const c = classify(path);
  if (c === 'migration') return 'migration file';
  if (c === 'schema') return 'D1 schema';
  if (c === 'contract') return 'API contract';
  if (/^(?:CHANGELOG\.md|frontend\/src\/lib\/release\.js)$|^scripts\/release-[\w-]+\.mjs$/.test(path)) return 'release pointer';
  return null;
}

/** `S03`, `s39` or `slot:S03` → `S03`. Unknown is a slot past S37 with no `slot:SNN` label in the repository. */
export function checkSlot(raw, knownSlots = null) {
  const text = typeof raw === 'string' ? raw.trim().replace(/^slot:/i, '') : '';
  if (!/^s\d{2,3}$/i.test(text)) return { ok: false, reason: `slot "${String(raw ?? '').slice(0, 40)}" is not slot:SNN` };
  const slot = canonicalSlot(text);
  if (!slot) return { ok: false, reason: `slot "${text}" is not a slot` };
  if (Number(slot.slice(1)) <= STANDARD_SLOTS) return { ok: true, slot };
  if (!knownSlots) return { ok: true, slot, note: `slot ${slot} not verified: repository labels unreadable` };
  return knownSlots.has(slot) ? { ok: true, slot } : { ok: false, reason: `slot ${slot} is unknown: no slot:${slot} label` };
}

/** The STATUS block of AGENTS.md, or null. A template line (`IN_PROGRESS | BLOCKED`) is not a state. */
export function parseStatus(body) {
  if (typeof body !== 'string' || !/^\s*STATUS\s*$/m.test(body)) return null;
  const task = /^\s*task:\s*#(\d+)\s+slot:\s*(\S+)\s+agent:\s*(.+?)\s*$/m.exec(body);
  if (!task) return null;
  const pr = /^\s*pr:\s*(.*)$/m.exec(body)?.[1] ?? '';
  return {
    issue: Number(task[1]), slot: task[2], agent: task[3].slice(0, 200),
    state: /^\s*state:\s*([A-Z_]+)\s*$/m.exec(body)?.[1] ?? null,
    files: /^\s*files:\s*(.*)$/m.exec(body)?.[1] ?? null,
    pr: Number(/\/pull\/(\d+)\b/.exec(pr)?.[1] ?? /#(\d+)\b/.exec(pr)?.[1]) || null,
  };
}

/** Repository paths named on a STATUS `files:` line. Globs, absolute paths and `..` are not paths. */
export function filesFromStatus(text) {
  if (typeof text !== 'string') return [];
  const out = new Set();
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.replace(/^[`'"(]+/, '').replace(/[`'"),.:]+$/, '');
    if (!t || t.includes('..') || !/^[\w.@+-][\w./@+-]*$/.test(t)) continue;
    if (!t.includes('/') && !/\.[a-z]{1,5}$/i.test(t)) continue;
    out.add(t);
    if (out.size >= 50) break;
  }
  return [...out].sort();
}

/** `Depends on #N` / `Blocked by #N` in the issue body. */
export function dependenciesOf(body) {
  if (typeof body !== 'string') return [];
  return [...new Set([...body.matchAll(/\b(?:depends\s+on|blocked\s+by)\s+#(\d{1,7})\b/gi)].map(m => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Walks a claim ref from its head through its renewals (each a child of the claim it renews, D5617) to the first
 * commit that is not a claim of this issue: main at claim time, the intent's base. `readCommit(sha)` is the GitHub
 * git-commit object. Throws only what `readCommit` throws.
 */
export async function walkClaim(issue, headSha, readCommit, { maxHops = MAX_CLAIM_HOPS } = {}) {
  if (!SHA.test(headSha ?? '')) return { head: null, reason: 'claim ref SHA invalid' };
  const head = await readCommit(headSha);
  const claim = parseClaim(head?.message);
  if (!claim || claim.issue !== issue) return { head: null, sha: headSha, reason: 'claim metadata invalid (D5617 treats it as expired)' };
  let root = { sha: headSha, claim }, parent = head?.parents?.[0]?.sha;
  for (let hop = 0; hop < maxHops; hop++) {
    if (!SHA.test(parent ?? '')) return { head: { sha: headSha, claim }, root, base: null, reason: 'base not recorded: claim commit has no parent' };
    const commit = await readCommit(parent);
    const parsed = parseClaim(commit?.message);
    if (parsed && parsed.issue === issue) { root = { sha: parent, claim: parsed }; parent = commit?.parents?.[0]?.sha; continue; }
    const date = commit?.committer?.date ?? commit?.author?.date ?? null;
    return { head: { sha: headSha, claim }, root, base: { sha: parent, date: Number.isFinite(Date.parse(date)) ? date : null } };
  }
  return { head: { sha: headSha, claim }, root, base: null, reason: `base not recorded: more than ${maxHops} renewals` };
}

const holderKey = (slot, agent) => `${slot}|${String(agent ?? '').trim().toLowerCase()}`;

/** The registrations one issue's records hold: the claim ref, each STATUS holder not yet DONE, and bare slot labels. */
export function registrations({ issue, ref = null, issueRow = null, comments = [] }, knownSlots = null) {
  const regs = [], refused = [], notes = [];
  if (ref) {
    if (!ref.head) refused.push(`#${issue}: claim ref refused: ${ref.reason}`);
    else {
      const c = ref.head.claim, s = checkSlot(c.slot, knownSlots);
      if (!s.ok) refused.push(`#${issue}: claim ref refused: ${s.reason}`);
      else {
        if (s.note) notes.push(`#${issue}: ${s.note}`);
        const at = Date.parse(ref.root.claim.at);
        regs.push({ source: 'ref', slot: s.slot, agent: c.agent, session: c.session, at, renewedAt: Date.parse(c.at), ttlHours: c.ttlHours,
          expiresAt: Date.parse(c.at) + c.ttlHours * HOUR, claimSha: ref.head.sha, rootSha: ref.root.sha, base: ref.base ?? null, baseReason: ref.reason ?? null,
          key: `claim/${issue}/${ref.root.sha}` });
      }
    }
  }
  const holders = new Map();
  const rows = [...(comments ?? [])].filter(c => TRUSTED.has(c?.author_association) && Number.isFinite(Date.parse(c?.created_at)))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id ?? 0) - (b.id ?? 0));
  for (const row of rows) {
    const st = parseStatus(row.body);
    if (!st || st.issue !== issue) continue;
    const s = checkSlot(st.slot, knownSlots);
    if (!s.ok) { refused.push(`#${issue}: STATUS claim refused: ${s.reason}`); continue; }
    const key = holderKey(s.slot, st.agent);
    const h = holders.get(key) ?? { source: 'status', slot: s.slot, agent: st.agent, session: null, at: Date.parse(row.created_at), renewedAt: null,
      ttlHours: null, expiresAt: null, claimSha: null, rootSha: null, base: null, baseReason: 'base not recorded: a STATUS claim has none', key: `status/${issue}/${row.id}` };
    h.state = st.state ?? h.state; if (st.files != null) h.files = st.files; if (st.pr) h.pr = st.pr;
    holders.set(key, h);
  }
  for (const h of holders.values()) if (h.state !== 'DONE') regs.push(h);
  const labels = labelNames(issueRow);
  if (labels.some(l => CLAIMED_STATES.includes(l.toLowerCase()))) {
    for (const l of labels.filter(l => /^slot:/i.test(l))) {
      const s = checkSlot(l, knownSlots);
      if (!s.ok) { refused.push(`#${issue}: label claim refused: ${s.reason}`); continue; }
      if (!regs.some(r => r.slot === s.slot)) regs.push({ source: 'label', slot: s.slot, agent: null, session: null, at: null, renewedAt: null, ttlHours: null,
        expiresAt: null, claimSha: null, rootSha: null, base: null, baseReason: 'base not recorded: a label claim has none', key: `label/${issue}/${s.slot}` });
    }
  }
  return { regs, refused, notes };
}

const regOrder = (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
  || a.slot.localeCompare(b.slot) || String(a.agent ?? '').localeCompare(String(b.agent ?? ''));
const describe = r => `${r.source === 'ref' ? 'claim ref' : r.source === 'status' ? 'STATUS claim' : 'label claim'} by ${r.slot}${r.agent ? ` (${r.agent})` : ''}${r.at != null ? ` at ${iso(r.at)}` : ''}`;
const sameHolder = (a, b) => a.slot === b.slot && (a.agent == null || b.agent == null || holderKey(a.slot, a.agent) === holderKey(b.slot, b.agent));

/**
 * One winner per issue. The claim ref is the authority (D5617): a STATUS claim by its holder adds its files and PR;
 * a different holder's STATUS from before the ref is history, and one from after it is a duplicate that loses.
 * With no ref (the HTTP 403 fallback), the earliest registration wins; ties break by source, slot, agent.
 */
export function resolve(issue, regs) {
  const notes = [];
  const ordered = [...regs].sort(regOrder);
  const ref = ordered.find(r => r.source === 'ref');
  const winner = ref ?? ordered[0];
  if (!winner) return { winner: null, notes };
  for (const r of ordered) {
    if (r === winner) continue;
    if (sameHolder(r, winner)) { if (r.files != null && winner.files == null) winner.files = r.files; if (r.pr && !winner.pr) winner.pr = r.pr; continue; }
    if (ref && r.at != null && r.at < ref.at) notes.push(`#${issue}: ${describe(r)} predates the ${describe(ref)}; read as history`);
    else notes.push(`#${issue}: duplicate registration: ${describe(r)} loses to the earlier ${describe(winner)}`);
  }
  return { winner, notes };
}

const LINK = n => new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\\s+of)\\s+#${n}\\b`, 'i');
const pathsOfPr = pr => [...new Set((pr.files ?? []).flatMap(f => typeof f === 'string' ? [f] : [f?.filename, f?.previous_filename]).filter(Boolean))].sort();

/** The open PRs an intent owns: the PR its holder's STATUS names, else every open PR whose body links the issue. */
export function linkPrs(issue, winner, prs, { scanPartial = false } = {}) {
  const open = new Map(prs.map(p => [p.number, p])), notes = [];
  if (winner.pr) {
    if (open.has(winner.pr)) return { prs: [winner.pr], notes };
    notes.push(scanPartial ? `#${issue}: PR #${winner.pr} from STATUS is not in the partial scan; not linked`
      : `#${issue}: PR #${winner.pr} from STATUS is no longer open (merged, closed or gone); dropped`);
  }
  const re = LINK(issue);
  return { prs: prs.filter(p => re.test(p.body ?? '') || new RegExp(`^agent/[\\w.-]+/${issue}-`).test(p.head?.ref ?? '')).map(p => p.number).sort((a, b) => a - b), notes };
}

function riskOf(paths) {
  if (!paths.length) return null;
  if (paths.some(p => criticalReason(p, classify(p), []))) return 'high';
  if (paths.some(p => DEPENDENCY_CLASSES.has(classify(p)) || exclusiveReason(p))) return 'medium';
  return 'low';
}

/**
 * Builds the intents from the CLI's records. `records`: `{ issue, ref, issueRow, comments, unreadable? }` per issue.
 * `prs`: the open PRs the scan read (with `files`, `body`, `head.ref`, `evidence`). `isAncestor(sha)` → true, false
 * or null (not checkable). `depStates`: issue number → 'open' | 'closed'.
 */
export function deriveIntents({ records = [], prs = [], knownSlots = null, isAncestor = () => null, depStates = new Map(), now = Date.now(), scanPartial = false, staleHours = STALE_BASE_HOURS }) {
  const intents = [], refused = [], notes = [];
  for (const rec of [...records].sort((a, b) => a.issue - b.issue)) {
    if (rec.unreadable) { notes.push(`#${rec.issue}: ${rec.unreadable}; not read`); continue; }
    const r = registrations(rec, knownSlots);
    refused.push(...r.refused); notes.push(...r.notes);
    const { winner, notes: dupNotes } = resolve(rec.issue, r.regs);
    notes.push(...dupNotes);
    if (!winner) continue;
    const link = linkPrs(rec.issue, winner, prs, { scanPartial });
    notes.push(...link.notes);
    const linked = prs.filter(p => link.prs.includes(p.number));
    let paths = [], pathsSource = 'not recorded';
    const prPaths = [...new Set(linked.flatMap(pathsOfPr))].sort();
    if (prPaths.length) { paths = prPaths; pathsSource = 'pr'; }
    else if (filesFromStatus(winner.files).length) { paths = filesFromStatus(winner.files); pathsSource = 'status'; }
    // Base: the claim's parent on main, else the linked PR's merge base (part 1's evidence), else not recorded.
    let base = { sha: null, date: null, source: null, reason: winner.baseReason ?? 'base not recorded' };
    if (winner.base?.sha) base = { sha: winner.base.sha, date: winner.base.date, source: 'claim' };
    else {
      const mb = linked.map(p => p.evidence?.baseAge).find(b => SHA.test(b?.mergeBase ?? ''));
      if (mb) base = { sha: mb.mergeBase, date: mb.mergeBaseDate ?? null, source: 'pr merge base' };
    }
    const ageHours = base.date ? Math.round((now - Date.parse(base.date)) / HOUR * 10) / 10 : null;
    const onMain = base.sha ? isAncestor(base.sha) : null;
    const staleWhy = onMain === false ? 'base is not an ancestor of main' : ageHours !== null && ageHours > staleHours ? `base is ${ageHours} h old (over ${staleHours} h)` : null;
    const deps = dependenciesOf(rec.issueRow?.body).filter(n => n !== rec.issue).map(n => ({ issue: n, state: depStates.get(n) ?? 'unknown' }));
    // D5617's isExpired: expired from the instant at + TTL.
    const expired = Number.isFinite(winner.expiresAt) ? now >= winner.expiresAt : null;
    const own = [];
    if (expired) own.push('claim expired; still held until its holder releases it or the owner hands it back (D5617)');
    if (rec.issueRow?.state === 'closed') own.push('issue is closed but the claim is still held');
    const labelSlots = labelNames(rec.issueRow).map(l => /^slot:/i.test(l) ? canonicalSlot(l.replace(/^slot:/i, '')) : null).filter(Boolean);
    if (rec.issueRow && labelSlots.length && !labelSlots.includes(winner.slot)) own.push(`holder ${winner.slot} does not match the issue's slot label ${labelSlots.join(', ')}`);
    intents.push({
      issue: rec.issue,
      holder: { slot: winner.slot, agent: winner.agent ?? null, session: winner.session ?? null },
      registration: { source: winner.source, registeredAt: iso(winner.at), renewedAt: iso(winner.renewedAt), ttlHours: winner.ttlHours ?? null,
        expiresAt: iso(winner.expiresAt), expired, claimSha: winner.claimSha ?? null },
      base: { ...base, ageHours, onMain, stale: base.sha ? Boolean(staleWhy) : null, ...(staleWhy ? { staleReason: staleWhy } : {}) },
      issueState: rec.issueRow?.state ?? null,
      prs: link.prs, paths, pathsSource, dependsOn: deps,
      lease: { status: 'not read', reason: 'the #5618 lease is read only with the Merge Control owner token' },
      override: null,
      workItem: {
        id: `issue:${rec.issue}`, scope: null, deliverableAssetId: null,
        modifies: paths.map(p => ({ assetId: null, versionId: null, unit: { kind: 'path', id: p } })),
        baseVersionId: null, dependsOn: deps.map(d => `issue:${d.issue}`), author: null, priority: null,
        risk: riskOf(paths), idempotencyKey: winner.key,
      },
      notes: own,
    });
  }
  // Concurrent expiry: soonest expiry first, unrecorded expiry last, then issue number.
  intents.sort((a, b) => (Date.parse(a.registration.expiresAt ?? '') || Infinity) - (Date.parse(b.registration.expiresAt ?? '') || Infinity) || a.issue - b.issue);
  return { intents, refused, notes };
}

const moduleOf = path => {
  if (/(^|\/)README\.md$|\.md$|(^|\/)test\/|\.test\.|^cloudflare-worker\/sql\//.test(path)) return null;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return FLAT_FOLDERS.has(dir) ? null : dir || null;
};
/** Folders where each file is its own module by design (#4105 self-registration): sharing one is not a module overlap. */
export const FLAT_FOLDERS = new Set(['scripts', 'scripts/lib', 'cloudflare-worker/src/routes', 'cloudflare-worker/src/services', 'frontend/src/lib/api',
  'frontend/src/routes', 'frontend/src/components', 'frontend/src/pages', '.github/workflows']);
const stampOf = p => classify(p) === 'migration' ? /\/(\d{12})_/.exec(p)?.[1] ?? null : null;

/** The action for two path sets with no measured hunks (at least one side is a prediction). */
export function pathAction(a, b) {
  const right = new Set(b);
  let best = { action: 'proceed', rule: 'no overlap', path: null };
  const take = (action, rule, path) => { if (rank(action) > rank(best.action)) best = { action, rule, path }; };
  for (const p of a) {
    if (!right.has(p) || classify(p) === 'union') continue;
    const why = criticalReason(p, classify(p), []) ?? exclusiveReason(p);
    if (why) take('serialize', why, p);
    else if (DEPENDENCY_CLASSES.has(classify(p))) take('wait', `shared ${classify(p)} path`, p);
    else take('coordinate', 'same path; hunks not known', p);
  }
  const stamps = new Set(b.map(stampOf).filter(Boolean));
  for (const p of a) if (stampOf(p) && stamps.has(stampOf(p)) && !right.has(p)) take('serialize', `shared migration stamp ${stampOf(p)}`, p);
  if (best.action === 'proceed') {
    const mods = new Set(b.map(moduleOf).filter(Boolean));
    const shared = [...new Set(a.map(moduleOf).filter(m => m && mods.has(m)))].sort();
    if (shared.length) take('coordinate', 'same module', shared[0]);
  }
  return best;
}

/** The action for one part-1 annotated PR pair (measured hunks). */
export function pairAction(pair) {
  let best = { action: 'proceed', rule: 'no overlap', path: null };
  const take = (action, rule, path) => { if (rank(action) > rank(best.action)) best = { action, rule, path }; };
  for (const e of pair.paths ?? []) {
    const ex = exclusiveReason(e.path);
    if (e.risk === 'critical') take('serialize', e.why ?? 'critical path', e.path);
    else if (ex) take('serialize', ex, e.path);
    else if (e.risk === 'dependency') take('wait', `shared ${e.class} path`, e.path);
    else if (e.risk === 'overlapping-hunks') take('wait', 'overlapping hunks', e.path);
    else if (e.risk === 'unknown-hunks') take('coordinate', `hunks unknown${e.hunks?.reason ? `: ${e.hunks.reason}` : ''}`, e.path);
    else take('coordinate', 'same path, disjoint hunks', e.path);
  }
  for (const s of pair.migrationStamps ?? []) take('serialize', `shared migration stamp ${s}`, null);
  return best;
}

/** Adds `recommendation: { action, reasons }` to each intent. Mutates and returns the intents. */
export function recommend(intents, { prs = [], overlaps = [] } = {}) {
  const owned = new Set(intents.flatMap(i => i.prs));
  const fresh = new Map(prs.filter(p => !p.stale).map(p => [p.number, p]));
  const parties = [
    ...intents.map(i => ({ id: `i${i.issue}`, label: `#${i.issue}`, prs: i.prs, paths: i.paths, issue: i.issue })),
    ...[...fresh.values()].filter(p => !owned.has(p.number)).map(p => ({ id: `p${p.number}`, label: `PR #${p.number}`, prs: [p.number], paths: pathsOfPr(p) })),
  ];
  const pairBetween = (xs, ys) => overlaps.filter(o => (xs.includes(o.a.number) && ys.includes(o.b.number)) || (xs.includes(o.b.number) && ys.includes(o.a.number)));
  for (const intent of intents) {
    const reasons = [];
    for (const party of parties) {
      if (party.id === `i${intent.issue}`) continue;
      let best;
      const measured = intent.prs.length && party.prs.length && intent.prs.every(n => fresh.has(n)) && party.prs.every(n => fresh.has(n));
      if (measured) {
        best = pairBetween(intent.prs, party.prs).map(pairAction).sort((x, y) => rank(y.action) - rank(x.action))[0] ?? pathAction([], []);
        if (best.action === 'proceed') best = pathAction(intent.paths, party.paths);
      } else best = pathAction(intent.paths, party.paths);
      if (best.action !== 'proceed') reasons.push({ action: best.action, with: party.label, rule: best.rule, path: best.path });
    }
    for (const d of intent.dependsOn) {
      if (d.state === 'open') reasons.push({ action: 'wait', with: `#${d.issue}`, rule: 'depends on an open issue', path: null });
      else if (d.state !== 'closed') reasons.push({ action: 'coordinate', with: `#${d.issue}`, rule: 'dependency state not read', path: null });
    }
    reasons.sort((x, y) => rank(y.action) - rank(x.action) || x.with.localeCompare(y.with, 'en', { numeric: true }));
    intent.recommendation = { action: reasons[0]?.action ?? 'proceed', reasons };
  }
  return intents;
}

/** The work section when the claim refs could not be read: Unreadable, never empty. */
export const unreadableWork = reason => ({ status: 'unreadable', reason, partial: true, intents: [], refused: [], notes: [] });

const short = sha => SHA.test(sha ?? '') ? sha.slice(0, 7) : null;
function intentLine(i) {
  const reg = i.registration;
  const who = `${escape(i.holder.slot)}${i.holder.agent ? ` · ${escape(i.holder.agent)}` : ''}`;
  const src = reg.source === 'ref' ? `claim ref, registered ${reg.registeredAt}, expires ${reg.expiresAt}${reg.expired ? ' (expired, still held)' : ''}`
    : `${reg.source === 'status' ? 'STATUS' : 'label'} claim${reg.registeredAt ? `, registered ${reg.registeredAt}` : ''}, expiry not recorded`;
  const b = i.base;
  const base = b.sha ? `base ${short(b.sha)}${b.ageHours !== null ? ` (${b.ageHours} h)` : ''}${b.stale ? ` **stale**: ${escape(b.staleReason)}` : ''}` : `base not recorded`;
  const prs = i.prs.length ? `PR ${i.prs.map(n => `#${n}`).join(', ')}` : 'no PR';
  const paths = i.pathsSource === 'not recorded' ? 'paths not recorded' : `${i.paths.length} path(s) from ${i.pathsSource === 'pr' ? 'the PR' : 'STATUS files'}`;
  const rec = i.recommendation;
  const why = rec?.reasons?.length ? ': ' + rec.reasons.slice(0, 5).map(r => `${r.action} with ${escape(r.with)} (${escape(r.rule)}${r.path ? ` on ${escape(r.path)}` : ''})`).join('; ')
    + (rec.reasons.length > 5 ? `; and ${rec.reasons.length - 5} more` : '') : '';
  const own = i.notes.length ? ` — ${i.notes.map(escape).join('; ')}` : '';
  return `- #${i.issue} · ${who} · ${src} · ${base} · ${prs} · ${paths} → **${rec?.action ?? 'proceed'}**${why}${own}`;
}

/** The "Work in flight" section of the #5600 summary. Every string from a claim, comment, label or path is escaped. */
export function workInFlightText(work) {
  const head = `### Work in flight${work?.partial ? ' (partial)' : ''}\n\n`;
  if (!work || work.status === 'unreadable') return `${head}Unreadable: ${escape(work?.reason ?? 'claims not read')}. This is not "no work".`;
  const body = work.intents.length ? work.intents.map(intentLine).join('\n') : 'No claimed work found.';
  const refused = work.refused.length ? '\n\nRefused:\n' + work.refused.map(r => `- ${escape(r)}`).join('\n') : '';
  const notes = work.notes.length ? '\n\nNotes:\n' + work.notes.map(n => `- ${escape(n)}`).join('\n') : '';
  return `${head}${body}${refused}${notes}\n\nSoft recommendations from the claims (D5617) and open PRs; #5618 leases are not read and nothing is blocked.`;
}
