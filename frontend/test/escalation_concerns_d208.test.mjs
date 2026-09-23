/**
 * D208 — a content escalation names what it concerns, and both ends draw the
 * branch's label exactly as the worker built it.
 *
 * What this file pins, rendered wherever the piece is pure:
 *
 *  - THE DRAWER OFFERS WHAT THE WORKER LISTED, and only a list it could read.
 *    Five states; only `ready` draws a control, and every other state is a
 *    sentence — a list the page could not read, or one with nothing in it, is
 *    not something to choose from.
 *  - THE OPTION TEXT IS THE WORKER'S LABEL. The labels here are built by the
 *    worker's own `concernLabel`, and the rendered options must equal them
 *    character for character: the SPA has no second label format, and a scan
 *    of `frontend/src` keeps it that way.
 *  - A PICK IS SENT ONLY FOR CONTENT, ONLY WHILE IT IS LISTED, AND NEVER WITH A
 *    LABEL. The route reads the row again, so a label from the client would be
 *    a second source of the same words.
 *  - HQ'S LANE ROW STATES AN ABSENT LABEL rather than drawing a blank "About",
 *    and the Localised count stays unrecorded for the narrower reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import { concernsOffered, concernToSend, ConcernsPicker } from '../src/pages/branch/BranchApprovals.jsx';
import { LocalisationRow } from '../src/pages/hq/ContentPage.jsx';
import {
  CONCERN_TYPES, concernLabel,
} from '../../cloudflare-worker/src/services/escalationConcerns.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APPROVALS = codeOnly(read('frontend/src/pages/branch/BranchApprovals.jsx'));
const CONTENT_PAGE = read('frontend/src/pages/hq/ContentPage.jsx');
const CONTENT_CODE = codeOnly(CONTENT_PAGE);
const ADMIN_CONTENT = read('cloudflare-worker/src/routes/admin_content.ts');

const NOTE = 'HQ receives the name this branch gives the item, not a link to it: the item lives in this '
  + 'branch\'s database, which HQ cannot open.';

/** Items built by the WORKER's label function, so the SPA is tested against the real format. */
const T_LICENCE = { type: 'template', id: 'licence-agreement',
  label: concernLabel('template', { title: 'Licence agreement', slug: 'licence-agreement', version: 4 }) };
const T_SERVICE = { type: 'template', id: 'service-agreement',
  label: concernLabel('template', { title: 'Service agreement', slug: 'service-agreement', version: 2 }) };
const A_LETTER = { type: 'article', id: 11,
  label: concernLabel('article', { title: 'Founders\' letter & Q3 notes', slug: 'founders-letter' }) };
const A_LAUNCH = { type: 'article', id: 7,
  label: concernLabel('article', { title: 'Launch post', slug: 'launch-post' }) };

const READABLE = [
  { type: 'template', available: true, listed: 2, truncated: false },
  { type: 'article', available: true, listed: 2, truncated: false },
];

/** A lane payload carrying a concerns block. */
const laneWith = (concerns) => ({ available: true, items: [], concerns });
const block = (items, sources = READABLE, extra = {}) =>
  ({ available: true, items, sources, truncated: false, cap: 100, note: NOTE, ...extra });

const noop = () => {};
const render = (offered, value = '') =>
  renderToStaticMarkup(createElement(ConcernsPicker, { offered, value, onChoose: noop }));

/** Each `<option>` as [value, text], text decoded the way a reader sees it. */
function options(html) {
  return [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, text]) => {
    const value = (attrs.match(/value="([^"]*)"/) || [])[1];
    return { value, text: renderedText(text), selected: /\bselected=""/.test(attrs) };
  });
}

/* ------------------------------------------------------------------ *
 * 1 · What the drawer can offer                                       *
 * ------------------------------------------------------------------ */

test('loading and a failed read offer nothing and draw no control', () => {
  for (const lane of [null, undefined]) assert.equal(concernsOffered(lane).state, 'loading');
  // The page's own failed-read marker is a Symbol (`UNAVAILABLE`); any
  // non-object lane is a read that did not answer.
  assert.match(APPROVALS, /const UNAVAILABLE = Symbol\(/);
  assert.equal(concernsOffered(Symbol('unavailable')).state, 'unreadable');
  for (const lane of [null, Symbol('x')]) {
    const html = render(concernsOffered(lane));
    assert.ok(!/<select|<option|<input/.test(html), 'a control was drawn over a list nobody read');
    assert.match(html, /data-testid="branch-escalate-concern-state"/);
  }
  assert.match(renderedText(render(concernsOffered(null))), /Loading the items this branch can name/);
  assert.match(renderedText(render(concernsOffered(Symbol('x')))),
    /could not be read, so none can be picked\. The escalation can still be raised without one\./);
});

test('a lane older than D208, or a malformed block, says the list was not sent', () => {
  for (const lane of [
    { available: true, items: [] },
    laneWith(null), laneWith('x'), laneWith({ items: 'x', sources: [] }), laneWith({ items: [] }),
  ]) {
    const o = concernsOffered(lane);
    assert.equal(o.state, 'unavailable', JSON.stringify(lane));
    assert.match(o.reason, /did not send the items a content escalation can name/);
    assert.deepEqual(o.items, []);
  }
});

test('a block the worker could not read carries the worker’s own reason', () => {
  const reason = 'Neither HQ\'s template library nor this branch\'s articles could be read, so no item can be named. '
    + 'A content escalation can still be raised without one.';
  const o = concernsOffered(laneWith({
    available: false, reason, items: [], truncated: false, cap: 100, note: NOTE,
    sources: [{ type: 'template', available: false, reason: 'a' }, { type: 'article', available: false, reason: 'b' }],
  }));
  assert.equal(o.state, 'unavailable');
  assert.equal(o.reason, reason);
  const html = render(o);
  assert.ok(!/<select/.test(html));
  assert.equal(renderedText(html).includes(reason), true, 'the worker’s reason was not drawn');
});

test('ready: the items grouped in the worker’s source order, whatever order they arrived in', () => {
  const o = concernsOffered(laneWith(block([A_LETTER, T_SERVICE, A_LAUNCH, T_LICENCE])));
  assert.equal(o.state, 'ready');
  assert.deepEqual(o.groups.map((g) => g.type), [...CONCERN_TYPES],
    'the drawer groups the sources in a different order from the worker');
  assert.deepEqual(o.groups.map((g) => g.heading), ['HQ templates', 'Articles on this branch']);
  assert.deepEqual(o.groups[1].items.map((i) => i.id), [11, 7]);
  assert.equal(o.note, NOTE);
  assert.equal(o.cap, 100);
});

test('the SPA knows every kind of item the worker can list', () => {
  // One labelled item per worker type: each must survive the filter and land in
  // a group, or a source the worker adds would vanish from the drawer in silence.
  const items = CONCERN_TYPES.map((type, i) => ({ type, id: type === 'article' ? i + 1 : `slug-${i}`,
    label: concernLabel(type, { title: `Item ${i}`, slug: `slug-${i}`, version: 1 }) }));
  const o = concernsOffered(laneWith(block(items)));
  assert.deepEqual(o.items.map((i) => i.type), [...CONCERN_TYPES]);
  assert.deepEqual(o.groups.map((g) => g.type), [...CONCERN_TYPES]);
});

test('an item the drawer cannot draw is dropped, never drawn blank', () => {
  const o = concernsOffered(laneWith(block([
    T_LICENCE,
    { type: 'publication', id: 1, label: 'Publication · Digest' },
    { type: 'template', id: '', label: 'no id' },
    { type: 'template', id: 'x', label: '   ' },
    { type: 'article', id: 3 },
    null,
  ])));
  assert.deepEqual(o.items, [T_LICENCE]);
});

test('empty is measured, and a source that could not be read says so beside it', () => {
  const both = concernsOffered(laneWith(block([])));
  assert.equal(both.state, 'empty');
  assert.deepEqual(both.none, ['no HQ templates', 'no articles']);
  assert.match(renderedText(render(both)),
    /Nothing on this branch can be named: no HQ templates and no articles\. The escalation is raised without one\./);

  const reason = 'HQ\'s template library could not be read on this branch (branch_templates, migration 268), '
    + 'so no template can be named.';
  const gap = concernsOffered(laneWith(block([], [
    { type: 'template', available: false, reason },
    { type: 'article', available: true, listed: 0, truncated: false },
  ])));
  assert.equal(gap.state, 'empty');
  assert.deepEqual(gap.none, ['no articles'], 'an unreadable library was counted as an empty one');
  assert.deepEqual(gap.gaps, [{ type: 'template', heading: 'HQ templates', reason }]);
  const html = render(gap);
  assert.ok(!/<select/.test(html));
  assert.match(html, /data-testid="branch-escalate-concern-gap-template"/);
  assert.equal(renderedText(html).includes(`HQ templates: ${reason}`), true);
});

/* ------------------------------------------------------------------ *
 * 2 · The control                                                     *
 * ------------------------------------------------------------------ */

test('ready draws one labelled select whose options are the worker’s labels, character for character', () => {
  const html = render(concernsOffered(laneWith(block([T_LICENCE, T_SERVICE, A_LETTER]))));
  assert.equal((html.match(/<select\b/g) || []).length, 1);
  assert.match(html, /<label[^>]*for="branch-escalate-concern"[^>]*>Which item is this about\? \(optional\)<\/label>/);
  assert.match(html, /<select[^>]*id="branch-escalate-concern"/);
  const opts = options(html);
  assert.deepEqual(opts[0], { value: '', text: 'No item — this is about something else', selected: true },
    'the first choice is not "no item", or it is not the default');
  assert.deepEqual(opts.slice(1).map((o) => o.text), [T_LICENCE.label, T_SERVICE.label, A_LETTER.label],
    'an option drew something other than the label the worker built');
  assert.deepEqual(opts.slice(1).map((o) => o.value),
    ['template:licence-agreement', 'template:service-agreement', 'article:11']);
  assert.deepEqual([...html.matchAll(/<optgroup label="([^"]*)"/g)].map((m) => m[1]),
    ['HQ templates', 'Articles on this branch']);
  assert.match(html, /data-testid="branch-escalate-concern-note"/);
  assert.equal(renderedText(html).includes(NOTE), true);
});

test('a held pick is shown only while it is still listed', () => {
  const offered = concernsOffered(laneWith(block([T_LICENCE, A_LAUNCH])));
  const held = options(render(offered, 'article:7'));
  assert.deepEqual(held.filter((o) => o.selected).map((o) => o.value), ['article:7']);
  const stale = options(render(offered, 'template:withdrawn'));
  assert.deepEqual(stale.filter((o) => o.selected).map((o) => o.value), [''],
    'a pick the list no longer holds was drawn as chosen');
});

test('a cut list says so, with the worker’s cap', () => {
  const html = render(concernsOffered(laneWith(block([A_LAUNCH], READABLE, { truncated: true }))));
  assert.match(html, /data-testid="branch-escalate-concern-truncated"/);
  assert.match(renderedText(html), /Only the 100 most recent articles are listed\. To name an older one, say which in the subject\./);
  assert.ok(!/branch-escalate-concern-truncated/.test(render(concernsOffered(laneWith(block([A_LAUNCH]))))));
});

/* ------------------------------------------------------------------ *
 * 3 · What a raise sends                                              *
 * ------------------------------------------------------------------ */

test('a pick is sent for content only, only while listed, and never with a label', () => {
  const ready = concernsOffered(laneWith(block([T_LICENCE, A_LAUNCH])));
  const sent = concernToSend('content', ready, 'article:7');
  assert.deepEqual(sent, { type: 'article', id: 7 });
  assert.deepEqual(Object.keys(sent), ['type', 'id'], 'the client sent a label the route would have to ignore');
  assert.deepEqual(concernToSend('content', ready, 'template:licence-agreement'),
    { type: 'template', id: 'licence-agreement' });

  // A pick held from before a switch of kind is not sent: the route refuses
  // `concerns` on every kind but content.
  for (const kind of ['other', 'moderation', 'seat_increase', null]) {
    assert.equal(concernToSend(kind, ready, 'article:7'), undefined, `${kind} sent a pick`);
  }
  assert.equal(concernToSend('content', ready, ''), undefined);
  assert.equal(concernToSend('content', ready, 'template:withdrawn'), undefined);
  for (const lane of [null, Symbol('x'), laneWith(block([]))]) {
    assert.equal(concernToSend('content', concernsOffered(lane), 'article:7'), undefined);
  }
});

test('the form: the picker is drawn for content only, and the pick rides the one raise call', () => {
  const at = APPROVALS.indexOf('<ConcernsPicker');
  assert.ok(at > 0, 'the picker is not mounted');
  assert.match(APPROVALS.slice(at - 60, at), /\{chosen === 'content' && \($/m,
    'the picker is drawn for a kind that cannot name an item');
  const call = APPROVALS.indexOf('api.branchEscalate({ kind: chosen,');
  assert.ok(call > 0);
  const callEnd = APPROVALS.indexOf('});', call);
  assert.match(APPROVALS.slice(call, callEnd), /concerns: concernToSend\(chosen, concerns, concern\)/,
    'the raise sends the held pick rather than the one on screen');
  const ok = APPROVALS.slice(callEnd, APPROVALS.indexOf('} catch (err)', callEnd));
  assert.match(ok, /setConcern\(''\)/, 'a raised pick survives into the next raise');
});

test('each raised escalation says what it was about, in the words HQ received', () => {
  const at = APPROVALS.indexOf('data-testid="branch-escalation-about"');
  assert.ok(at > 0, 'the lane rows do not show what an escalation concerns');
  assert.match(APPROVALS.slice(at - 200, at), /\{it\.subject_ref && \(/,
    'an escalation with no label draws an empty "About"');
  assert.match(APPROVALS.slice(at, at + 200), /About <span className="font-mono">\{it\.subject_ref\}<\/span>/);
});

test('the SPA builds no label of its own — one format, the worker’s', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8');
        for (const head of ['HQ template ·', 'Article ·']) if (src.includes(head)) hits.push(`${p}: ${head}`);
        if (src.includes('concernLabel')) hits.push(`${p}: concernLabel`);
      }
    }
  };
  walk(resolve(root, 'frontend/src'));
  assert.deepEqual(hits, [], 'a second label format exists in the SPA');
});

/* ------------------------------------------------------------------ *
 * 4 · HQ's lane                                                       *
 * ------------------------------------------------------------------ */

test('HQ’s lane row renders the label as it came', () => {
  const html = renderToStaticMarkup(createElement(LocalisationRow, { subjectRef: `  ${A_LETTER.label} ` }));
  assert.match(html, /data-testid="hq-localisation-about"/);
  assert.match(html, /<span class="font-mono">/);
  assert.equal(renderedText(html), `About ${A_LETTER.label}`);
});

test('a row with no label states its absence — never a blank "About"', () => {
  for (const subjectRef of [null, undefined, '', '   ', 42, {}]) {
    const html = renderToStaticMarkup(createElement(LocalisationRow, { subjectRef }));
    assert.match(html, /data-testid="hq-localisation-unnamed"/, `${JSON.stringify(subjectRef)} was drawn as a label`);
    assert.ok(!/About/.test(html), `${JSON.stringify(subjectRef)} drew an empty "About"`);
    assert.equal(renderedText(html),
      'Not recorded — No item named: raised without one, or before a submission carried its label.');
  }
});

test('the lane mounts the row on every item, and says a label is not a link', () => {
  const lane = CONTENT_CODE.indexOf('data-testid="hq-localisation-lane"');
  const laneEnd = CONTENT_CODE.indexOf('</ul>', lane);
  assert.ok(lane > 0 && laneEnd > lane);
  assert.match(CONTENT_CODE.slice(lane, laneEnd), /<LocalisationRow subjectRef=\{it\.subject_ref\} \/>/);
  const note = CONTENT_CODE.indexOf('data-testid="hq-localisation-label-note"');
  assert.ok(note > laneEnd, 'the label note is missing, or sits inside the list');
  assert.match(CONTENT_CODE.slice(note, note + 300), /a label, not a link/);
});

test('Localised stays unrecorded, for the narrower reason, on the page, the rail and the route', () => {
  const stat = CONTENT_CODE.indexOf('<Stat label="Localised"');
  assert.ok(stat > 0);
  const tag = CONTENT_CODE.slice(stat, CONTENT_CODE.indexOf('/>', stat));
  assert.match(tag, /value=\{null\}/);
  assert.match(tag, /note="naming an item does not record a localisation"/);
  assert.match(CONTENT_PAGE,
    /\['Localisation link', 'A submission can name the item it concerns, as its branch labels it\. Nothing records whether it localises that item or asks for a change to it, so a count of localised items would still be a count of submissions\.'\]/);

  // The route's reason, with its string wraps mended the way the H6 test mends them.
  const joined = ADMIN_CONTENT.replace(/'\s*\n\s*\+ '/g, '');
  for (const phrase of [
    'can name the item it concerns',
    'a label the branch builds, not a link HQ can open',
    'localisation of another',
    'a count of submissions wearing the wrong name.',
  ]) assert.ok(joined.includes(phrase), `localisation_reason no longer says: ${phrase}`);
  assert.match(ADMIN_CONTENT, /NARROWED IN D112, NOT DELETED/);
  assert.match(ADMIN_CONTENT, /NARROWED AGAIN IN D208/);
  assert.match(codeOnly(ADMIN_CONTENT), /localisation_available: false,/);
});
