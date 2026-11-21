/**
 * #6312: the coordinator's decisions, apart from GitHub. Which labels an issue
 * ends with, which slot gets a new task, whether an issue moved since the
 * snapshot, whether a write already happened, what a status note says, which
 * issues a weekly delta reads, and the canvas digests recorded on an issue.
 * Owned by `../coordinator.mjs` and `../land-canvas.mjs`; tested in
 * `coordinator.test.mjs`.
 */

export const STATES = ['state:ready', 'state:in-progress', 'state:blocked', 'state:review'];
export const VERDICTS = ['close_done', 'close_superseded', 'release_to_ready', 'keep_blocked_on_owner',
  'keep_blocked_on_dependency', 'keep_blocked_on_design', 'keep_as_is', 'needs_status_fix', 'split_or_rescope'];
/** Slots that never receive a new build task: the coordinator, and slots already carrying a programme. */
export const SLOT_EXCLUDE = ['S01', 'S18', 'S32'];
export const SLOT_RANGE = [1, 37];
export const MARKER_VERSION = 'v1';
/** A run id: starts with a letter or digit, so `--run --go` is never mistaken for one. */
export const RUN_ID = /^[A-Za-z0-9][\w.-]{0,63}$/;

/** `slot:s39` → `S39`; anything that is not a slot label → null. */
export function slotOf(label) {
  const m = /^slot:s(\d{1,2})$/i.exec(String(label));
  return m ? `S${m[1].padStart(2, '0')}` : null;
}

/** A slot is a standard one only if AGENTS.md defines it: upper-case S01 to S37. */
export function isStandardSlotLabel(label) {
  const m = /^slot:S(\d{2})$/.exec(String(label));
  return !!m && Number(m[1]) >= SLOT_RANGE[0] && Number(m[1]) <= SLOT_RANGE[1];
}

/**
 * The labels an issue ends with, computed from its LIVE labels (never from a
 * snapshot) and a requested change `{ state, add, remove, slot }`.
 * Moving to a state other than `state:blocked` drops `needs-decision` and
 * `needs-design` (they mean "blocked on the owner / on a canvas").
 * Refuses what AGENTS.md does not allow: two state labels, a state label
 * removed with none put back, `needs-*` without `state:blocked`, or a
 * non-standard slot. `opts.kind` is the issue's kind: only a tracker, design
 * brief or owner action may move to S01, and no move targets S18 or S32.
 * `opts.activeClaim` (in progress, touched in the last 3 days) refuses a slot move.
 */
export function planLabels(current, change = {}, opts = {}) {
  const cur = [...new Set(current)];
  const hadState = cur.some(l => STATES.includes(l));
  let next = cur.filter(l => !(change.remove || []).includes(l));
  if (change.state) {
    if (!STATES.includes(change.state)) throw new Error(`unknown state ${change.state}`);
    next = next.filter(l => !l.startsWith('state:')).concat(change.state);
    if (change.state !== 'state:blocked') next = next.filter(l => l !== 'needs-decision' && l !== 'needs-design');
  }
  for (const a of change.add || []) if (!next.includes(a)) next.push(a);
  if (change.slot) {
    const slot = String(change.slot).replace(/^slot:/i, '').toUpperCase();
    const label = `slot:${slot}`;
    if (!isStandardSlotLabel(label)) throw new Error(`non-standard slot ${change.slot}`);
    const curSlot = cur.map(slotOf).find(Boolean) || null;
    if (slot !== curSlot) {
      if (['S18', 'S32'].includes(slot)) throw new Error(`${slot} takes no moved work`);
      if (slot === 'S01' && !['tracker', 'design-brief', 'owner-action'].includes(opts.kind)) throw new Error('only trackers, design briefs and owner actions move to S01');
      if (opts.activeClaim) throw new Error('an active claim is not moved without the owner');
    }
    next = next.filter(l => !slotOf(l)).concat(label);
  }
  const states = next.filter(l => STATES.includes(l));
  if (states.length > 1) throw new Error(`two state labels: ${states.join(', ')}`);
  if (hadState && !states.length) throw new Error('the change leaves no state label');
  for (const flag of ['needs-decision', 'needs-design']) {
    if (next.includes(flag) && !next.includes('state:blocked')) throw new Error(`${flag} needs state:blocked, not ${states[0] || 'no state label'}`);
  }
  const added = next.filter(l => !cur.includes(l));
  const removed = cur.filter(l => !next.includes(l));
  return { labels: next, added, removed, changed: added.length + removed.length > 0 };
}

/** One plain sentence describing a label change, for the note. */
export function describeLabelChange({ added, removed }) {
  const parts = [...added.map(a => `added \`${a}\``), ...removed.map(r => `removed \`${r}\``)];
  return parts.length ? `${parts.join(', ')}.` : '';
}

/**
 * Picks the least-loaded standard slot, ties to the lower number. `load` maps
 * `S07` → open issue count. Each pick counts, so a batch spreads.
 */
export function slotPicker(load, { exclude = SLOT_EXCLUDE } = {}) {
  const counts = new Map();
  for (let n = SLOT_RANGE[0]; n <= SLOT_RANGE[1]; n++) {
    const s = `S${String(n).padStart(2, '0')}`;
    if (!exclude.includes(s)) counts.set(s, Number(load[s] || 0));
  }
  if (!counts.size) throw new Error('no slot left to pick');
  return () => {
    let best = null;
    for (const [s, c] of counts) if (best === null || c < counts.get(best)) best = s;
    counts.set(best, counts.get(best) + 1);
    return best;
  };
}

/** Counts open issues per standard slot, folding `slot:s39` into `S39`. */
export function slotLoad(issues) {
  const load = {};
  for (const i of issues) for (const l of i.labels || []) {
    const s = slotOf(typeof l === 'string' ? l : l.name);
    if (s) load[s] = (load[s] || 0) + 1;
  }
  return load;
}

/** What a proposed task is: a build task, a design brief or an owner decision. */
export function classifyProposal(p) {
  const t = String(p.title || '').toLowerCase();
  if (p.type === 'owner-decision' || /^(owner decision|decision:)/.test(t)) return 'decision';
  if (p.type === 'design-brief' || /^claude design brief/.test(t)) return 'brief';
  return 'build';
}

const AREA = { frontend: ['frontend'], worker: ['worker'], 'full-stack': ['frontend', 'worker'], data: ['worker'], docs: ['documentation'] };

/**
 * The labels a new task is filed with. A brief or a decision belongs to the
 * coordinator (AGENTS.md, Missing UI and Owner answers); a build task gets a
 * builder slot and `state:ready` only when nothing must merge first.
 */
export function proposalLabels(p, { slot, ready }) {
  const kind = classifyProposal(p);
  const base = ['task', ...(AREA[p.type] || [])];
  if (kind === 'decision') return { kind, slot: 'S01', labels: [...base, 'slot:S01', 'state:blocked', 'needs-decision'] };
  if (kind === 'brief') return { kind, slot: 'S01', labels: [...base, 'slot:S01', 'state:blocked', 'needs-design'] };
  if (!slot || !isStandardSlotLabel(`slot:${slot}`)) throw new Error('a build task needs a standard slot');
  return { kind, slot, labels: [...base, `slot:${slot}`, ready ? 'state:ready' : 'state:blocked'] };
}

/** The hidden marker every coordinator write carries, so a re-run can tell it already happened. */
export function marker(runId, kind, key = '') {
  if (runId === null || runId === undefined || !RUN_ID.test(String(runId))) throw new Error('invalid run id');
  if (!/^[a-z-]{1,32}$/.test(String(kind))) throw new Error('invalid marker kind');
  if (!/^[\w:.-]{0,128}$/.test(String(key))) throw new Error('invalid marker key');
  return `<!-- coordinator-audit:${MARKER_VERSION} run=${runId} kind=${kind}${key ? ` key=${key}` : ''} -->`;
}

/** Every coordinator marker in a body. */
export function parseMarkers(body) {
  const out = [];
  const re = /<!-- coordinator-audit:(v\d+) run=([\w.-]+) kind=([a-z-]+)(?: key=([\w:.-]+))? -->/g;
  for (let m; (m = re.exec(String(body || ''))); ) out.push({ version: m[1], run: m[2], kind: m[3], key: m[4] || '' });
  return out;
}

/** True when some body already carries this run's marker of this kind (and key). */
export function alreadyDone(bodies, runId, kind, key = '') {
  return bodies.some(b => parseMarkers(b).some(m => m.run === runId && m.kind === kind && m.key === key));
}

/**
 * Whether an issue moved since the snapshot in a way that makes a planned
 * change unsafe: closed, retitled, body edited, labels changed by someone
 * else, or a comment after the snapshot that is not this run's own.
 * `snap` and `live` are `{ state, title, body, labels }`; `newComments` are the
 * comments created after the snapshot.
 */
export function staleReasons(snap, live, newComments, runId) {
  const r = [];
  if (live.state !== 'open') r.push('closed since the snapshot');
  if (live.title !== snap.title) r.push('retitled');
  if (String(live.body || '') !== String(snap.body || '')) r.push('body edited');
  const a = [...snap.labels].sort().join(','), b = [...live.labels].sort().join(',');
  if (a !== b) r.push('labels changed');
  const foreign = newComments.filter(c => !parseMarkers(c.body).some(m => m.run === runId));
  if (foreign.length) r.push(`${foreign.length} new comment(s)`);
  return r;
}

const VERB = {
  close_done: 'finished', close_superseded: 'replaced by other issues', release_to_ready: 'nothing blocks it now',
  keep_blocked_on_owner: 'waiting on the owner', keep_blocked_on_dependency: 'waiting on another issue',
  keep_blocked_on_design: 'waiting on a design canvas', keep_as_is: 'labels are right',
  needs_status_fix: 'labels did not match the facts', split_or_rescope: 'partly done',
};

/**
 * The status note posted on an issue. It starts with `S1:` (AGENTS.md: Session
 * 1's comments do) and ends with the run's marker. `closing` is the close
 * reason (`completed` or `not_planned`), or false.
 */
export function renderNote(f, { runId, mainSha, date, labelText = '', closing = false, footer = '' }) {
  const L = [`S1: coordinator audit, ${date}. Checked against main \`${String(mainSha).slice(0, 10)}\` and this issue's comments and linked PRs. Finding: **${VERB[f.verdict] || f.verdict}**.`];
  if (f.evidence) L.push(`**What I found:** ${f.evidence}`);
  if (f.remaining_work) L.push(`**What is left:** ${f.remaining_work}`);
  if (f.blocked_on && !f.blocker_resolved) L.push(`**Waiting on:** ${f.blocked_on}`);
  if (f.unfinished && !closing) L.push(`**Not closed.** A second check found work still open: ${f.unfinished}`);
  else if (f.recommended_action && !closing) L.push(`**Next step:** ${f.recommended_action}`);
  if (f.owner_question) L.push(`**Question for the owner:** ${f.owner_question}`);
  for (const u of f.updates || []) L.push(`**Update:** ${u}`);
  if (labelText) L.push(`**Labels changed:** ${labelText}`);
  if (closing === 'not_planned') L.push('**Closing as not planned (superseded).** A second check confirmed the issues named above replace it.');
  else if (closing) L.push('**Closing as completed.** A second check that tried to find unfinished work could not.');
  return `${L.join('\n\n')}\n\n${marker(runId, 'note')}${footer}`;
}

/**
 * Turns verified findings into apply steps. A close happens only when the
 * verifier said it is safe; a note is dropped when the verifier could not
 * support it; a label change is applied only when the verifier accepted it.
 */
export function planFromFindings(findings) {
  const seen = new Set();
  return findings.map(f => {
    if (seen.has(f.number)) throw new Error(`two findings for #${f.number}`);
    seen.add(f.number);
    const v = f.verification || {};
    const isClose = f.verdict === 'close_done' || f.verdict === 'close_superseded';
    // A close always comes with its note: an unsupported note blocks the close too.
    const closing = isClose && v.safe_to_close === true && v.note_supported !== false;
    const merged = { ...f, ...(v.corrected || {}) };
    if (isClose && !closing && v.unfinished) merged.unfinished = v.unfinished;
    const quiet = f.verdict === 'keep_as_is' && !merged.remaining_work && !merged.owner_question && !f.label_change;
    return {
      number: f.number,
      kind: f.kind || null,
      note: v.note_supported === false || quiet ? null : merged,
      labelChange: closing ? null : (v.label_change_ok === true ? f.label_change || null : null),
      close: closing ? (f.verdict === 'close_superseded' ? 'not_planned' : 'completed') : null,
    };
  });
}

/**
 * Which open issues a weekly delta re-reads: created since `since`, or with
 * activity after their last audit note (a grace window covers the label edit
 * that follows a note), or named by a PR merged since `since`.
 * `lastNoteAt` maps issue → ISO time of its latest audit note.
 */
export function deltaSelect({ issues, since, lastNoteAt, mergedPrBodies = [], graceMinutes = 10 }) {
  const named = new Set();
  for (const b of mergedPrBodies) for (const m of String(b || '').matchAll(/#(\d{1,6})\b/g)) named.add(Number(m[1]));
  const sinceMs = Date.parse(since), grace = graceMinutes * 60e3;
  const out = new Map();
  for (const i of issues) {
    const note = lastNoteAt[i.number] ? Date.parse(lastNoteAt[i.number]) : null;
    if (Date.parse(i.created_at) > sinceMs) out.set(i.number, 'new since the last audit');
    else if (named.has(i.number)) out.set(i.number, 'named by a merged PR');
    else if (Date.parse(i.updated_at) > sinceMs && (note === null || Date.parse(i.updated_at) > note + grace)) out.set(i.number, 'activity after its last audit note');
  }
  return out;
}

/** `Build v2.dc.html` → `Build v2 · Boards.dc.html`; a page file keeps its name. */
export function landedName(published) {
  const name = String(published);
  if (!name.endsWith('.dc.html')) throw new Error(`not a canvas file: ${name}`);
  if (/ Page\.dc\.html$/.test(name) || / · Boards\.dc\.html$/.test(name)) return name;
  return name.replace(/\.dc\.html$/, ' · Boards.dc.html');
}

/**
 * The SHA-256 digests recorded on an issue for canvas files. `sources` are
 * `{ body, trusted }`: only trusted ones (the issue body and comments by the
 * owner, members or collaborators) count, so a passer-by cannot record a
 * digest. On each line every backticked `*.dc.html` name is paired with the
 * last 64-hex string before the next name (so "was X, now Y" gives Y).
 * Two trusted sources that disagree make the file a `conflict`.
 */
export function parseDigests(sources) {
  const out = {}, conflict = new Set();
  for (const src of sources) {
    const { body, trusted } = typeof src === 'string' ? { body: src, trusted: true } : src;
    if (!trusted) continue;
    for (const line of String(body || '').split('\n')) {
      const tokens = [...line.matchAll(/`([^`/\\]+\.dc\.html)`|\b([0-9a-fA-F]{64})\b/g)];
      let file = null;
      const found = {};
      for (const t of tokens) {
        if (t[1]) file = t[1].trim();
        else if (file) found[file] = t[2].toLowerCase();
      }
      for (const [f, h] of Object.entries(found)) {
        if (out[f] && out[f] !== h) conflict.add(f);
        out[f] = h;
      }
    }
  }
  for (const f of conflict) out[f] = 'conflict';
  return out;
}

/** Board ids and titles from a boards file's `renderVals` list: `['V1', 'Validate overview', …]`. */
export function boardsOf(html) {
  const out = [];
  for (const m of String(html).matchAll(/\[\s*'([A-Z]{1,4}-?[0-9A-Za-z]{0,4})',\s*'([^']{1,160})'/g)) out.push({ id: m[1], title: m[2] });
  return out;
}

/**
 * Compares local files with recorded digests: `match`, `mismatch`, `conflict`
 * (trusted sources disagree) or `unrecorded`. A digest recorded under the
 * landed name (`X · Boards.dc.html`) counts for the published one (`X.dc.html`).
 */
export function compareDigests(local, recorded) {
  return Object.entries(local).map(([file, sha]) => {
    let want = recorded[file];
    if (!want && file.endsWith('.dc.html')) want = recorded[landedName(file)];
    const result = !want ? 'unrecorded' : want === 'conflict' ? 'conflict' : want === sha ? 'match' : 'mismatch';
    return { file, sha, recorded: want || null, result };
  });
}
