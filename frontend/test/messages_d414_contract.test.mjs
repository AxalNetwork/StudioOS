/**
 * D414 — Messages, built from `design/canvases/backlog/Messages.dc.html`.
 *
 * The canvas is sliced at both ends of every section read here. Three kinds
 * of claim:
 *   1. The page draws the canvas: header, search, the seven chips with counts,
 *      rows, the thread header with role line and View profile, the context
 *      strip, grouped bubbles, the growing composer, and all three empty states.
 *   2. Who the other person is and what the thread is about come from the
 *      Worker — a privacy-filtered card and an access-checked context — and no
 *      email address reaches the page.
 *   3. The canvas's two sentences that nothing makes true are not printed; the
 *      Worker's own sentences are.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { groupMessages, threadMatches } from '../src/lib/messagesView.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = raw('design/canvases/backlog/Messages.dc.html');
const pageRaw = raw('frontend/src/pages/MessagesPage.jsx');
const viewRaw = raw('frontend/src/lib/messagesView.js');
// The page and its pure half, read as one: the helpers moved out so they can run.
const page = codeOnly(pageRaw) + '\n' + codeOnly(viewRaw);
const worker = raw('cloudflare-worker/src/routes/messages.ts');
const workerCode = codeOnly(worker);

function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

const LIST = between(CANVAS, '<!-- ============ LIST PANE ============ -->', '<!-- ============ THREAD PANE ============ -->');
const THREAD = between(CANVAS, '<!-- ============ THREAD PANE ============ -->', '</x-dc>');
const FILTERS_JS = between(CANVAS, '// ---- filters ----', '// ---- thread ----');
const HINTS_JS = between(CANVAS, 'const emptyHints = [', '];');

/* ---------------------------------------------------------------- *
 * 1 · The page draws the canvas                                     *
 * ---------------------------------------------------------------- */

test('the seven filter chips are the canvas’s, in its order, with counts', () => {
  const canvas = JSON.parse(between(FILTERS_JS, 'const FILTER_KEYS = ', ';').replace('const FILTER_KEYS = ', '').replace(/'/g, '"'));
  const ours = [...between(page, 'export const FILTERS = [', '];').matchAll(/\{ k: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ours, canvas);
  assert.ok(LIST.includes('{{ f.count }}'), 'the canvas no longer draws a count on a chip');
  assert.match(page, /\{counts\[f\.k\] \? <span/);
  // The mapping the gap map inferred: engagement and service are Engagements,
  // session is Advisory.
  assert.match(page, /\{ k: 'Engagements', types: \['engagement', 'service'\] \}/);
  assert.match(page, /\{ k: 'Advisory', types: \['session'\] \}/);
  assert.match(page, /\{ k: 'Co-founder', types: \['match'\] \}/);
  assert.match(page, /\{ k: 'Hiring', types: \['job'\] \}/);
});

test('search, chips and unread narrow the list the way their labels say', () => {
  const t = (o) => ({ unread: 0, subject_type: null, subject: null, preview: '', participants: [], ...o });
  const intro = t({ subject_type: 'introduction', unread: 2, participants: [{ name: 'Sofia', handle: 'sofia-h', headline: 'Family office' }] });
  const eng = t({ subject_type: 'service', subject: 'Brand sprint' });
  assert.equal(threadMatches(intro, 'Unread', ''), true);
  assert.equal(threadMatches(eng, 'Unread', ''), false);
  assert.equal(threadMatches(eng, 'Engagements', ''), true);
  assert.equal(threadMatches(intro, 'Engagements', ''), false);
  assert.equal(threadMatches(intro, 'All', 'family'), true, 'search reads the headline');
  assert.equal(threadMatches(eng, 'All', 'brand'), true, 'search reads the context');
  assert.equal(threadMatches(eng, 'All', 'sofia'), false);
  assert.ok(LIST.includes('placeholder="Search people or context"'));
  assert.ok(pageRaw.includes('placeholder="Search people or context"'));
});

test('bubbles group the canvas’s way: day separators, name first, avatar and time last', () => {
  const at = (h, m = 0, d = 0) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const rows = groupMessages([
    { uid: 'a', sender_user_id: 2, created_at: at(9, 0, 1) },
    { uid: 'b', sender_user_id: 2, created_at: at(9, 1, 1) },
    { uid: 'c', sender_user_id: 1, created_at: at(10, 0, 1) },
    { uid: 'd', sender_user_id: 2, created_at: at(11, 0, 0) },
  ], 1);
  assert.deepEqual(rows.map((r) => [r.uid, Boolean(r.day), r.showName, r.showAvatar, r.showTime, r.mine]), [
    ['a', true, true, false, false, false],
    ['b', false, false, true, true, false],
    ['c', false, false, false, true, true],
    ['d', true, true, true, true, false],
  ]);
  assert.equal(rows[3].day, 'Today');
  assert.equal(rows[0].day, 'Yesterday');
  // The canvas's own rule, for the record.
  assert.ok(CANVAS.includes('showAvatar: !mine && lastOfRun,') && CANVAS.includes('showName: !mine && firstOfRun,'));
});

test('the header and the three empty states are the canvas’s', () => {
  assert.ok(CANVAS.includes("unreadTotal + ' unread across ' + DATA.length + ' conversations'"));
  assert.match(page, /`\$\{list\.unread_total\} unread across \$\{threads\.length\} conversation/);
  assert.match(workerCode, /unread_total: out\.reduce\(\(a: number, t: any\) => a \+ t\.unread, 0\),/);
  for (const words of ['Nothing matches', 'clearing filters', 'Your inbox is ready', 'Select a conversation', 'One inbox, whatever the reason', 'View profile', 'New message']) {
    assert.ok(CANVAS.includes(words), `the canvas no longer says ${words}`);
    assert.ok(pageRaw.includes(words), `the page no longer says ${words}`);
  }
  // The four hint chips, by the kinds they name, without the "when" lines.
  const hints = [...HINTS_JS.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(hints, ['Introduction · via Axal VC', 'Co-founder match', 'Role search', 'Engagement']);
  assert.match(page, /\['introduction', 'match', 'job', 'engagement'\]\.map\(\(k\) => <SubjectChip key=\{k\} type=\{k\} \/>\)/);
});

test('the thread header draws the other person’s card: name, role line, View profile', () => {
  assert.ok(THREAD.includes('{{ thread.role }}') && THREAD.includes('View profile'));
  assert.match(page, /const roleLine = \(p\) => p\?\.headline \|\| \(p\?\.role \?/);
  assert.match(page, /<Link to=\{other\.profile_path\}/);
  assert.match(workerCode, /profile_path: `\/u\/\$\{row\.handle\}`,/);
  // The mobile back button.
  assert.ok(THREAD.includes('onClick="{{ backToList }}"'));
  assert.match(page, /aria-label="Back to conversations"/);
});

test('the context strip is the Worker’s resolved object, or the Worker’s reason', () => {
  assert.ok(THREAD.includes('{{ thread.objKind }}') && THREAD.includes('{{ thread.objTitle }}') && THREAD.includes('{{ thread.objCta }}'));
  const strip = between(page, 'function ContextStrip(', 'export default function MessagesPage(');
  assert.match(strip, /\{context\.kind\}/);
  assert.match(strip, /\{context\.title\}/);
  assert.match(strip, /money\(context\.amount_cents\)/);
  assert.match(strip, /<Link to=\{context\.link\.path\}/);
  assert.match(strip, /<Unrecorded reason=\{reason\} \/> — \{reason\}/);
  assert.match(page, /<ContextStrip context=\{detail\.context\} reason=\{detail\.absent\?\.context\} \/>/);
});

test('the composer is the canvas’s: paperclip, growing textarea, send, and a note', () => {
  assert.ok(THREAD.includes('title="Attach a file"') && THREAD.includes('<textarea'));
  const composer = between(page, 'function Composer(', 'function ContextStrip(');
  assert.match(composer, /aria-label="Attach a file"/);
  // D415: the paperclip works; it is disabled only with the Worker's reason.
  assert.match(composer, /title=\{attachReason \|\| 'Attach a file'\}/);
  assert.match(composer, /el\.style\.height = `\$\{Math\.min\(el\.scrollHeight, 150\)\}px`;/);
  assert.match(page, /`This thread stays attached to \$\{detail\.context\.kind\.toLowerCase\(\)\}: \$\{detail\.context\.title\}\.`/);
});

/* ---------------------------------------------------------------- *
 * 2 · The Worker decides who and what                               *
 * ---------------------------------------------------------------- */

test('no email address reaches the page', () => {
  assert.ok(!/\bemail\b/.test(codeOnly(viewRaw)), 'the page reads an email to label someone');
  assert.ok(!/\.email\b/.test(codeOnly(pageRaw)), 'the page reads a participant email');
  assert.ok(!/u\.email/.test(workerCode), 'the Worker selects an email for a card or a message');
  assert.ok(!/sender_email|sender_name/.test(workerCode));
});

test('the card uses the public profile’s own privacy rules, not a copy', () => {
  assert.match(workerCode, /import \{ effectiveFlags \} from '\.\/public';/);
  assert.match(workerCode, /name: flags\.name \? \(row\.display_name \|\| row\.name \|\| null\) : null,/);
  assert.match(workerCode, /headshot_url: flags\.headshot && row\.headshot_r2_key \?/);
  assert.match(raw('cloudflare-worker/src/routes/public.ts'), /export function effectiveFlags\(/);
  // A withheld name reads as withheld, with the Worker's reason.
  assert.match(page, /<Unrecorded reason=\{reason\}>Name not shared<\/Unrecorded>/);
});

test('the context is re-checked for the reader on every open, and pinned only to what the starter can open', () => {
  const detail = between(workerCode, "r.get('/:uid'", "r.post('/:uid/messages'");
  assert.match(detail, /await resolveContext\(c\.env, detail\?\.subject_type \?\? null, detail\?\.subject_id \?\? null, user\.id\)/);
  const eng = between(workerCode, 'engagement: async (env, id, viewerId) => {', 'const CONTEXT_UNSEEN');
  assert.match(eng, /if \(!isAdvisor && !isClient\) return null;/);
  const create = between(workerCode, "r.post('/', async", "r.get('/:uid'");
  assert.match(create, /if \(resolver && !\(await resolver\(c\.env, subjectId, user\.id\)\)\) \{/);
  // Still no admin reading, which messages_live pins too.
  assert.ok(!/isAdmin|role === 'admin'/.test(workerCode));
});

/* ---------------------------------------------------------------- *
 * 3 · What is not printed                                           *
 * ---------------------------------------------------------------- */

test('the canvas’s untrue sentence is not printed; the Worker’s is', () => {
  const phrase = 'Conversations appear here when an introduction is accepted';
  assert.ok(CANVAS.includes(phrase), `the canvas no longer says "${phrase}", so this guard is stale`);
  assert.ok(!pageRaw.includes(phrase), `the page repeats "${phrase}"`);
  assert.ok(worker.includes("auto_threads: '"), 'the Worker no longer serves absent.auto_threads');
  assert.match(page, /\{list\.absent\?\.auto_threads\}/);
  // D415 made the attachments sentence true, so it is printed now — and the
  // Worker's reason takes its place only where no storage is connected.
  assert.match(page, /\(detail\.absent\?\.attachments \|\| 'Attachments are visible to both parties only\.'\)/);
  assert.match(page, /attachReason=\{detail\.absent\?\.attachments\}/);
  // "via Axal VC" names a party to an introduction nothing records.
  assert.ok(!pageRaw.includes('via Axal VC'));
});

test('the canvas’s placeholder people do not ship', () => {
  for (const name of ['Studio Kern', 'Sofia Marchetti', 'Nadia Okonkwo', 'Daniel Rieger', 'Priya Raghavan', 'Elena Voss', 'Marcus Chen']) {
    assert.ok(CANVAS.includes(name));
    assert.ok(!pageRaw.includes(name), `${name} is a canvas placeholder`);
  }
});
