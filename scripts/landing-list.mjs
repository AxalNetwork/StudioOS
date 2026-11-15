#!/usr/bin/env node
/**
 * D6469 (#6469): the owner's landing list. Read-only on GitHub apart from one
 * sticky issue body; never labels, merges or queues.
 *
 *   node scripts/landing-list.mjs                 print the list (open, non-draft, required checks green)
 *   node scripts/landing-list.mjs --history[=N]   tier share over the last N merged PRs (default 300)
 *   node scripts/landing-list.mjs --sticky        edit the one sticky issue in place (create it once)
 *   add --dry-run to --sticky to print without writing.
 *
 * GitHub access is `pr-overlap.mjs`'s bounded `gh api` client (D5616).
 */
import { pathToFileURL } from 'node:url';
import { makeApi } from './pr-overlap.mjs';
import { MARKER, TITLE, checksFor, eligibility, entry, history, historyText, landingOrder, render, tierOf } from './lib/landingList.mjs';
import { dedupe, isStale, requiredFromRules } from './lib/prRisk.mjs';

const REF = /^(?!.*\.\.)[\w][\w./-]{0,199}$/;
const SHA = /^[a-f0-9]{40}$/;
const gone = error => error?.status === 404 || error?.status === 410;

async function pages(api, path, { max = 10, onCap } = {}) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const rows = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('unreadable list');
    out.push(...rows);
    if (rows.length < 100) return out;
  }
  onCap?.();
  return out;
}

async function filesOf(api, number) {
  let capped = false;
  const rows = await pages(api, `pulls/${number}/files`, { max: 30, onCap: () => { capped = true; } });
  return { rows, capped };
}

/** The list: every open PR read, drafts and non-green heads counted out, the rest tiered and ordered. */
export async function collect({ api, now = Date.now() } = {}) {
  const excluded = {}; const notes = []; let partial = false; const listed = [];
  const out = reason => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  try {
    let prs = dedupe(await pages(api, 'pulls?state=open', { onCap: () => { partial = true; } }));
    const rules = new Map();
    for (const pr of prs) {
      if (pr.draft) { out('draft'); continue; }
      try {
        const detail = await api('GET', `pulls/${pr.number}`);
        if (detail?.state && detail.state !== 'open') { out('not open'); continue; }
        if (detail?.draft) { out('draft'); continue; }
        if (isStale(pr, detail)) { out('head changed during the scan'); continue; }
        pr.detail = detail;
        const ref = pr.base?.ref, sha = pr.head?.sha;
        if (!REF.test(ref ?? '') || !SHA.test(sha ?? '')) { out('required checks unknown'); continue; }
        if (!rules.has(ref)) {
          try { rules.set(ref, requiredFromRules(await api('GET', `rules/branches/${encodeURIComponent(ref)}`))); }
          catch (error) { if (error.partial) throw error; rules.set(ref, null); }
        }
        let runs = null;
        try {
          runs = [];
          for (let page = 1; page <= 3; page++) {
            const r = await api('GET', `commits/${sha}/check-runs?per_page=100&page=${page}`);
            if (!Array.isArray(r?.check_runs)) throw new Error('unreadable');
            runs.push(...r.check_runs);
            if (r.check_runs.length < 100) break;
            if (page === 3) throw new Error('too many check runs');
          }
        } catch (error) { if (error.partial) throw error; runs = null; }
        pr.checks = checksFor(runs, rules.get(ref));
        const e = eligibility(pr);
        if (!e.listed) { out(e.reason); continue; }
        const f = await filesOf(api, pr.number);
        pr.files = f.rows;
        if (f.capped) { notes.push(`#${pr.number}: file list capped at 3,000; tier is T2 at least`); partial = true; }
        listed.push(entry(pr, now));
      } catch (error) {
        if (error.partial) throw error;
        if (gone(error)) { notes.push(`#${pr.number} disappeared during the scan; dropped`); continue; }
        out('unreadable'); partial = true;
      }
    }
  } catch (error) { partial = true; notes.push(`Partial scan: ${error.partial ? error.message : 'GitHub read failed'}`); }
  return { entries: landingOrder(listed), excluded, notes, partial };
}

/** The tier share over the last `count` merged PRs, newest merge first. */
export async function measure({ api, count = 300 } = {}) {
  const merged = [];
  let partial = false;
  for (let page = 1; page <= 20 && merged.length < count * 1.5; page++) {
    const rows = await api('GET', `pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) { partial = true; break; }
    merged.push(...rows.filter(r => r?.merged_at));
    if (rows.length < 100) break;
  }
  const latest = dedupe(merged).sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at)).slice(0, count);
  const results = [];
  for (const pr of latest) {
    try {
      const f = await filesOf(api, pr.number);
      const t = tierOf(f.rows);
      results.push({ number: pr.number, ...t });
      if (f.capped) partial = true;
    } catch (error) { partial = true; if (error.partial) break; }
  }
  return { h: history(results), results, partial, requested: count };
}

/** Edits the one sticky issue in place; creates it once when absent. Returns the number of writes. */
export async function upsertSticky(api, body, { dryRun = false, author = 'github-actions[bot]' } = {}) {
  const open = await pages(api, `issues?state=open&creator=${encodeURIComponent(author)}`, { max: 10 });
  const existing = open.find(i => !i.pull_request && i.user?.login === author && typeof i.body === 'string' && i.body.startsWith(MARKER));
  if (existing?.body === body || dryRun) return 0;
  if (existing) await api('PATCH', `issues/${existing.number}`, { body });
  else await api('POST', 'issues', { title: TITLE, body });
  return 1;
}

export async function main(argv = process.argv.slice(2), { api, log = console.log, now = Date.now(), author } = {}) {
  const allowed = a => a === '--sticky' || a === '--dry-run' || /^--history(?:=\d{1,4})?$/.test(a);
  if (argv.some(a => !allowed(a)) || (argv.includes('--dry-run') && !argv.includes('--sticky'))) {
    throw new Error('usage: landing-list.mjs [--history[=N]] | [--sticky [--dry-run]]');
  }
  const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? 'AxalNetwork/StudioOS';
  api ??= makeApi(repo, { maxRequests: 1500 });
  const hist = argv.find(a => a.startsWith('--history'));
  if (hist) {
    const count = Number(hist.split('=')[1] ?? 300);
    const m = await measure({ api, count });
    log(historyText(m.h, { requested: m.requested, partial: m.partial }));
    return m;
  }
  const list = await collect({ api, now });
  const body = render(list.entries, { generatedAt: new Date(now).toISOString(), partial: list.partial, excluded: list.excluded, notes: list.notes });
  log(body);
  if (argv.includes('--sticky')) {
    try { list.writes = await upsertSticky(api, body, { dryRun: argv.includes('--dry-run'), author: author ?? (process.env.GITHUB_ACTIONS === 'true' ? 'github-actions[bot]' : undefined) }); }
    catch { list.writes = 0; log('Sticky issue not updated: GitHub refused or capped the write.'); }
  }
  return list;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.log(`Landing list not produced: ${error.message}`); process.exitCode = /usage/.test(error.message) ? 1 : 0; });
}
