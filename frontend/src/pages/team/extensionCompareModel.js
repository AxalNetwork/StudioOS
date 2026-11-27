/**
 * #5964 (D5963, D4538 part 2) — Team › Skills › Compare with Axal, as pure functions.
 *
 * An extension is a company skill copied from one published Axal version, with a
 * reason. `GET /api/teams/skills/:uid/base` answers its `lineage`: the exact base
 * version's parts, Axal's newest (only when an update is available) and, per part,
 * the Worker's own `company_changed` / `base_changed` / `conflict` (`threeWay()`).
 * The markers come from those flags, never from a second comparison here; only the
 * + / − lines inside a part are computed in the browser (D5963 "Frontend only").
 *
 * States follow Platform States (D5129): a base that cannot be read is never drawn
 * as "up to date" or as an empty comparison, and a null `based_on_version` reads
 * "Not recorded", never "v0".
 */

export const PART_ORDER = ['name', 'purpose', 'steps', 'tools', 'output_kind', 'tags', 'roles'];
export const PART_LABELS = { name: 'Name', purpose: 'Purpose', steps: 'Steps', tools: 'Tools', output_kind: 'Output', tags: 'Skill tags', roles: 'Roles' };

/** Every marker is a word and a glyph, never colour alone (SK-17's legend). */
export const MARKERS = { c: 'Conflict', y: 'Changed by you', a: 'Changed by Axal', s: 'Same as Axal' };

export const REASON_MAX = 300;
export const NAME_MAX = 80;

const num = (n) => (Number.isSafeInteger(n) && n > 0 ? n : null);

/** The Worker's flags for one part → its marker key. */
export function markerOf(f) {
  if (!f) return 's';
  if (f.conflict) return 'c';
  if (f.company_changed) return 'y';
  if (f.base_changed) return 'a';
  return 's';
}

/** A part as the screen compares it: text, or a list of lines. Tags read "Label · level", roles their label, tools their key. */
export function partValue(parts, field) {
  if (!parts || typeof parts !== 'object') return null;
  if (field === 'name') return typeof parts.name === 'string' ? parts.name : null;
  // A card read through `fromWorkerSkill` calls the purpose `description` and keeps role labels in `role_labels`.
  if (field === 'purpose') { const p = parts.purpose ?? parts.description; return typeof p === 'string' ? p : null; }
  if (field === 'roles' && Array.isArray(parts.role_labels)) return parts.role_labels;
  if (field === 'output_kind') return parts.output_label || parts.output_kind || null;
  if (field === 'steps') return Array.isArray(parts.steps) ? parts.steps.map(String) : [];
  if (field === 'tools') return (Array.isArray(parts.tools) ? parts.tools : []).map((t) => (typeof t === 'string' ? t : t?.key)).filter(Boolean);
  if (field === 'tags') {
    return (Array.isArray(parts.tags) ? parts.tags : Array.isArray(parts.taxonomy) ? parts.taxonomy : []).map((t) => {
      const label = t?.label ?? t?.skill_label ?? t?.slug ?? t?.skill_slug ?? '';
      return t?.level != null && t.level !== '' ? `${label} · ${typeof t.level === 'number' ? `level ${t.level}` : t.level}` : label;
    });
  }
  if (field === 'roles') return (Array.isArray(parts.roles) ? parts.roles : []).map((r) => (typeof r === 'string' ? r : r?.label || r?.key)).filter(Boolean);
  return null;
}

/**
 * Lines `b` against `a`: `=` kept, `-` removed, `+` added (a longest common subsequence). With `full` false a run of
 * kept lines folds into one `{ op: 'eq', count }` row, as SK-17's cells do; SK-20's close-up shows every line.
 */
export function lineDiff(a, b, { full = false } = {}) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  const n = x.length, m = y.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) d[i][j] = x[i] === y[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  const raw = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { raw.push({ op: '=', text: x[i] }); i += 1; j += 1; }
    else if (d[i + 1][j] >= d[i][j + 1]) { raw.push({ op: '-', text: x[i] }); i += 1; }
    else { raw.push({ op: '+', text: y[j] }); j += 1; }
  }
  while (i < n) { raw.push({ op: '-', text: x[i] }); i += 1; }
  while (j < m) { raw.push({ op: '+', text: y[j] }); j += 1; }
  if (full) return raw;
  const out = [];
  let run = 0;
  const flush = () => { if (run) { out.push({ op: 'eq', count: run }); run = 0; } };
  for (const r of raw) { if (r.op === '=') { run += 1; continue; } flush(); out.push(r); }
  flush();
  return out;
}

/**
 * A tools cell against the base: the union, each marked. A tool the other side added is `+` (on Axal's newest it is
 * "New in Axal vN — not available to this extension": an extension's tools narrow and never widen, D4538 part 2).
 */
export function toolsCell(base, other, side, newest) {
  const b = Array.isArray(base) ? base : [];
  const o = Array.isArray(other) ? other : [];
  return b.concat(o.filter((t) => !b.includes(t))).map((t) => {
    if (!b.includes(t)) return { tool: t, op: '+', note: side === 'newest' ? `New in Axal v${newest} — not available to this extension` : 'Added' };
    if (!o.includes(t)) return { tool: t, op: '-', note: side === 'mine' ? 'Removed by you' : 'Removed by Axal' };
    return { tool: t, op: '=' };
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** One cell: `same` (as the base), `text` (changed or the base's own), `lines` (a list against the base) or `tools`. */
export function cellOf(row, side, nv) {
  const val = side === 'base' ? row.base : side === 'mine' ? row.mine : row.newest;
  if (side !== 'base' && same(val, row.base)) return { kind: 'same', words: `Same as Axal v${nv.base}` };
  if (row.field === 'tools') return { kind: 'tools', tools: side === 'base' ? (row.base || []).map((t) => ({ tool: t, op: '=' })) : toolsCell(row.base, val, side, nv.newest) };
  if (Array.isArray(val)) return side === 'base' ? { kind: 'list', items: val, numbered: row.field === 'steps' } : { kind: 'lines', lines: lineDiff(row.base, val) };
  if (val == null || val === '') return { kind: 'unrecorded' };
  return { kind: 'text', text: val, changed: side !== 'base' };
}

/** Conflicting parts first, then the fixed order; the order within each group is PART_ORDER's. */
export function conflictsFirst(rows) {
  return rows.filter((r) => r.marker === 'c').concat(rows.filter((r) => r.marker !== 'c'));
}

/** History: each published company version and the Axal version it was built on; a null base reads Not recorded. */
export function historyRows(versions) {
  return (Array.isArray(versions) ? versions : [])
    .filter((v) => num(v?.version))
    .map((v) => ({ version: v.version, builtOn: num(v.based_on_version) }));
}

/**
 * The page, from the skill's card (`GET /skills/:uid`, as `fromWorkerSkill` reads it) and its lineage.
 * `kind` is `standalone` (lineage null), `unreadable_base` (lineage.base null: no comparison, no update signal,
 * never "up to date") or `compare`.
 */
export function compareView(card, lineage) {
  if (!lineage) return { kind: 'standalone' };
  const basedOn = num(lineage.based_on?.version);
  const common = {
    basedOn,
    reason: typeof lineage.reason === 'string' && lineage.reason.trim() ? lineage.reason : null,
    history: historyRows(lineage.versions),
    baseUid: lineage.based_on?.skill_uid || null,
  };
  const b = lineage.base;
  if (!b || !b.version || !Array.isArray(lineage.fields)) return { kind: 'unreadable_base', ...common };
  const update = lineage.base_update_available === true && !!b.newest;
  const flags = new Map(lineage.fields.map((f) => [f.field, f]));
  const rows = PART_ORDER.map((field) => ({
    field,
    label: PART_LABELS[field],
    marker: markerOf(flags.get(field)),
    // #4538 (SK-20): which side changed it, as the Worker's `threeWay()` says; the rebase's result lines read these.
    companyChanged: !!flags.get(field)?.company_changed,
    baseChanged: !!flags.get(field)?.base_changed,
    base: partValue(b.version, field),
    mine: partValue(card, field),
    newest: update ? partValue(b.newest, field) : null,
  }));
  const conflicts = rows.filter((r) => r.marker === 'c').length;
  return {
    kind: 'compare',
    ...common,
    baseName: b.name || null,
    baseVersion: num(b.version.version) ?? basedOn,
    currentVersion: num(b.current_version),
    newestVersion: update ? num(b.newest.version) : null,
    update,
    retired: !!b.retired,
    suspended: !!b.suspended,
    companySide: lineage.company?.side === 'draft' ? 'draft' : 'version',
    companyVersion: num(lineage.company?.version),
    conflicts,
    rows: conflictsFirst(rows),
  };
}

/** The columns: Axal's base, yours, and Axal's newest only when an update is available. */
export function columnsOf(view, card) {
  const mine = view.companySide === 'draft'
    ? ['Your draft', 'Not published']
    : [`Your version v${view.companyVersion ?? card?.version ?? '?'}`, 'Published'];
  const cols = [{ side: 'base', title: `Axal v${view.baseVersion}`, sub: 'what you built on' }, { side: 'mine', title: mine[0], sub: mine[1] }];
  if (view.update) cols.push({ side: 'newest', title: `Axal v${view.newestVersion}`, sub: 'newest' });
  return cols;
}

/** SK-17's banner words. */
export function bannerWords(view) {
  if (view.update) {
    const c = view.conflicts;
    return {
      kind: 'update',
      head: `Axal published v${view.newestVersion}. Your extension is based on v${view.baseVersion}. ${c ? `${c} ${c === 1 ? 'part conflicts' : 'parts conflict'}.` : 'No parts conflict.'}`,
      sub: 'Your agents keep their pinned version. Nothing changes until you choose.',
    };
  }
  if (view.retired) return { kind: 'retired', head: 'No further Axal versions. Your extension keeps working.' };
  return { kind: 'current', head: `Up to date with Axal v${view.baseVersion}` };
}

/**
 * Who may act. Editors are the card's writers (`can_write`): they see "Edit my draft" and, when Axal has a newer
 * version, "Extend Axal vN again" (disabled with its reason while that version is suspended; hidden for a retired base).
 * Members and HQ admins read only: HQ moderates company skills and never writes one (D4161, owner Q2 option A).
 */
export function actionsFor(view, card, { hqAdmin = false } = {}) {
  const editor = !!card?.can_write;
  if (!editor) return { editor: false, readOnly: hqAdmin ? 'hq' : 'member', extendAgain: null, rebase: null };
  const extendAgain = view.kind === 'compare' && view.update && !view.retired
    ? { version: view.newestVersion, disabled: view.suspended, why: view.suspended ? `Axal has paused v${view.newestVersion}, so it cannot be extended right now.` : null }
    : null;
  // #4538 (SK-20): Rebase rides with Extend again. It needs the draft version the card was read at (the Worker refuses
  // a rebase without it), so a card without `draft_hash` offers Reload instead of guessing.
  const rebase = extendAgain
    ? (view.suspended ? { disabled: true, why: `Axal has paused v${view.newestVersion}, so it cannot be rebased onto right now.` }
      : !card?.draft_hash ? { disabled: true, why: 'Your draft’s version could not be read. Reload the page to rebase.' }
        : { disabled: false, why: null })
    : null;
  return { editor: true, readOnly: null, extendAgain, rebase };
}

/** Each refusal of `POST /extend`, in SK-21's words, tied to the field it is about. */
const REFUSALS = {
  fork_reason_invalid: ['reason', 'Say why your company is extending this skill, in up to 300 characters.'],
  name_missing: ['name', 'Give the skill a name of up to 80 characters.'],
  name_invalid: ['name', 'Give the skill a name of up to 80 characters.'],
  slug_taken: ['name', 'Your company already has a skill with this short name. Give the extension another name.'],
  base_retired: ['dialog', 'This Axal skill is retired, so it cannot be extended.'],
  base_suspended: ['dialog', 'This version of the Axal skill is suspended, so it cannot be extended.'],
  version_not_published: ['version', 'Only a published version of an Axal skill can be extended.'],
  version_invalid: ['version', 'Name the published version to extend as a whole number.'],
  not_editor: ['dialog', 'Only the company’s editors write its skills.'],
  not_found: ['dialog', 'There is no such skill.'],
  base_not_hq: ['dialog', 'Only an Axal skill can be extended. A company skill is edited in place.'],
};

/** `{ field, text }` for a refusal: a known code in its own words; any other code in the Worker's message. */
export function extendRefusal(code, message) {
  const hit = REFUSALS[code];
  if (hit) return { field: hit[0], text: hit[1] };
  return { field: 'dialog', text: message || 'The extension wasn’t created. Your reason, name and version are still here. Nothing was made.' };
}

/**
 * The body `POST /extend` takes. The reason is required (1 to 300 characters once trimmed); the name is sent only
 * when it differs from Axal's (the Worker copies Axal's otherwise); the version only when one was chosen.
 */
export function extendBody({ company, reason, name, baseName, version }) {
  const r = String(reason ?? '').replace(/\r\n?/g, '\n').trim();
  const n = String(name ?? '').trim();
  return {
    company,
    reason: r,
    ...(n && n !== baseName ? { name: n } : {}),
    ...(num(version) ? { version } : {}),
  };
}

/** Checked before sending: the reason's length, as the Worker counts it. */
export function reasonProblem(reason) {
  const r = String(reason ?? '').replace(/\r\n?/g, '\n').trim();
  return !r || r.length > REASON_MAX ? REFUSALS.fork_reason_invalid[1] : null;
}

/** The versions a dialog offers, newest first: every published version up to the current one. */
export function versionChoices(current) {
  const n = num(current);
  return n ? Array.from({ length: n }, (_, i) => n - i) : [];
}

// ---------------------------------------------------------------- SK-20: Rebase onto Axal vN (D4538 part 5, #4538)

/** The parts a person can write by hand in the dialog. Output, Skill tags and Roles are kept or taken here, and edited in the new draft. */
export const HAND_EDITABLE = ['name', 'purpose', 'steps', 'tools'];

/**
 * What the new draft keeps, part by part, before any choice: each conflict needs one; every other part follows the
 * Worker's rule (D4538 part 5): changed only by Axal → taken from Axal vN; changed by you → kept from yours (the same
 * change on both sides stays); changed by neither → unchanged. Only offered with an update and a readable comparison.
 */
export function rebasePlan(view) {
  if (view?.kind !== 'compare' || !view.update) return null;
  const conflicts = view.rows.filter((r) => r.marker === 'c');
  const others = view.rows.filter((r) => r.marker !== 'c');
  const group = (pick) => others.filter(pick).map((r) => r.label);
  return {
    version: view.newestVersion,
    conflicts: conflicts.map((r) => ({ field: r.field, label: r.label, editable: HAND_EDITABLE.includes(r.field) })),
    taken: group((r) => r.baseChanged && !r.companyChanged),
    kept: group((r) => r.companyChanged),
    unchanged: group((r) => !r.baseChanged && !r.companyChanged),
  };
}

/** The tools new in Axal's newest version and not in yours: only a rebase that takes Axal's (or a new extension) carries them. */
export function newToolsOnly(view) {
  const row = view?.rows?.find((r) => r.field === 'tools');
  if (!row || !Array.isArray(row.newest)) return [];
  const mine = Array.isArray(row.mine) ? row.mine : [];
  return row.newest.filter((t) => !mine.includes(t));
}

/** Tools a list keeps that Axal's newest version does not have: the Worker refuses them (`tool_not_in_base`). */
export function toolsOutsideNewest(view, tools) {
  const row = view?.rows?.find((r) => r.field === 'tools');
  const newest = Array.isArray(row?.newest) ? row.newest : null;
  if (!newest) return [];
  return (Array.isArray(tools) ? tools : []).filter((t) => !newest.includes(t));
}

/** A hand-written part as the Worker's draft takes it: text trimmed; steps one per line, blank lines dropped; tools as keys. */
export function handValue(field, raw) {
  if (field === 'steps') return String(raw ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (field === 'tools') return (Array.isArray(raw) ? raw : []).map(String);
  return String(raw ?? '').replace(/\r\n?/g, '\n').trim();
}

/** The conflicts still without a choice, in the dialog's order. */
export function unresolved(plan, choices) {
  return (plan?.conflicts || []).filter((c) => !['mine', 'axal', 'edit'].includes(choices?.[c.field]?.choice)).map((c) => c.field);
}

/**
 * `POST /skills/:uid/rebase`'s body: the exact Axal version the page shows, the draft version the page read, and one
 * choice per conflicting part. "Edit by hand" sends the part's draft value; the others send no value.
 */
export function rebaseBody({ version, draftHash, choices, plan }) {
  const resolutions = {};
  for (const c of plan?.conflicts || []) {
    const pick = choices?.[c.field];
    if (!pick) continue;
    resolutions[c.field] = pick.choice === 'edit' ? { choice: 'edit', value: handValue(c.field, pick.value) } : { choice: pick.choice };
  }
  return { version, expected_draft_hash: draftHash, resolutions };
}

/** Each refusal of `POST /rebase`, in the dialog's words. `reload` asks for the page to be read again; `part` ties it to a conflict. */
const REBASE_REFUSALS = {
  draft_conflict: ['Your draft changed since this page was read. Nothing was saved. Reload, then choose again.', true],
  rebase_conflict: ['Axal’s versions changed since this page was read. Nothing was saved. Reload, then choose again.', true],
  no_base_update: ['There is no newer Axal version to rebase onto any more. Nothing was saved. Reload the comparison.', true],
  base_suspended: ['Axal has paused this version, so it cannot be rebased onto right now. Nothing was saved.', false],
  base_retired: ['This Axal skill is retired, so it cannot be rebased onto. Nothing was saved.', false],
  base_unreadable: ['Axal’s version could not be read. Nothing was saved.', true],
  company_version_unreadable: ['Your published version could not be read. Nothing was saved.', true],
  company_archived: ['This company is archived, so its skills are read only. Nothing was saved.', false],
  retired: ['This skill is retired, so it cannot be rebased. Nothing was saved.', false],
  not_editor: ['Only your company’s editors can rebase its skills.', false],
  not_found: ['There is no such skill.', false],
  not_extension: ['This skill is not based on an Axal skill, so there is nothing to rebase.', false],
  conflict_unresolved: ['Choose what the new draft keeps for this part.', false],
  tool_not_in_base: [null, false],
};

/** `{ part, text, reload }` for a refusal; a code tied to a part (the Worker's `part`) shows on that part. */
export function rebaseRefusal(code, message, part = null) {
  const hit = REBASE_REFUSALS[code];
  const text = (hit && hit[0]) || message || 'The draft wasn’t created. Your choices are still here. Nothing was saved.';
  return { part: part && PART_ORDER.includes(part) ? part : null, text, reload: !!hit?.[1] };
}

const enc = encodeURIComponent;
/** The compare page (owner Q1 option A): its own address under the company's Team. */
export const compareHref = (companyUid, skillUid) => `/account/companies/${enc(companyUid)}/settings/team/skills/${enc(skillUid)}/base`;
/** The skill's page on Team › Skills (SK-10). */
export const skillHref = (companyUid, skillUid) => `/account/companies/${enc(companyUid)}/settings/team?tab=skills&skill=${enc(skillUid)}`;
