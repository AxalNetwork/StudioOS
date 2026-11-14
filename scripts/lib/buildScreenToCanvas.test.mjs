// #6326: the build checklist read from a landed canvas's boards file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sizeOf, splitArgs, literal, helpersOf, frameOf, boardsDetail, readBoards, coverage,
  checklistTable, departuresTable, boardsFileFor, pageFileFor, rowNamesCanvas,
} from './buildScreenToCanvas.mjs';

// The template most canvases landed since November use (Build v2, Platform States).
const TEMPLATE = `<script type="text/x-dc" data-dc-script>
class Component extends DCLogic {
  renderVals() {
    const D = (b, lab, w, h, r, hh) => ({ b, lab: lab || false, hint: '100%,' + (h || hh || 900) + 'px', box: 'width:' + (w || 1440) + 'px;' });
    const F = (b, lab, h) => D(b, lab, 1440, h || 900);
    const P = (b, lab) => D(b, lab, 390, 844, 28);
    const C = (b, lab, w, hh) => D(b, lab, w, 0, 12, hh);
    const W = (b, lab) => D(b, lab, 1200, 0, 12, 700);
    const boards = [
      ['BD-0', 'Audit', 'The findings, [ranked].', [W('BU00')]],
      ['BD1', 'Overview · desktop', 'One next action owns the page, it\\'s the only primary.', [F('BU01', false, 1100)]],
      ['BD2', 'Overview · phone', 'Tabs, then the next action at 48px.', [P('BU02', false)]],
      ['BD14', 'States, tablet and dark', 'Loading, Unavailable (with Try again).', [F('BU14a', 'A · Loading'), C('BU14t', 'B · Tablet', 768, 900), F('BU14d', 'C · Dark')]],
      ['BD24', 'Phone · empty', 'Two phones.', [P('BU24a', 'A · Empty module'), P('BU24b', 'B · Company not linked')]],
    ];
    return { boards };
  }
}
</script>`;

// The grouped shape (Ask Panel, Influencer): a row helper and a frame helper with a `w` parameter.
const GROUPS = `renderVals() {
    const F = (v, cap, w, h) => { const d = /-d$/.test(v); return { v, cap: cap || '', wst: \`width:\${w}px;\` }; };
    const G = (id, t, fr, note) => ({ id, t, fr, note: note || '' });
    return { groups: [
      G('AK1', 'The Ask button', [F('k0', '', 1440, 400)], 'Beside the page’s primary.'),
      G('AK9', 'Studio', [F('k8', 'Studio keeps its own chat', 1440, 900), F('k8-d', '', 1440, 900)]),
      G('AK12', 'Phone', [F('k11', '', 390, 844)]),
    ] };
  }`;

test('sizeOf: 390 is a phone, 768 a tablet, 1200 and 1440 desktops', () => {
  assert.equal(sizeOf(390), 'phone');
  assert.equal(sizeOf(480), 'phone');
  assert.equal(sizeOf(768), 'tablet');
  assert.equal(sizeOf(1200), 'desktop');
  assert.equal(sizeOf(1440), 'desktop');
  assert.equal(sizeOf(NaN), 'unknown');
});

test('splitArgs splits at top-level commas only, keeping strings and brackets whole', () => {
  assert.deepEqual(splitArgs(`'a, b', [1, 2], f(x, y), 'it\\'s'`), [`'a, b'`, '[1, 2]', 'f(x, y)', `'it\\'s'`]);
});

test('literal reads a quoted string and nothing else', () => {
  assert.equal(literal(`'A · Loading'`), 'A · Loading');
  assert.equal(literal(`'it\\'s'`), "it's");
  assert.equal(literal('false'), null);
  assert.equal(literal(undefined), null);
});

test('helpersOf follows each helper to its width: fixed, from a parameter, or composed', () => {
  const h = helpersOf(TEMPLATE);
  assert.deepEqual(h.D.width, { param: 2, fallback: 1440 });
  assert.deepEqual(h.F.width, { value: 1440 });
  assert.deepEqual(h.P.width, { value: 390 });
  assert.deepEqual(h.C.width, { param: 2, fallback: 1440 });
  assert.deepEqual(h.W.width, { value: 1200 });
  const g = helpersOf(GROUPS);
  assert.deepEqual(g.F.width, { param: 2, fallback: NaN });
  assert.equal(g.G.width, null, 'a row helper draws no frame');
});

test('helpersOf reads a literal width when a helper has no width parameter (Builder)', () => {
  const h = helpersOf(`const D = (v, cap, h) => ({ v, hs: '1440px,' + h + 'px', wst: 'width:1440px;min-height:' + h + 'px' });
const M = (v, cap) => ({ v, cap, hs: '390px,844px', wst: 'width:390px;height:844px' });
const B = (id, t, frames, notes) => ({ id, t, frames });`);
  assert.deepEqual(h.D.width, { value: 1440 });
  assert.deepEqual(h.M.width, { value: 390 });
  assert.equal(h.B.width, null);
});

test('frameOf gives key, label, width and size; a non-frame call gives null', () => {
  const h = helpersOf(TEMPLATE);
  assert.deepEqual(frameOf(`C('BU14t', 'B · Tablet', 768, 900)`, h), { key: 'BU14t', label: 'B · Tablet', width: 768, size: 'tablet' });
  assert.deepEqual(frameOf(`P('BU02', false)`, h), { key: 'BU02', label: null, width: 390, size: 'phone' });
  assert.equal(frameOf(`Q('X')`, h), null);
});

test('boardsDetail reads the template: ids, titles, captions, frames, phone and dark', () => {
  const b = boardsDetail(TEMPLATE);
  assert.deepEqual(b.map((x) => x.id), ['BD-0', 'BD1', 'BD2', 'BD14', 'BD24']);
  assert.equal(b[1].caption, "One next action owns the page, it's the only primary.");
  assert.equal(b[0].frames[0].width, 1200);
  assert.equal(b[2].phone, true);
  assert.equal(b[1].phone, false);
  assert.equal(b[3].tablet, true);
  assert.equal(b[3].dark, true);
  assert.equal(b[1].dark, false);
  assert.deepEqual(b[4].frames.map((f) => f.label), ['A · Empty module', 'B · Company not linked']);
});

test('boardsDetail reads the grouped shape, and a -d frame key is dark', () => {
  const b = boardsDetail(GROUPS);
  assert.deepEqual(b.map((x) => x.id), ['AK1', 'AK9', 'AK12']);
  assert.equal(b[0].caption, 'Beside the page’s primary.');
  assert.equal(b[1].dark, true);
  assert.equal(b[2].phone, true);
  assert.equal(b[0].phone, false);
});

test('boardsDetail reads literal dc-import tags, one board per tag', () => {
  const b = boardsDetail(`<dc-import name="AI Tokens Page" board="TOKB1" hint-size="1440px,1750px"></dc-import>
<dc-import name="AI Tokens Page" board="TOKB11a" hint-size="390px,844px"></dc-import>
<dc-import name="X" board="{{ f.b }}" hint-size="100%,900px"></dc-import>`);
  assert.deepEqual(b.map((x) => [x.id, x.frames[0].size]), [['TOKB1', 'desktop'], ['TOKB11a', 'phone']]);
});

// Raise evidence: static tags whose phone strip is 1294 wide and whose dark board says so only in its section.
const SECTIONS = `<section id="states"><div><h2 style="x">Empty, loading, errors and access</h2></div>
  <dc-import name="Raise Evidence Page" board="VR16" hint-size="1440px,660px"></dc-import></section>
<section id="phone"><div><h2 style="x">Phone</h2></div>
  <dc-import name="Raise Evidence Page" board="VR17" hint-size="1294px,970px"></dc-import></section>
<section id="dark"><div><h2>Dark</h2></div>
  <dc-import name="Raise Evidence Page" board="VR19" hint-size="1440px,2500px"></dc-import></section>`;

test('static boards take phone and dark from their section, and coverage claims nothing missing', () => {
  const { source, boards } = readBoards(SECTIONS);
  assert.equal(source, 'static');
  assert.deepEqual(boards.map((b) => [b.id, b.phone, b.dark]), [['VR16', false, false], ['VR17', true, false], ['VR19', false, true]]);
  assert.equal(boards[1].section, 'phone · Phone');
  const noSections = coverage(readBoards(SECTIONS.replace(/<section[^>]*>|<h2[^>]*>[^<]*<\/h2>/g, '')).boards, 'static');
  assert.deepEqual(noSections.missing, [], 'a static file never gets a no-phone or no-dark claim');
  assert.match(noSections.unsure, /dc-import/);
});

// Learning Stream and Raise Overview: `return { boards: [ B(...) ] }`, with the template's placeholder tag above it.
const RETURNED = `<dc-import name="Learning Stream Page" v="lr1" hint-size="1440px,1380px">
<dc-import name="Learning Stream Page" v="{{ f.v }}" hint-size="{{ f.hs }}">
<script>renderVals() {
    const W = { ph1: 390, tab: 768, ro02: 788 };
    const F = (v, cap) => { const d = /-d$/.test(v); const k = v.replace(/-d$/, ''); const w = W[k] || 1440; return { v, cap: cap || '', wst: \`width:\${w}px;\` }; };
    const B = (id, t, fr, row, note) => ({ id, cap: id + ' · ' + t, fr, note: note || '', fs: row ? 'display:flex;max-width:1720px' : 'display:flex' });
    return { boards: [
      B('RO02', 'Figure tiles', [F('ro02')], 0, 'A sample feature called Dark mode.'),
      B('RO16', 'Phone, 390', [F('ph1', 'Mid-raise')], 1),
      B('RO17', 'Tablet, 768', [F('tab')]),
      B('RO18', 'Dark', [F('ro00-d', 'RO00')])
    ] };
  }</script>`;

test('readBoards reads a returned boards list, widths from a lookup table, never the placeholder tag', () => {
  const { source, boards } = readBoards(RETURNED);
  assert.equal(source, 'list');
  assert.deepEqual(boards.map((b) => [b.id, b.frames.map((f) => f.width).join()]), [['RO02', '788'], ['RO16', '390'], ['RO17', '768'], ['RO18', '1440']]);
  assert.deepEqual(boards.map((b) => [b.phone, b.tablet, b.dark]), [[false, true, false], [true, false, false], [false, true, false], [false, false, true]]);
  assert.equal(helpersOf(RETURNED).B.width, null, 'max-width in a row helper is not a frame width');
});

test('a caption that mentions dark does not make a board dark', () => {
  const [b] = boardsDetail(RETURNED);
  assert.match(b.caption, /Dark mode/);
  assert.equal(b.dark, false);
});

test('readBoards gives [] for a shape it cannot read, never a guess', () => {
  assert.deepEqual(boardsDetail('<x-dc></x-dc><script>renderVals() { return {}; }</script>'), []);
  assert.deepEqual(boardsDetail('const boards = [ [\'A\', \'unterminated'), []);
  const odd = readBoards(`<dc-import name="X Page" v="x1" hint-size="1440px,900px">
<script>renderVals() { return { boards: [ { id: 'B1', title: 'Usage', screen: 'usage' } ] }; }</script>`);
  assert.deepEqual(odd, { source: 'unread', boards: [] }, 'a list it cannot follow is not replaced by the placeholder tag');
});

test('coverage claims nothing missing when a board has no frames read', () => {
  const b = boardsDetail(`renderVals() {
    const G = (t, s, a) => ({ t, s, ids: [a] });
    return { groups: [G('Pre-seed', 'TPL-01 to TPL-06', 1), G('Seed', 'TPL-07 to TPL-12', 7)] };
  }`);
  assert.equal(b.length, 2);
  const c = coverage(b, 'list');
  assert.deepEqual(c.missing, []);
  assert.match(c.unsure, /no frame read for Pre-seed, Seed/);
});

test('coverage names the phone, tablet and dark boards, and what the canvas does not draw', () => {
  const c = coverage(boardsDetail(TEMPLATE));
  assert.deepEqual(c.phone, ['BD2', 'BD24']);
  assert.deepEqual(c.tablet, ['BD14']);
  assert.deepEqual(c.dark, ['BD14']);
  assert.deepEqual(c.missing, []);
  const desktopOnly = coverage(boardsDetail(TEMPLATE.replace(/P\('BU02', false\)/, "F('BU02', false)").replace(/P\('BU24a'[^)]*\), P\('BU24b'[^)]*\)/, "F('BU24a')").replace(/, F\('BU14d', 'C · Dark'\)/, '').replace('States, tablet and dark', 'States')));
  assert.equal(desktopOnly.phone.length, 0);
  assert.equal(desktopOnly.dark.length, 0);
  assert.equal(desktopOnly.missing.length, 2);
  assert.match(desktopOnly.missing[0], /390 phone/);
  assert.match(desktopOnly.missing[1], /dark/);
});

test('checklistTable and departuresTable: one row per board, pipes escaped', () => {
  const b = boardsDetail(TEMPLATE);
  const t = checklistTable(b).split('\n');
  assert.equal(t.length, 2 + b.length);
  assert.match(t[4], /^\| BD2 \| Overview · phone \| BU02 · 390 \| yes \| — \|$/);
  const d = departuresTable([{ id: 'X1', title: 'A | B', frames: [] }]).split('\n');
  assert.equal(d[0], '| Board | Built in | Departs from the canvas | Why |');
  assert.equal(d[2], '| X1 A \\| B |  |  |  |');
});

test('boardsFileFor and pageFileFor match the landed names without case', () => {
  const files = ['AI Tokens Page.dc.html', 'AI tokens · Boards.dc.html', 'Build v2 Page.dc.html', 'Build v2 · Boards.dc.html'];
  assert.equal(boardsFileFor('AI Tokens', files), 'AI tokens · Boards.dc.html');
  assert.equal(boardsFileFor('Build v3', files), null);
  assert.equal(pageFileFor('AI tokens · Boards.dc.html', files), 'AI Tokens Page.dc.html');
  assert.equal(pageFileFor('Missing · Boards.dc.html', files), null);
});

test('rowNamesCanvas matches the first cell without case or qualifier, or a named file', () => {
  assert.equal(rowNamesCanvas('| Skill library v2 (HQ and Team) | admin | … |', 'Skill Library v2'), true);
  assert.equal(rowNamesCanvas('| Platform States (shared) | every role |', 'Platform States'), true);
  assert.equal(rowNamesCanvas('| Platform v2 | admin |', 'Platform States'), false);
  assert.equal(rowNamesCanvas('| Pages · Fund dossier | founder | uses `Build v2 Page.dc.html` |', 'Build v2', ['Build v2 Page.dc.html']), true);
  assert.equal(rowNamesCanvas('no table here', 'Build v2'), false);
});

test('rowNamesCanvas reads a row titled <Name> Page or <Name> · Boards', () => {
  assert.equal(rowNamesCanvas('| Pitch Deck Studio v2 Page | founder |', 'Pitch Deck Studio v2'), true);
  assert.equal(rowNamesCanvas('| Pitch Deck Studio v2 · Boards | founder |', 'Pitch Deck Studio v2'), true);
  assert.equal(rowNamesCanvas('| Zone Headers Page (shared) | every role |', 'Zone Headers'), true);
  assert.equal(rowNamesCanvas('| Pitch Deck Studio Page | founder |', 'Pitch Deck Studio v2'), false);
  assert.equal(rowNamesCanvas('| Fund administration | admin |', 'Fund admin'), false, 'other wording is left to the grep');
});
