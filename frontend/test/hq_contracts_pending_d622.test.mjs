/**
 * D622 (#1343) — HQ · Contracts shows a published type's pending revision and
 * lets only a Super Admin publish it, naming the revision they reviewed.
 *
 * Rendered: the card with a pending revision (who saved it and when, live
 * against pending), the publish control for a Super Admin and the "waits"
 * line for anyone else. The publish call and each refusal's sentence are
 * driven through the component's own submit with a stub client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DocTypeRegistry, PendingRevision, pendingSavedLine, publishRefusal, revisionRows, PUBLISH_REASON_MIN,
} from '../src/pages/hq/ContractsPage.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const pageCode = codeOnly(readFileSync(fileURLToPath(new URL('../src/pages/hq/ContractRegistry.jsx', import.meta.url)), 'utf8'));
const routeSrc = readFileSync(fileURLToPath(new URL('../../cloudflare-worker/src/routes/admin_contract_doc_registry.ts', import.meta.url)), 'utf8');

const PENDING = {
  title: 'Side letter next', layer: 'portfolio', party_roles: ['founder'], required_fields: ['closing'],
  updated_at: '2026-10-07 09:15:02.123', updated_by: 2, updated_by_name: 'Ada Admin',
};
const ROW = {
  doc_type: 'side_letter_axal', title: 'Side letter', layer: 'gp', party_roles: ['axal'], required_fields: ['date'],
  usage_count: 3, registry_status: 'published', pending_draft: PENDING,
};
const hub = (rows) => ({ items: rows, layers: [{ id: 'gp', label: 'GP' }], type_count: rows.length, decisions: {} });
const render = (props) => renderToStaticMarkup(createElement(DocTypeRegistry, { data: hub([ROW]), onRetry: () => {}, ...props }));

test('a published type with a pending revision says so, who saved it and when', () => {
  const markup = render({});
  assert.match(markup, /data-testid="registry-pending-side_letter_axal"/);
  const text = renderedText(markup);
  assert.match(text, /Pending revision · not live/);
  assert.match(text, /Saved by Ada Admin on /);
  assert.equal(pendingSavedLine({ ...PENDING, updated_by_name: null }).startsWith('Saved by Admin #2 on '), true);
  assert.equal(pendingSavedLine({ updated_at: null }), 'Saved by an admin whose account is not recorded, at a time not recorded.');
  // A type with nothing pending, and a draft-only type, draw no block.
  assert.doesNotMatch(renderToStaticMarkup(createElement(DocTypeRegistry, { data: hub([{ ...ROW, pending_draft: null }]) })), /registry-pending-/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DocTypeRegistry, { data: hub([{ ...ROW, registry_status: 'draft' }]) })), /registry-pending-/);
});

test('the card shows live against pending for title, layer, party roles and required fields', () => {
  const rows = revisionRows(ROW, PENDING);
  assert.deepEqual(rows.map((r) => [r.label, r.live, r.pending, r.changed]), [
    ['Title', 'Side letter', 'Side letter next', true],
    ['Layer', 'GP', 'PORTFOLIO', true],
    ['Party roles', 'Axal VC', 'Founder', true],
    ['Required fields', 'date', 'closing', true],
  ]);
  const same = revisionRows(ROW, { ...PENDING, title: 'Side letter' });
  assert.equal(same[0].changed, false, 'an unchanged field is not marked');
  const markup = render({});
  assert.match(markup, /data-testid="registry-pending-row-title" data-changed="true"/);
  const text = renderedText(markup);
  assert.match(text, /LivePending/);
  assert.match(text, /TitleSide letterSide letter next/);
  assert.match(text, /Party rolesAxal VCFounder/);
});

test('only a Super Admin gets the publish control; anyone else is told it waits for one', () => {
  const sup = render({ canPublish: true });
  assert.match(sup, /data-testid="registry-publish-control"/);
  assert.match(sup, /data-testid="registry-publish-side_letter_axal"/);
  assert.match(renderedText(sup), new RegExp(`at least ${PUBLISH_REASON_MIN} characters`));
  assert.doesNotMatch(sup, /registry-publish-waits/);
  const other = render({ canPublish: false });
  assert.doesNotMatch(other, /registry-publish-control|registry-publish-side_letter_axal/);
  assert.match(renderedText(other), /It goes live only when a Super Admin reviews and publishes it\./);
  // The page decides from the signed-in identity, not from a view mode.
  assert.match(pageCode, /const allowed = isSuperAdminUser\(user\);/);
  assert.match(pageCode, /<DocTypeRegistry data=\{registry\} onRetry=\{reload\} canPublish \/>/);
  // The floor matches the route's.
  assert.match(routeSrc, new RegExp(`REGISTRY_PUBLISH_REASON_MIN = ${PUBLISH_REASON_MIN};`));
  assert.match(pageCode, /disabled=\{busy \|\| reason\.trim\(\)\.length < PUBLISH_REASON_MIN\}/);
});

test('the publish names the revision the card shows', () => {
  assert.match(pageCode, /await publishFn\(row\.doc_type, \{ reason: reason\.trim\(\), reviewed_draft_at: pending\.updated_at \}\);/);
  assert.match(pageCode, /publishFn = api\.adminContractRegistryPublish/);
});

test('each refusal reads as a sentence: a short reason, a newer save, a lapsed step-up', () => {
  assert.match(publishRefusal({ code: 'reason_required' }), new RegExp(`at least ${PUBLISH_REASON_MIN} characters`));
  assert.match(publishRefusal({ code: 'draft_changed' }), /saved this revision again after you opened it\. Nothing was published\./);
  assert.match(publishRefusal({ data: { code: 'draft_changed' } }), /saved this revision again after you opened it/, 'the code may sit on the body');
  assert.match(publishRefusal({ code: 'step_up_required' }), /step-up has lapsed.*Nothing was published\./);
  assert.match(publishRefusal({ code: 'reviewed_draft_required' }), /did not say which revision you reviewed/);
  assert.match(publishRefusal({ code: 'not_found' }), /no longer in the store/);
  assert.equal(publishRefusal({ message: 'Super admin required' }), 'The publish was refused: Super admin required');
  assert.equal(publishRefusal(null), 'The publish could not be completed. Nothing was published.');
  // A newer save re-reads the hub so the card shows what would now go live.
  assert.match(pageCode, /if \(\(e\?\.code \|\| e\?\.data\?\.code\) === 'draft_changed' && onPublished\) onPublished\(\);/);
});

test('PendingRevision renders standalone with an injected client', () => {
  const markup = renderToStaticMarkup(createElement(PendingRevision, { row: ROW, canPublish: true, publishFn: async () => ({ ok: true }) }));
  assert.match(markup, /Publish this revision/);
  assert.match(markup, /disabled=""/, 'the button waits for a reason');
});
