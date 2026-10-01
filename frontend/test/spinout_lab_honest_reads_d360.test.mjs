/**
 * D360 — the Spin-Out Lab's capital and legal tools say when a read failed.
 *
 * WHAT THIS IS ABOUT. Seven Lab pages caught each of their reads into an
 * empty value (`.catch(() => [])`, `.catch(() => null)`, `|| 0`), so a failed
 * read rendered as a fact: "No 83(b) tracker yet" against a statutory
 * deadline, "Not started" on every compliance item, "0" snapshots and "Never"
 * synced, a $0 soft-circled total, and — the dangerous one — an empty cap
 * table whose first Save would have overwritten the project's one canonical
 * scenario. Each read now records that it failed, and the page renders
 * `Unreadable` (or closes the write it would have enabled).
 *
 * WHY SOURCE TEXT FOR THE PAGES. The reads happen in a `useEffect`, which
 * `renderToStaticMarkup` never runs (frontend/test/README.md), so the render
 * paths are pinned by what the source says. Each assertion is bounded to the
 * block it is about, and each pins the PROPERTY — "a failed read sets a flag
 * that gates the empty state" — not a sentence. The pure helpers the pages
 * export (runway burn, entity recommendation, 83(b) scenario) are imported and
 * run for real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const P = (name) => read(`frontend/src/pages/${name}.jsx`);
const B83 = P('SpinoutLab83bPage');
const CAP = P('SpinoutLabCapTablePage');
const REV = P('SpinoutLabRevenuePage');
const CAPITAL = P('SpinoutLabCapitalPage');
const COMP = P('SpinoutLabCompliancePage');
const UOF = P('SpinoutLabUseOfFundsPage');
const INC = P('SpinoutLabIncorporatePage');
const SEVEN = { B83, CAP, REV, CAPITAL, COMP, UOF, INC };

/** Source with comments removed, so a guard cannot be satisfied by prose. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The slice from `start` to the first `end` after it. Fails loudly if gone. */
function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

test('no Lab capital/legal page catches its project list into an empty list', () => {
  for (const [name, src] of Object.entries(SEVEN)) {
    const c = code(src);
    assert.doesNotMatch(c, /listProjects\(\)\.catch\(\(\) => \[\]\)/, `${name}: a failed project read becomes "no startup record"`);
  }
});

test('no `|| 0` or `?? 0` stands in for a figure on the seven pages', () => {
  // The two shapes the honesty rule names. Counters over rows the page
  // itself holds (`(c[p.stage] || 0) + 1`) are tallies of loaded rows, not
  // figures read from a store — they are the only allowed form, and they are
  // matched exactly so nothing else can hide behind them.
  const TALLY = /\((?:c\[p\.stage\]|stageCounts\[s\]) \|\| 0\)|stageCounts\[s\] \|\| 0/g;
  for (const [name, src] of Object.entries(SEVEN)) {
    const c = code(src).replace(TALLY, '');
    const hits = c.split('\n').filter((l) => /\|\| 0\b|\?\? 0\b/.test(l));
    // Normalizing an EDITABLE input to a number the founder then sees and
    // edits is not a read figure; those lines are named here one by one so a
    // new `|| 0` on a displayed figure cannot slip in beside them.
    const allowed = hits.filter((l) => !/normalizeInputs|option_pool_pct: num\(e\.target\.value\)|num\(form\.|num\(f\?\.shares\)|num\(s\?\.amount\)|num\(r\?\.(pre_money|investment)\)|Number\(x\?\.pct\)|Number\(pcts\[i\]\)|Number\(r\) \|\| 0/.test(l));
    assert.deepEqual(allowed, [], `${name} still coerces a figure to zero:\n${allowed.join('\n')}`);
  }
});

test('83(b): a failed tracker or project read renders Unreadable, never "No 83(b) tracker yet"', () => {
  const load = between(B83, 'const load = useCallback(', '}, [user]);');
  assert.match(load, /legal83bList\([^)]*\)\.catch\(\(e\) => \{[\s\S]*?failed\.trackers = true/, 'a failed tracker read must set its flag');
  assert.match(load, /listProjects\(\)\.catch\(\(e\) => \{[\s\S]*?failed\.projects = true/, 'a failed project read must set its flag');
  assert.match(load, /setUnread\(failed\)/);
  // The empty state is only reachable once readFailed is false.
  const render = between(B83, '{readFailed ? (', 'data-testid="empty-83b"');
  assert.match(render, /<Unreadable[\s\S]*onRetry=\{load\}/, 'the failed branch must be Unreadable with a retry');
  assert.match(render, /\) : !tracker \? \(/, 'the empty state must sit BEHIND the failed branch');
  // And no scenario chip ("Not required") is derived from a failed read.
  assert.match(B83, /const scen = readFailed \? null : scenarioFor\(tracker\)/);
});

test('83(b): the tracker is created only from a typed taxpayer name and grant date', () => {
  const c = code(B83);
  assert.doesNotMatch(c, /\|\| 'Founder'/, 'the taxpayer name must not fall back to "Founder"');
  assert.match(c, /const \[grantDate, setGrantDate\] = useState\(''\)/, 'the grant date must not default to today');
  assert.doesNotMatch(c, /useState\(\(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/);
  const create = between(B83, 'const createTracker = () => act(', "}, 'create');");
  assert.match(create, /if \(!taxpayerName\.trim\(\)\) throw/);
  assert.match(create, /if \(!grantDate\) throw/);
  assert.match(create, /taxpayer_name: taxpayerName\.trim\(\)/);
  assert.match(B83, /data-testid="input-taxpayer-name"/, 'the name must be an input the founder sees');
  assert.match(B83, /disabled=\{busy \|\| !canCreate\} data-testid="button-create-tracker"/);
  assert.match(B83, /const canCreate = Boolean\(project && taxpayerName\.trim\(\) && /);
});

test('83(b): a generated election is not described as signed', () => {
  const proofs = between(B83, 'const proofs = useMemo(', ']), [tracker]);');
  assert.doesNotMatch(code(proofs), /Signed 83\(b\)/, 'nothing records a signature');
});

test('Cap Table: an unreadable scenario closes every write path', () => {
  assert.match(CAP, /setUnread\(\{ projects: false, scenario: capRes\.status === 'rejected'/);
  // canEdit gates every edit affordance and the Save button.
  assert.match(CAP, /const canEdit = !!\(user && project && !unread\.scenario && /);
  // save refuses on its own, before any request.
  const save = between(CAP, 'const save = async () => {', 'api.createCapTableScenario(');
  assert.match(save, /if \(unread\.scenario\) \{[\s\S]*?return;/);
  // No ledger/founders/SAFEs empty state renders over data the page never saw.
  assert.match(CAP, /\{!unread\.scenario && \(\n\s*<div className="grid grid-cols-1 lg:grid-cols-\[1fr_300px\]/);
  assert.match(CAP, /data-testid="captable-scenario-unreadable"/);
});

test('Cap Table: a failed tracker read badges "unreadable", not "No 83(b) tracker"', () => {
  const badges = between(CAP, '{unread.trackers ? (', 'No 83(b) tracker');
  assert.match(badges, /83\(b\) unreadable/);
  assert.match(badges, /\) : tracker \? \(/);
});

test('Revenue: KPIs built from a failed log say Unreadable, not 0 and "Never"', () => {
  const kpis = between(REV, 'const kpis = [', '];');
  assert.match(kpis, /logUnread\s*\n?\s*\? \{ key: 'snapshots'[^}]*value: LOG_UNREADABLE/);
  assert.match(kpis, /logUnread\s*\n?\s*\? \{ key: 'stripe'[^}]*value: LOG_UNREADABLE/);
  assert.match(REV, /const logUnread = Boolean\(snapshots\?\.failed\)/);
  assert.match(between(REV, '{snapshots?.failed ? (', 'data-testid="log-empty"'), /<Unreadable/);
  // A snapshot with no MRR is not a $0 bar.
  assert.match(between(REV, 'const trend = useMemo(', '}, [sorted]);'), /\.filter\(\(s\) => s\.mrr != null/);
});

test('Capital: committed is the server SUM or "Not recorded"; unsized checks are counted, not zeroed', () => {
  const c = code(CAPITAL);
  assert.match(c, /const committed = raiseAvailable && raise\.raised != null \? num\(raise\.raised\) : null;/);
  assert.doesNotMatch(c, /raised: 0, committed_count: 0/, 'an empty raise body must not become "no round, $0"');
  assert.match(c, /softProspects\.map\(checkSize\)\.filter\(\(v\) => v !== null\)/);
  assert.match(c, /\.filter\(\(p\) => checkSize\(p\) !== null && STAGE_PROBABILITY\[p\.stage\] !== undefined\)/);
  assert.match(CAPITAL, /without a check size/);
  assert.match(CAPITAL, /committed === null \? <Unrecorded/);
});

test('Compliance: a failed state or project read replaces the dashboard with Unreadable', () => {
  assert.match(COMP, /\{unread\.state \|\| unread\.projects \? \(\n\s*<div className=\{`\$\{CARD\} p-6`\} data-testid="compliance-unreadable">/);
  assert.match(COMP, /const scen = unread\.state \|\| unread\.projects \? null : scenarioFrom\(/);
  const dl = between(COMP, 'const deadlines = useMemo(', '}, [tracker, filed83b');
  assert.match(dl, /if \(unread\.tracker\) \{/, 'a failed tracker read must not say "Opens on stock transfer"');
  assert.match(dl, /out\.push\(unread\.docs \? \{/, 'a failed documents read must not say "0 documents on file"');
});

test('Incorporate: a failed orders read never offers Pay', () => {
  assert.match(INC, /\) : ordersUnread \? \(\n\s*<div className="mt-4" data-testid="orders-unreadable">/);
  assert.match(INC, /setOrdersUnread\(orders === null\)/);
  // …and a failed members read does not become "1 founder".
  assert.match(INC, /const \[memberCount, setMemberCount\] = useState\(null\)/);
});

test('Use of Funds: one Copy link, no duplicate Share, and the Axal action says it only stamps a date', () => {
  assert.doesNotMatch(UOF, /data-testid="button-share"/, 'Share was the same clipboard action as Copy link');
  assert.match(UOF, /data-testid="button-copy-link"/);
  assert.match(UOF, /setCopied\('fail'\)/, 'a refused clipboard must say so');
  assert.match(UOF, /no file is (generated|sent)/);
});

test('Use of Funds: runway divides by a RECORDED net burn, not an invented rate', async () => {
  const c = code(UOF);
  assert.doesNotMatch(c, /intensity/, 'the per-point burn rates were invented and are gone');
  assert.doesNotMatch(c, /modelBurn/);
  assert.match(c, /const burn = burnRead\.burn \? burnRead\.burn\.amount : null;/);
  const { latestRecordedBurn, runwayMonths } = await import('../src/pages/SpinoutLabUseOfFundsPage.jsx');
  // A snapshot without net_burn is not a $0 burn (num(null) is 0 on this page).
  assert.equal(latestRecordedBurn([{ snapshot_date: '2026-09-01', net_burn: null }]), null);
  assert.equal(latestRecordedBurn([]), null);
  assert.deepEqual(
    latestRecordedBurn([
      { snapshot_date: '2026-07-01', net_burn: 30000 },
      { snapshot_date: '2026-09-01', net_burn: null },
      { snapshot_date: '2026-08-01', net_burn: 40000 },
    ]),
    { amount: 40000, date: '2026-08-01' },
    'the newest snapshot that RECORDS a burn wins',
  );
  assert.equal(runwayMonths(1_000_000, null), null, 'no recorded burn → no runway figure');
  assert.equal(runwayMonths(1_000_000, 50_000), 20);
});

test('Incorporate: the entity factors never state a founder count the page could not read', () => {
  // Source, not import: the page pulls in the Stripe loader, which reads
  // import.meta.env at module load and has no value under node --test.
  const fn = between(INC, 'export function recommendEntity(', '\n}\n');
  assert.match(fn, /const founders = memberCount == null \|\| [^;]*\? null : /, 'an unread team must give founders = null');
  assert.match(fn, /founders === null \? 'Team size unreadable' : /);
  assert.doesNotMatch(code(fn), /memberCount \|\| 0/);
  // Every place that prints the count handles null.
  assert.match(INC, /rec\.founders === null \? 'team size unreadable'/);
});

test('Lab links land on Lab pages, and the arsenal copy matches what the tools do', async () => {
  for (const [name, src] of Object.entries({ REV, CAPITAL, UOF })) {
    assert.doesNotMatch(code(src), /to=["{]['"`]?\/(build\/deck|raise\/pitch|incorporate)['"`]?/, `${name} links out of the Lab`);
    assert.doesNotMatch(code(src), /to: '\/(raise\/pitch|incorporate)'/, `${name} links out of the Lab`);
  }
  const { SLIDE_META } = await import('../src/lib/pitchDeckViewModel.js');
  const arsenal = read('frontend/src/lib/spinoutLabArsenal.js');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'];
  const deck = /id: 'deck'[^\n]*blurb: '(\w+) slides/i.exec(arsenal);
  assert.ok(deck, 'the deck blurb names a slide count');
  assert.equal(WORDS.indexOf(deck[1].toLowerCase()), SLIDE_META.length, 'the deck blurb must name the real slide count');
  assert.doesNotMatch(/id: 'cap'[^\n]*/.exec(arsenal)[0], /vesting|waterfall/i, 'the Lab cap table tracks neither');
  assert.doesNotMatch(/id: 'inc'[^\n]*/.exec(arsenal)[0], /by jurisdiction/i, 'Incorporate forms a Delaware entity only');
  assert.doesNotMatch(read('frontend/src/lib/spinoutLab.js'), /archived in your data room/, 'nothing archives the 83(b) into the data room');
});
