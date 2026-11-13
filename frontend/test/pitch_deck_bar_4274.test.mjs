// #4274 (D4254 P1 slice 2): the deck bar in the editor (psE, psES, psEA) and the
// Overview's Recent investor activity (ps1, D1568).
//   * the bar replaces the crumb: ‹ Pitch to the Overview, the deck's h1, the
//     section menu of the five tiles, Edit / Comment, then the D1604 tools and Ask;
//   * Comment opens the selected card's comments and Edit closes them;
//   * `investorActivity` keeps only links someone opened, newest first, with
//     D1568's words, and says `null` when the read gave no list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountEditor, ADMIN } from './_pitch_editor_mount.mjs';
import { ACTIVITY_ROWS, investorActivity } from '../src/pages/raise/pitch/pitchOverviewModel.js';
import { TABS } from '../src/pages/raise/pitch/pitchStudioModel.js';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const link = (id, over = {}) => ({
  id, investor: { label: `Person ${id}`, fund: `Fund ${id}`, prospect_id: 100 + id },
  nda: { state: 'not_required', accepted_at: null }, analytics: { views: 0, last_viewed_at: null }, signals: [], ...over,
});

test('investorActivity: opened links only, newest event first, D1568 words, capped', () => {
  const read = {
    links: [
      link(1), // never opened: not activity
      link(2, { analytics: { views: 2, last_viewed_at: '2026-11-01 09:00:00' } }),
      link(3, { signals: [{ kind: 'first_view', at: '2026-10-30 08:00:00', words: 'Opened' }, { kind: 'revisit', at: '2026-11-02 10:00:00', words: 'Revisited after 48 h' }] }),
      link(4, { nda: { state: 'accepted', accepted_at: '2026-10-31 12:00:00' }, investor: { label: null, fund: null, prospect_id: null } }),
    ],
  };
  const rows = investorActivity(read);
  assert.deepEqual(rows.map((r) => r.id), [3, 2, 4]);
  assert.equal(rows[0].line, 'Revisited after 48 h', 'the newest signal, not the first');
  assert.equal(rows[1].line, 'Opened the deck');
  assert.equal(rows[2].line, 'Accepted the NDA');
  assert.equal(rows[2].prospectId, null, 'no prospect behind the link: no draft');
  assert.equal(rows[0].prospectId, 103);
  assert.equal(rows[0].initials, 'P3');
  assert.equal(investorActivity({ links: [link(1)] }).length, 0, 'nobody opened anything: an empty list, not null');
  assert.equal(investorActivity(null), null, 'no list read: null, never "no activity"');
  const many = { links: Array.from({ length: 9 }, (_, i) => link(i + 1, { analytics: { views: 1, last_viewed_at: `2026-11-0${i + 1} 09:00:00` } })) };
  assert.equal(investorActivity(many).length, ACTIVITY_ROWS);
  assert.equal(investorActivity(many)[0].id, 9);
});

test('the Overview draws Recent investor activity from the investor-links read, with a draft only for a prospect', () => {
  const s = src('pages/raise/pitch/PitchOverview.jsx');
  assert.match(s, /const listLinks = \(id\) => deckInvestorLinksApi\.investorLinks\(id\);/);
  assert.match(s, /<InvestorActivity read=\{links\} q=\{q\} projectId=\{projectId\} readOnly=\{readOnly\} \/>/);
  assert.match(s, /!readOnly && r\.prospectId != null && projectId != null \?/, 'a reader, or a link with no prospect, gets no draft');
  assert.match(s, /<DraftDialog projectId=\{projectId\} prospect=\{\{ id: drafting\.prospectId/);
  assert.match(s, /Investor activity could not be read\./);
  assert.doesNotMatch(s, /Recent\s+investor activity and Upcoming pitch meetings wait/, 'the "not drawn yet" note no longer lists it');
});

test('the editor draws the deck bar in place of the crumb', async () => {
  const before = { ...deckCommentsApi };
  Object.assign(deckCommentsApi, {
    list: async () => ({ comments: [], people: [], viewer: { user_id: 2, can_manage: false } }),
    approval: async () => ({ approvers: [], approvals: [] }),
  });
  const m = await mountEditor();
  try {
    const bar = m.by('pitch-deck-bar');
    assert.ok(bar, 'the deck bar');
    assert.equal(m.pr(bar).role, 'toolbar');
    assert.ok(!m.by('pitch-crumb'), 'no crumb while a deck is open');
    assert.equal(m.text(m.by('pitch-back')), '‹ Pitch');
    assert.equal(m.pr(m.by('pitch-back')).href, '/raise/pitch?project_id=7');
    assert.ok(m.walk(bar).includes(m.by('pitch-heading')), 'the deck\'s h1 is in the bar');
    assert.ok(m.walk(bar).includes(m.by('deck-toolbar')) && m.walk(bar).includes(m.by('pitch-header-ask')));
    // The section menu lists the five tiles, Decks current.
    assert.equal(m.pr(m.by('pitch-deck-bar-section'))['aria-expanded'], false);
    await m.press(m.by('pitch-deck-bar-section'));
    assert.deepEqual(TABS.map((t) => m.pr(m.by(`pitch-deck-bar-section-${t.id}`)).href),
      ['/raise/pitch/decks', '/raise/pitch/script', '/raise/pitch/review', '/raise/pitch/share', '/raise/pitch/notes'].map((p) => `${p}?project_id=7`));
    assert.equal(m.pr(m.by('pitch-deck-bar-section-decks'))['aria-current'], 'page');
    // Comment opens the selected card's comments; Edit closes them.
    assert.equal(m.pr(m.by('pitch-deck-bar-edit'))['aria-pressed'], true);
    assert.ok(!m.by('pitch-sheet-comments'));
    await m.press(m.by('pitch-deck-bar-comment'));
    assert.ok(m.by('pitch-sheet-comments'), 'Comment opens the card\'s comments');
    assert.equal(m.pr(m.by('pitch-deck-bar-comment'))['aria-pressed'], true);
    await m.press(m.by('pitch-deck-bar-edit'));
    assert.ok(!m.by('pitch-sheet-comments'), 'Edit closes them');
    assert.equal(m.pr(m.by('pitch-deck-bar-edit'))['aria-pressed'], true);
  } finally { await m.close(); Object.assign(deckCommentsApi, before); }
});

test('a reader\'s bar has Comment and no Edit, and no Ask', async () => {
  const m = await mountEditor({ user: ADMIN });
  try {
    assert.ok(m.by('pitch-deck-bar'));
    assert.ok(!m.by('pitch-deck-bar-edit'), 'a reader cannot edit');
    assert.ok(m.by('pitch-deck-bar-comment'));
    assert.ok(!m.by('pitch-header-ask'));
  } finally { await m.close(); }
});

test('the bar carries its own words; the page frame takes it in place of the crumb', () => {
  const bar = src('pages/raise/pitch/DeckBar.jsx');
  assert.match(bar, /aria-label="Deck"/);
  assert.match(bar, /aria-label=\{compact \? 'Back to Pitch' : undefined\}/, 'compact: the arrow alone, named');
  assert.match(bar, /aria-label=\{`Pitch section: \$\{here\.label\}`\}/);
  assert.ok(!/request\(|fetch\(/.test(bar), 'the bar reads nothing');
  assert.match(src('pages/raise/pitch/PitchPage.jsx'), /\{bar \|\| <PitchCrumb \{\.\.\.crumb\} ask=\{ask\} \/>\}/);
  assert.match(src('pages/raise/pitch/PitchEditor.jsx'), /if \(id === 'close_comments'\) \{ setSheet\(\(s\) => \(s === 'comments' \? null : s\)\); return; \}/);
});

