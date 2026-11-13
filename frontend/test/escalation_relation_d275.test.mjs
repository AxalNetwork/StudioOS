/**
 * D275 — what the two tiers draw now that a content escalation records what it
 * is to the item it names.
 *
 * The Worker half — the refusals, both tiers storing the relation, the board's
 * partition, HQ's validation and the retry — is
 * cloudflare-worker/test/escalation_relation_d275.test.ts. This file holds:
 *
 *   - THE DRAWER. The "localises it / asks for a change to it" control is drawn
 *     only beside a pick that will be sent, with nothing pre-chosen; the submit
 *     refuses without it, as the route does; and the relation rides the one
 *     raise call as a top-level sibling of `concerns`.
 *   - THE LANE ROWS. "Localises {label}", "Changes {label}", and "About {label}
 *     · relation not recorded" for a row raised before the relation was.
 *   - HQ'S FIGURES. A legacy card says so; the Localised stat counts only rows
 *     marked `localises`, and only when the read was complete.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/escalation_relation_d275.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  concernsOffered, concernToSend, relationToSend, relationMissing, RelationPicker, EscalationAbout,
} from '../src/pages/branch/BranchApprovals.jsx';
import { cardMeta, localisedFigure } from '../src/pages/hq/ContentPage.jsx';
import { RELATION_CHOICES } from '../src/lib/escalationRelation.js';
import { CONCERN_RELATIONS } from '../../cloudflare-worker/src/services/escalationConcerns.ts';

const APPROVALS = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/branch/BranchApprovals.jsx'), 'utf8'));
const LABEL = 'HQ template · Licence agreement · v4 · licence-agreement';
const READY = concernsOffered({
  available: true,
  items: [],
  concerns: {
    available: true,
    items: [{ type: 'template', id: 'licence-agreement', label: LABEL }, { type: 'article', id: 7, label: 'Article · Launch post · launch-post' }],
    sources: [
      { type: 'template', available: true, listed: 1, truncated: false },
      { type: 'article', available: true, listed: 1, truncated: false },
    ],
    truncated: false,
    cap: 100,
    note: 'HQ receives the name this branch gives the item.',
  },
});
const PICKED = 'template:licence-agreement';

/* ------------------------------------------------------------------ *
 * The drawer                                                          *
 * ------------------------------------------------------------------ */

test('D275: the drawer offers exactly the Worker\'s two relations, in words', () => {
  assert.deepEqual(RELATION_CHOICES.map(([v]) => v), [...CONCERN_RELATIONS],
    'the drawer offers a relation the Worker would refuse, or misses one it accepts');
  const html = renderToStaticMarkup(createElement(RelationPicker, { value: '', onChoose() {} }));
  assert.match(html, /data-testid="branch-escalate-relation"/);
  const radios = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 2);
  for (const r of radios) {
    assert.match(r, /type="radio"/);
    assert.ok(!/\bchecked=""/.test(r), 'a relation is pre-chosen, which would record one nobody chose');
  }
  const text = renderedText(html);
  assert.match(text, /This localises it/);
  assert.match(text, /This asks for a change to it/);
  assert.match(renderedText(renderToStaticMarkup(createElement(RelationPicker, { value: 'changes', onChoose() {} }))),
    /required/);
});

test('D275: the control is drawn only beside a pick that will be sent', () => {
  const at = APPROVALS.indexOf('<RelationPicker');
  assert.ok(at > 0, 'the relation control is not mounted');
  assert.match(APPROVALS.slice(at - 120, at), /\{concernToSend\(chosen, concerns, concern\) && \($/m,
    'the control is drawn without a pick to be about');
  assert.equal([...APPROVALS.matchAll(/<RelationPicker\b/g)].length, 1);
  // A new pick clears the relation chosen for the last one.
  assert.match(APPROVALS, /onChoose=\{\(v\) => \{ setConcern\(v\); setRelation\(''\); \}\}/);
});

test('D275: a relation is sent only beside a sent pick, and only when it is one of the two', () => {
  assert.equal(relationToSend('content', READY, PICKED, 'localises'), 'localises');
  assert.equal(relationToSend('content', READY, PICKED, 'changes'), 'changes');
  for (const [what, args] of [
    ['no pick', ['content', READY, '', 'localises']],
    ['another kind', ['other', READY, PICKED, 'localises']],
    ['a pick no longer listed', ['content', READY, 'template:withdrawn', 'localises']],
    ['an empty relation', ['content', READY, PICKED, '']],
    ['a value outside the two', ['content', READY, PICKED, 'translates']],
  ]) assert.equal(relationToSend(...args), undefined, `${what} sent a relation`);
  // The pick itself is still exactly { type, id }: the relation rides beside it.
  assert.deepEqual(Object.keys(concernToSend('content', READY, PICKED)), ['type', 'id']);
});

test('D275: the submit refuses a pick with no relation — the button and the handler — and sends it beside the pick', () => {
  assert.equal(relationMissing('content', READY, PICKED, ''), true);
  assert.equal(relationMissing('content', READY, PICKED, 'translates'), true);
  assert.equal(relationMissing('content', READY, PICKED, 'localises'), false);
  assert.equal(relationMissing('content', READY, '', ''), false, 'a raise with no pick needs no relation');
  assert.equal(relationMissing('other', READY, PICKED, ''), false);

  assert.match(APPROVALS, /const needsRelation = relationMissing\(chosen, concerns, concern, relation\);/);
  assert.match(APPROVALS, /if \(!subject\.trim\(\) \|\| sending \|\| !chosen \|\| needsRelation\) return;/);
  assert.match(APPROVALS, /disabled=\{!subject\.trim\(\) \|\| sending \|\| !chosen \|\| needsRelation\}/);
  const call = APPROVALS.indexOf('api.branchEscalate({ kind: chosen,');
  assert.ok(call > 0);
  const body = APPROVALS.slice(call, APPROVALS.indexOf('});', call));
  assert.match(body, /\n\s*relation: relationToSend\(chosen, concerns, concern, relation\)/,
    'the relation is not sent as a sibling of concerns');
  assert.match(body, /concerns: concernToSend\(chosen, concerns, concern\),/);
  const after = APPROVALS.slice(call, APPROVALS.indexOf('} catch (err)', call));
  assert.match(after, /setRelation\(''\)/, 'a raised relation survives into the next raise');
});

/* ------------------------------------------------------------------ *
 * The lane rows                                                       *
 * ------------------------------------------------------------------ */

test('D275: a raised row leads with what it is to its item, or says the relation is not recorded', () => {
  const words = (relation) => renderedText(renderToStaticMarkup(createElement(EscalationAbout, { subjectRef: LABEL, relation })));
  assert.equal(words('localises'), `Localises ${LABEL}`);
  assert.equal(words('changes'), `Changes ${LABEL}`);
  assert.equal(words(null), `About ${LABEL} · relation not recorded`);
  assert.equal(words(undefined), `About ${LABEL} · relation not recorded`);
  assert.equal(words('something-else'), `About ${LABEL} · relation not recorded`,
    'an unknown relation was drawn as though it were one of the two');
});

/* ------------------------------------------------------------------ *
 * HQ's figures                                                        *
 * ------------------------------------------------------------------ */

test('D275: a board card that names an item but records no relation says so; the others do not', () => {
  const base = { store: 'escalation', uid: 'e', subject: 's', created_at: '2026-09-18 08:00:00', sla: 'ok' };
  assert.match(cardMeta({ ...base, subject_ref: LABEL, relation: null }), / · relation not recorded$/);
  assert.doesNotMatch(cardMeta({ ...base, subject_ref: LABEL, relation: 'changes' }), /not recorded/);
  assert.doesNotMatch(cardMeta({ ...base, subject_ref: null, relation: null }), /not recorded/,
    'a card that names no item is a change by construction, not a missing relation');
});

test('D275: Localised counts only rows marked localises, and only from a complete read', () => {
  const items = [
    { uid: 'a', relation: 'localises', subject_ref: LABEL },
    { uid: 'b', relation: 'changes', subject_ref: LABEL },
    { uid: 'c', relation: null, subject_ref: LABEL },
    { uid: 'd', relation: null, subject_ref: null },
    { uid: 'e', relation: 'localises', subject_ref: LABEL },
  ];
  assert.equal(localisedFigure({ complete: true }, items), '2',
    'a row with no relation, or a change, was counted as a localisation');
  assert.equal(localisedFigure({ complete: true }, []), '0');
  assert.equal(localisedFigure({ complete: false }, items), null, 'a cut read was counted as the total');
  assert.equal(localisedFigure({}, items), null);
  assert.equal(localisedFigure(null, null), null);
});
