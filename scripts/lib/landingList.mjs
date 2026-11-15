/**
 * D6469 (#6469): the landing list's rules apart from GitHub, the pure half of
 * `../landing-list.mjs`.
 *
 * Tiering is `../merge-policy.mjs`'s `classify` (D5607), fed the PR's files
 * as the REST files endpoint returns them. Required checks are `prRisk.mjs`'s
 * `requiredChecks` (D5580) and the mergeable state its `mergeStatus`, so an
 * uncomputed state reads "unknown", never "clean". The order within a group is
 * `prOverlap.mjs`'s suggested landing order (D5616): a cluster of overlapping
 * PRs keeps its suggested sequence, and clusters sort by `order()` (ready,
 * fewer files, lower number). T2 and model-changed PRs come first: the owner
 * lands those. Nothing here labels, merges, queues or reaches GitHub.
 */
import { classify } from '../merge-policy.mjs';
import { clusters, escape, order, pairs } from './prOverlap.mjs';
import { mergeStatus, requiredChecks } from './prRisk.mjs';

export const MARKER = '<!-- studioos-landing-list:v1 -->';
export const TITLE = 'Landing list: green PRs, T2 first (D6469)';
/** Labels that mean a model changed the PR after review; the owner lands it (#6469). */
export const MODEL_CHANGED = ['bot:resolved', 'main-repair'];

const STATUS = { added: 'A', modified: 'M', changed: 'M', removed: 'D', renamed: 'R', copied: 'C' };

/** The REST files endpoint's rows as `classify` reads them. An unknown status stays unknown, which `classify` makes T2. */
export function policyFiles(rows) {
  return (rows ?? []).map(f => ({
    path: String(f?.filename ?? ''), status: STATUS[f?.status] ?? '?',
    previousPath: f?.previous_filename || undefined, patch: typeof f?.patch === 'string' ? f.patch : '',
  }));
}

/** The tier of a PR from its files, with merge-policy's reasons. */
export function tierOf(files) {
  return classify(policyFiles(files));
}

/** The rule a T2 reason names, without its path: "protected path", "Timeout changed", ... */
export function ruleOf(reason) {
  const m = /^T2: ([^:]+):/.exec(reason);
  if (m) return m[1];
  if (/^T[01]: /.test(reason)) return null;
  return reason.split(':')[0];
}

/** Each distinct T2 rule a classification matched, once. */
export function t2Rules(result) {
  return [...new Set(result.reasons.map(ruleOf).filter(Boolean))].sort();
}

export const modelChanged = pr => (pr.labels ?? []).some(l => MODEL_CHANGED.includes(typeof l === 'string' ? l : l?.name));

/**
 * Whether a PR goes on the list: open, not a draft, and every required check
 * passing on the current head. Anything else (pending, missing, failed,
 * unreadable runs or ruleset, no required set) is left off with its reason.
 */
export function eligibility(pr) {
  if (pr.state && pr.state !== 'open') return { listed: false, reason: 'not open' };
  if (pr.draft) return { listed: false, reason: 'draft' };
  const c = pr.checks;
  if (!c) return { listed: false, reason: 'checks not read' };
  if (c.status === 'passing') return { listed: true };
  return { listed: false, reason: c.status === 'failed' ? 'required check failed' : c.status === 'pending' ? 'required check pending' : c.status === 'none required' ? 'no required checks named' : 'required checks unknown' };
}

/** The checks verdict for one head, from its check runs and the base's required set. */
export const checksFor = (runs, required) => requiredChecks(runs, required);

/** Days open, one decimal; null when the date is unreadable. */
export function ageDays(createdAt, now) {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t <= now ? Math.round((now - t) / 8640000) / 10 : null;
}

/**
 * The landing order: owner-lands group (T2 or model-changed) first, then T0/T1.
 * Inside a group, overlap clusters keep `clusters()`'s order and clusters sort
 * by their first member under `order()`.
 */
export function landingOrder(prs) {
  const owner = pr => pr.tier === 'T2' || pr.modelChanged;
  const groups = [prs.filter(owner), prs.filter(pr => !owner(pr))];
  return groups.flatMap(group => {
    const inCluster = new Map();
    clusters(pairs(group)).forEach((c, i) => c.forEach((pr, j) => inCluster.set(pr.number, [i, j])));
    const units = new Map();
    for (const pr of group) {
      const key = inCluster.has(pr.number) ? `c${inCluster.get(pr.number)[0]}` : `s${pr.number}`;
      if (!units.has(key)) units.set(key, []);
      units.get(key).push(pr);
    }
    const sorted = [...units.values()].map(u => [...u].sort((a, b) => (inCluster.get(a.number)?.[1] ?? 0) - (inCluster.get(b.number)?.[1] ?? 0)));
    const lead = new Map(order(sorted.map(u => u[0])).map((pr, i) => [pr.number, i]));
    return sorted.sort((a, b) => lead.get(a[0].number) - lead.get(b[0].number)).flat();
  });
}

/** One PR's facts for the list. `pr` carries `detail`, `files`, `checks`. */
export function entry(pr, now) {
  const detail = pr.detail ?? {};
  const t = tierOf(pr.files);
  return {
    number: pr.number, title: pr.title ?? detail.title ?? '', url: pr.html_url ?? detail.html_url ?? `https://github.com/AxalNetwork/StudioOS/pull/${pr.number}`,
    tier: t.tier, rules: t2Rules(t), modelChanged: modelChanged(pr), merge: mergeStatus(pr.detail),
    ageDays: ageDays(pr.created_at, now), changed_files: Number.isInteger(detail.changed_files) ? detail.changed_files : (pr.files?.length ?? null),
    files: pr.files, draft: false,
  };
}

/** `mergeStatus` already says unknown when GitHub has not computed it; the state is shown only when known. */
const mergeText = m => `${m.status}${m.mergeableState !== 'unknown' ? ` (${m.mergeableState})` : ''}`;
const line = (e, i) => `${i + 1}. [#${e.number}](${e.url}) ${escape(e.title)} — ${e.tier}${e.modelChanged ? ' · **model-changed, owner lands**' : ''} · mergeable: ${escape(mergeText(e.merge))} · age: ${e.ageDays == null ? 'unknown' : `${e.ageDays} d`} · files: ${e.changed_files ?? 'unknown'}${e.tier === 'T2' && e.rules.length ? ` · T2: ${escape(e.rules.join(', '))}` : ''}`;

/** The sticky issue body. Excluded PRs are counted by reason, never listed as green. */
export function render(entries, { generatedAt, partial = false, excluded = {}, notes = [] } = {}) {
  const owner = entries.filter(e => e.tier === 'T2' || e.modelChanged), auto = entries.filter(e => !(e.tier === 'T2' || e.modelChanged));
  const ex = Object.entries(excluded).filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const section = (title, rows, offset) => `### ${title} (${rows.length})\n\n${rows.length ? rows.map((e, i) => line(e, i + offset)).join('\n') : 'None.'}`;
  return `${MARKER}\n## Landing list${partial ? ' (partial)' : ''}\n\nOpen, non-draft PRs whose required checks are all green on the current head, in landing order. Generated ${escape(generatedAt ?? 'at an unknown time')}.\n${partial ? '\nPartial: a GitHub read failed or a request cap was reached; a PR missing here is not evidence it is red.\n' : ''}\n`
    + section('Owner lands: T2 and model-changed', owner, 0) + '\n\n'
    + section('T0 / T1', auto, owner.length)
    + `\n\nNot listed: ${ex.length ? ex.map(([r, n]) => `${n} ${escape(r)}`).join(', ') : 'none'}.`
    + (notes.length ? '\n\n' + notes.map(n => `- ${escape(n)}`).join('\n') : '')
    + '\n\nTier is merge-policy.mjs over the REST file list (advisory; the `landing policy` check on the PR is authoritative). Order follows the overlap report (D5616). This job never labels, merges or queues (D6469).';
}

/** The tier share over merged PRs and the T2 rules matched most often (a PR counts once per rule). */
export function history(results) {
  const counts = { T0: 0, T1: 0, T2: 0 };
  const rules = new Map();
  for (const r of results) {
    counts[r.tier]++;
    if (r.tier === 'T2') for (const rule of t2Rules(r)) rules.set(rule, (rules.get(rule) ?? 0) + 1);
  }
  const total = results.length;
  const share = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, total ? Math.round(n / total * 1000) / 10 : null]));
  const top = [...rules.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([rule, prs]) => ({ rule, prs }));
  return { total, counts, share, top };
}

export function historyText(h, { requested, partial = false } = {}) {
  const pct = k => h.share[k] == null ? 'n/a' : `${h.share[k]}%`;
  return `Tier share over ${h.total} merged PRs${requested && requested !== h.total ? ` (of ${requested} requested)` : ''}${partial ? ' (partial)' : ''}:\n`
    + ['T0', 'T1', 'T2'].map(k => `- ${k}: ${h.counts[k]} (${pct(k)})`).join('\n')
    + `\n\nT2 rules matched (PRs per rule; a PR can match several):\n`
    + (h.top.length ? h.top.slice(0, 10).map(r => `- ${r.rule}: ${r.prs}`).join('\n') : '- none');
}
