#!/usr/bin/env node
/**
 * The AI must not describe itself in regulated terms.
 *
 * "Eadwyn recommends…", "your AI advisor", "this advice", "fiduciary" — each of
 * those is a claim about a relationship the product does not have and is not
 * licensed to have. A human advisor on this platform genuinely IS an advisor;
 * the model is not, and the distance between those two facts is the entire
 * point of this check.
 *
 * SCOPE IS THE HARD PART, and it is why this is not a repo-wide grep. The word
 * "advisor" appears about a thousand times in this codebase and almost all of
 * it is legitimate: a `role = 'advisor'` column, /advisors the human directory,
 * AdvisorAdvisoryWorkspace, advisor_bank tables, the whole Practice surface. A
 * check that flagged those would be turned off within a week.
 *
 * So the scope is a hand-listed set of AI SURFACES, each with the reason it is
 * on the list — the files where a string is the model talking, or the product
 * naming the model. Adding a new AI surface means adding it here; that is the
 * intended friction, and `npm run test:drift` fails on an entry whose file has
 * gone, so the list cannot rot quietly.
 *
 * WHAT IS SCANNED inside those files: user-visible text only. Whole-line
 * comments are stripped (a docblock explaining the rule must be able to say
 * "advice"), and identifiers are ignored — `task: 'advisor_explain'` is a join
 * key to the router's routing table, not a sentence anyone reads. What is left
 * is quoted prose and JSX text, which is what a user actually sees.
 *
 * THE LEDGER. "Personal Advisor" is a shipped product name — the landing page,
 * the command palette, the chatbot header. Renaming it is a product decision
 * with marketing and support consequences, not a lint fix, and this check does
 * not attempt it. Every existing occurrence is recorded in
 * scripts/regulated-wording-baseline.json with its reason. What the check buys
 * is that the exposure STOPS GROWING: new copy cannot quietly add more.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/regulated-wording-baseline.json');

/**
 * The AI surfaces. Each entry is a file whose strings are either the model
 * speaking or the product naming the model.
 */
export const SURFACES = [
  ['copy', 'frontend/src/ui/eadwynConfig.js', 'every string on the AI rail: mode notes, guardrail, footers'],
  ['copy', 'frontend/src/ui/AssistRail.jsx', 'the rail itself — headings, buttons, empty states'],
  ['copy', 'frontend/src/ui/AssistLayout.jsx', 'the shell that mounts the rail beside a page'],
  // The workspace rail, on every founder desk and every investor workspace.
  // LIMIT, stated rather than implied: `stance`, `note`, `coverage` and
  // `unavailable` are written by the CALLING page, so scanning this file covers
  // the rail's own chrome and not the strings passed into it. Adding the
  // callers means scanning two dozen page files for four prop values, which is
  // a scanner change rather than a list entry.
  ['copy', 'frontend/src/ui/WorkerRail.jsx', 'the workspace AI rail — headings, guardrail, usage meter'],
  ['copy', 'frontend/src/components/advisor/PersonalAdvisor.jsx', 'the chatbot UI — header, placeholder, empty states'],
  ['copy', 'frontend/src/components/advisor/AdvisorFilledBanner.jsx', 'tells the user the model filled their fields'],
  ['copy', 'frontend/src/components/advisor/AdvisorProgressWidget.jsx', 'the chatbot progress rail'],
  ['copy', 'frontend/src/components/PageExplainer.jsx', 'AI page explanations rendered as prose'],
  // The Studio (D322). Each home mounts the Eadwyn chat and says what happens
  // when it is unavailable; the profile band and the archetype card tell the
  // user where their answers come from. The advisor home is also the human
  // advisor's own page, so its role and practice copy is on record below.
  ['copy', 'frontend/src/components/profile/ProfileFitSection.jsx', 'the profile band: skills, values, archetype, and where the answers come from'],
  ['copy', 'frontend/src/pages/ArchetypeCardPage.jsx', 'the full archetype card and its empty state'],
  ['copy', 'frontend/src/pages/founder/FounderStudioHome.jsx', 'the founder Studio home, around the Eadwyn chat'],
  ['copy', 'frontend/src/pages/founder/founderStudioCards.jsx', 'the founder Studio cards'],
  ['copy', 'frontend/src/pages/investor/InvestorStudioHome.jsx', 'the investor Studio home, around the Eadwyn chat'],
  ['copy', 'frontend/src/pages/investor/investorStudioParts.jsx', 'the investor Studio stat rows'],
  ['copy', 'frontend/src/pages/advisor/AdvisorStudioHome.jsx', 'the advisor Studio home, around the Eadwyn chat'],
  ['copy', 'frontend/src/pages/partner/PartnerStudioHome.jsx', 'the partner Studio home, around the Eadwyn chat'],
  ['copy', 'frontend/src/pages/admin/AdminStudioHome.jsx', 'the admin Studio home, which mounts the Eadwyn chat'],
  // D324 — every Studio home mounts Eadwyn through these two: the wrapper, and
  // the collapsed "interview complete" row with its proposals and ticket action.
  ['copy', 'frontend/src/components/advisor/StudioInterview.jsx', 'the Studio chat wrapper'],
  ['copy', 'frontend/src/components/advisor/interviewCompleteRow.jsx', 'the collapsed interview row: completion, proposals, ticket, Resume'],
  ['prompt', 'cloudflare-worker/src/services/advisor/guardrails.ts', 'ADVISOR_SYSTEM_PROMPT — the model being told who it is'],
  ['prompt', 'cloudflare-worker/src/services/decks/autofill.ts', 'the deck autofill system message'],
  ['prompt', 'cloudflare-worker/src/services/publications.ts', 'buildSystemPrompt for drafted publications'],
  ['prompt', 'cloudflare-worker/src/services/market_intel/extractors/index.ts', 'the paraphrase systemPrompt'],
];

/**
 * The lexicon. Four families, from the integration brief: advice/advise,
 * advisor/adviser/advisory, recommend*, fiduciary.
 *
 * `advisor` is matched only when it is NOT part of an identifier — the strings
 * that survive stripping are prose, but a prose string can still contain a
 * route like '/advisor/advisory/clients', which is a URL, not a claim.
 */
const LEXICON = [
  ['advice', /\badvice\b/i],
  ['advise', /\badvis(e|es|ed|ing)\b/i],
  ['advisor', /\badvis[eo]r(s)?\b/i],
  ['advisory', /\badvisory\b/i],
  ['recommend', /\brecommend(s|ed|ing|ation|ations)?\b/i],
  ['fiduciary', /\bfiduciary\b/i],
];

/** Strip whole-line comments only — see frontend/test/_codeOnly.mjs for why. */
function codeOnly(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      out.push('');
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      out.push('');
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) { out.push(''); continue; }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * A string that is plainly not something a user reads. Log tags, SQL, and the
 * arguments of console.* are all machine text that happens to be quoted; a
 * check that flagged `[advisor] recordAnswer:` would be flagging a debug line.
 */
const NOT_COPY = [
  /^\[/,                                        // "[advisor] schema:" — a log tag
  /\b(CREATE|SELECT|INSERT|UPDATE|DELETE|ALTER)\s/i, // SQL
  /^https?:\/\//,                               // URLs
  // A className list: every token carries a hyphen, underscore or colon
  // ("advisor-row advisor-row--open"). Prose never hyphenates every word (D322).
  /^(?=\S)(?:\w+[-_:]|[-_:]\w|[-_:])[\w:-]*(?:\s+(?=\S)(?:\w+[-_:]|[-_:]\w|[-_:])[\w:-]*)*$/,
];
const isCopy = (s) => !NOT_COPY.some((re) => re.test(s));

/**
 * User-visible text in one file: quoted string literals plus JSX text nodes.
 *
 * A literal that looks like an identifier or a path — no space in it — is not
 * prose. `'advisor_explain'`, `'/advisor/advisory/clients'` and
 * `"AdvisorFilledBanner"` are all machine names; nobody reads them as a
 * sentence, and flagging them would make the check unusable.
 */
export function visibleText(src) {
  const code = codeOnly(src);
  const out = [];
  for (const m of code.matchAll(/'([^'\\\n]{4,})'|"([^"\\\n]{4,})"/g)) {
    const s = (m[1] ?? m[2]).trim();
    if (s.includes(' ') && isCopy(s)) out.push(s);
  }
  // JSX text between tags, e.g. <div>Personal Advisor</div>
  for (const m of code.matchAll(/>([^<>{}\n]{4,})</g)) {
    const s = m[1].trim();
    if (s.includes(' ') && isCopy(s)) out.push(s);
  }
  // JSX text on lines of its own. The pattern above stops at a newline, so
  //   <MessageSquare />
  //   Your advisor will guide you…
  //   </div>
  // was never read: a tag ending one line, prose filling the next, and a tag
  // or an expression opening the line after (D322). Only whole lines are
  // taken, each neither opening a tag nor an expression, so code between a
  // comparison and a later `<` does not count as text.
  for (const m of code.matchAll(/>[ \t]*\n((?:[ \t]*[^<>{}\s][^<>{}\n]*\n)+)[ \t]*[<{]/g)) {
    const s = m[1].replace(/\s+/g, ' ').trim();
    if (s.length >= 4 && s.includes(' ') && isCopy(s)) out.push(s);
  }
  return out;
}

/**
 * Prompt text in one worker file: only the strings the model is actually
 * given. Anything else in these files — log lines, error messages, SQL — is
 * not the model speaking and is none of this check's business.
 *
 * Three shapes carry a prompt in this codebase, and each is matched literally:
 * a `*_SYSTEM_PROMPT` template literal, a `systemPrompt:` value, and the
 * `content` of a `role: 'system'` message.
 */
function promptText(src) {
  const out = [];
  for (const m of src.matchAll(/(?:SYSTEM_PROMPT\s*=|systemPrompt:)\s*(`([^`]*)`|'([^'\n]*)'|"([^"\n]*)")/g)) {
    out.push((m[2] ?? m[3] ?? m[4] ?? '').trim());
  }
  for (const m of src.matchAll(/role:\s*'system'[^}]*?content:\s*(`([^`]*)`|'([^'\n]*)'|"([^"\n]*)")/g)) {
    out.push((m[2] ?? m[3] ?? m[4] ?? '').trim());
  }
  // A prompt is long; report the offending LINE, not the whole block.
  return out.flatMap((p) => p.split('\n').map((l) => l.trim()).filter((l) => l.length >= 4));
}

const key = (file, text) => `${file} :: ${text}`;

function main() {
  const baseline = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    : { onRecord: [] };
  const recorded = new Map(baseline.onRecord.map((e) => [key(e.file, e.text), e]));

  const missingFiles = [];
  const found = new Map();
  let scanned = 0;

  for (const [kind, rel, why] of SURFACES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { missingFiles.push([rel, why]); continue; }
    scanned += 1;
    const src = fs.readFileSync(abs, 'utf8');
    for (const text of kind === 'prompt' ? promptText(src) : visibleText(src)) {
      for (const [word, re] of LEXICON) {
        if (re.test(text)) { found.set(key(rel, text), { file: rel, text, word }); break; }
      }
    }
  }

  const fresh = [...found.values()].filter((f) => !recorded.has(key(f.file, f.text)));
  const stale = [...recorded.values()].filter((e) => !found.has(key(e.file, e.text)));

  const problems = [];
  if (missingFiles.length) {
    problems.push('  Listed AI surfaces that no longer exist — fix SURFACES in this script:');
    for (const [rel, why] of missingFiles) problems.push(`    - ${rel}  (was: ${why})`);
  }
  if (fresh.length) {
    problems.push('  Regulated wording in new AI copy:');
    for (const f of fresh) problems.push(`    - ${f.file}\n        "${f.text}"\n        matched: ${f.word}`);
    problems.push('');
    problems.push('  The model drafts, explains and summarises. Say that instead.');
    problems.push('  If the string is genuinely about a HUMAN advisor, record it in');
    problems.push('  scripts/regulated-wording-baseline.json with the reason.');
  }
  if (stale.length) {
    problems.push('  Baseline entries whose copy is gone — delete them so the ledger stays true:');
    for (const e of stale) problems.push(`    - ${e.file} :: "${e.text}"`);
  }

  if (problems.length) {
    console.error('✖ check-regulated-wording:');
    console.error(problems.join('\n'));
    process.exit(1);
  }

  const n = recorded.size;
  console.log(
    `✓ check-regulated-wording: ${scanned} AI surface${scanned === 1 ? '' : 's'} scanned; `
    + `${n} occurrence${n === 1 ? '' : 's'} on record and not growing.`,
  );
}

// Run only when invoked as a script; a test imports the scanner (D322).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
