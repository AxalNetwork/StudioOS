/**
 * D411 — Send for Signature, canvas to page.
 *
 * The canvas (design/canvases/backlog/Send for Signature.dc.html) is one screen
 * whose three steps and status view stand in for artboards. Each block below
 * slices ONE of those regions out of the canvas markup at both ends, asserts
 * the element is really drawn there, and asserts the page carries it — or,
 * where the page deliberately does not, that it says why with a reason the
 * Worker supplies.
 *
 * Source-level, like the other contract tests here: these are claims about
 * what the files say, and a rendered claim would need a DOM CI does not have.
 * `codeOnly` strips comments first, so an explanation of an absence cannot
 * satisfy (or trip) an assertion about the code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const canvas = read('design/canvases/backlog/Send for Signature.dc.html');
const markup = canvas.slice(0, canvas.indexOf('<script type="text/x-dc" data-dc-script'));
const page = codeOnly(read('frontend/src/pages/legal/SendForSignaturePage.jsx')).replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const api = read('frontend/src/lib/api.js');
const registry = read('cloudflare-worker/src/services/esignOriginators.ts');

/** The canvas markup between two anchors, each asserted present and ordered. */
function region(from, to) {
  const a = markup.indexOf(from);
  const b = to ? markup.indexOf(to, a + from.length) : markup.length;
  assert.ok(a >= 0, `canvas anchor "${from}" is gone — re-read the canvas`);
  assert.ok(b > a, `canvas anchor "${to}" is gone or out of order`);
  return markup.slice(a, b);
}
/** The page's code between two anchors. */
function pageRegion(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `page anchors "${from}" … "${to}" not found in order`);
  return page.slice(a, b);
}

const step1 = region('{{ isStep1 }}', '{{ isStep2 }}');
const step2 = region('{{ isStep2 }}', '{{ isStep3 }}');
const step3 = region('{{ isStep3 }}', '{{ sent }}');
const status = region('{{ sent }}');

const pStep1 = pageRegion("data-testid=\"send-step-1\"", "data-testid=\"send-step-2\"");
const pStep2 = pageRegion("data-testid=\"send-step-2\"", "data-testid=\"send-step-3\"");
const pStep3 = pageRegion("data-testid=\"send-step-3\"", 'function EnvelopeStatus');
const pStatus = pageRegion('function EnvelopeStatus', 'export default function SendForSignaturePage');

// ---------- the chrome ----------

test('the step rail: three steps, each with its own note, in the canvas and on the page', () => {
  for (const s of ['Pick a template', 'Review & fill', 'Send']) {
    assert.ok(canvas.includes(`label:'${s}'`), `canvas step "${s}"`);
    assert.ok(page.includes(`label: '${s}'`), `page step "${s}"`);
  }
  assert.match(page, /data-testid="send-step-rail"/);
});

test('the role switch is not on the page: the Worker decides the role', () => {
  assert.match(markup, /\{\{ roleTabs \}\}/, 'the canvas no longer draws a role switch — re-read it');
  assert.doesNotMatch(page, /roleTabs|Founder \/ Partner|setRole\(|role=\{/);
  // The templates come from the session's role, never a role the page picks.
  assert.match(page, /api\.esignTemplates\(\)/);
  assert.doesNotMatch(page, /esignTemplates\([^)]/);
});

// ---------- step 1 ----------

test('step 1: role-scoped templates, what may not be sent and why, and the counsel note', () => {
  assert.match(step1, /\{\{ templates \}\}/);
  assert.match(step1, /not legal advice/);
  assert.match(pStep1, /picker\.items\.map/);
  assert.match(pStep1, /picker\.not_offered\.map/);
  assert.match(pStep1, /\{t\.reason\}/, 'a template that is not offered must show the Worker’s reason');
  assert.match(pStep1, /not legal advice/);
  // The reasons are the Worker's, not the page's.
  for (const reason of registry.matchAll(/reason: '([^']{30,})'/g)) {
    assert.ok(!page.includes(reason[1]), 'the page restates a reason the Worker serves');
  }
});

// ---------- step 2 ----------

test('step 2: change template, the pre-fill banner, preview with a filled count, signature blocks', () => {
  for (const el of ['Change template', 'Document preview', '{{ filledCount }}', '{{ doc.signers }}', '{{ prefillShown }}']) {
    assert.ok(step2.includes(el), `canvas step 2 lost "${el}"`);
  }
  assert.match(pStep2, /Change template/);
  assert.match(pStep2, /Document preview/);
  assert.match(pStep2, /\{filled\} of \{total\} fields filled/);
  assert.match(pStep2, /data-testid="send-signature-blocks"/);
  // The canvas pre-fills from a deal, quote or match; this page cannot yet,
  // and says so with the Worker's sentence rather than a banner that lies.
  assert.match(pStep2, /reason=\{tpl\.absent\.prefill\}/);
});

test('step 2: the preview is the template’s own body, from the Worker', () => {
  assert.match(page, /api\.esignTemplate\(dt\)/);
  assert.match(pStep2, /<Preview body=\{tpl\.body\}/);
  assert.match(api, /esignTemplate: \(docType\) => request\(`\/legal\/esign\/templates\/\$\{encodeURIComponent\(docType\)\}`\)/);
});

test('step 2: recipient and term fields, and Continue held until every field is filled', () => {
  assert.match(step2, />Recipient</);
  assert.match(step2, /\{\{ termFields \}\}/);
  assert.ok(canvas.includes("'Fill all fields to continue'") && canvas.includes("'Continue to review'"));
  assert.match(pStep2, /senderFields\.map/);
  assert.match(pStep2, /disabled=\{!complete\}/);
  assert.match(pStep2, /'Continue to review' : 'Fill all fields to continue'/);
  // The same rule as the server's: every sender field plus a valid email.
  assert.match(page, /const complete = !!tpl && filled === total;/);
});

// ---------- step 3 ----------

test('step 3: review and send, back to fields, final terms, the signer', () => {
  for (const el of ['Review and send', 'Back to fields', 'Final terms', 'Signers · in order', '{{ sendChecks }}']) {
    assert.ok(step3.includes(el), `canvas step 3 lost "${el}"`);
  }
  assert.match(pStep3, /Review and send/);
  assert.match(pStep3, /Back to fields/);
  assert.match(pStep3, /Final terms/);
  assert.match(pStep3, /data-testid="send-final-terms"/);
  // "Signers · in order" and the pre-send checks have no store: each is the
  // Worker's sentence, never an invented order or a green tick.
  assert.match(pStep3, /reason=\{tpl\.absent\.ordered_signers\}/);
  assert.match(pStep3, /reason=\{tpl\.absent\.pre_send_checks\}/);
  assert.doesNotMatch(pStep3, /in order/);
});

test('a blank field refused by the server sends the sender back to the fields', () => {
  assert.match(page, /if \(e\?\.code === 'unfilled_fields'\) setStep\(2\)/);
});

// ---------- the status view ----------

test('after sending, the page moves to ?envelope= — the address ContractsPage links to', () => {
  assert.match(page, /setParams\(\{ envelope: String\(r\.envelope_id\) \}\)/);
  assert.match(page, /params\.get\('envelope'\)/);
  assert.match(page, /\/\^\\d\{1,12\}\$\/\.test\(envelopeParam/, 'the id is not validated before use');
  const contracts = read('frontend/src/pages/advisor/advisory/ContractsPage.jsx');
  assert.match(contracts, /\/legal\/send\?envelope=/, 'ContractsPage no longer links here');
});

test('status: lifecycle, signers with Remind, Outstanding with Void, Fully executed with the PDF, audit trail', () => {
  for (const el of ['{{ lifecycle }}', '{{ signerStatus }}', 'Remind', 'Outstanding', 'Void envelope',
    'Fully executed', 'Download executed PDF', 'View audit trail', 'Audit trail']) {
    assert.ok(status.includes(el), `canvas status view lost "${el}"`);
  }
  assert.match(pStatus, /data-testid="send-lifecycle"/);
  assert.match(pStatus, /data-testid="send-signers"/);
  assert.match(pStatus, /api\.esignRemind\(env\.id\)/);
  assert.match(pStatus, /Outstanding/);
  assert.match(pStatus, /Void envelope/);
  assert.match(pStatus, /api\.esignVoid\(env\.id, voidReason\.trim\(\)\)/);
  assert.match(pStatus, /Fully executed/);
  assert.match(pStatus, /href=\{api\.esignDocumentUrl\(env\.id\)\}/);
  assert.match(pStatus, /View audit trail/);
  assert.match(pStatus, /data-testid="send-audit-trail"/);
});

test('Remind and Void are drawn only for the sender, as the Worker reports it', () => {
  const remind = pStatus.slice(pStatus.indexOf('api.esignRemind') - 400, pStatus.indexOf('api.esignRemind'));
  assert.match(remind, /env\.can_manage && pending && r\.status === 'pending'/);
  assert.match(pStatus, /\{env\.can_manage && !confirmVoid && \(/);
});

test('"Copy signing link" is not on the page: the link is the recipient’s, so Remind resends it', () => {
  assert.match(status, /Copy signing link/, 'the canvas no longer draws it — re-read it');
  assert.doesNotMatch(page, /Copy signing link|signing_url|signing_token|clipboard/);
});

test('what the status view cannot show says why, in the Worker’s words', () => {
  assert.match(status, /filed to your data room/, 'the canvas no longer claims a data room — re-read it');
  assert.match(pStatus, /reason=\{env\.absent\?\.data_room\}/);
  assert.doesNotMatch(pStatus, /filed to your data room/);
  // The canvas prints IPs on the audit trail; that is an owner decision.
  assert.match(pStatus, /reason=\{env\.absent\?\.signer_ip\}/);
  // The one allowed mention is the absence's own reason; nothing else may
  // read an address off an audit row or a recipient.
  const withoutReason = pStatus.split('env.absent?.signer_ip').join('');
  assert.doesNotMatch(withoutReason, /signer_ip|\.ip\b|\bua\b/);
});

test('the canvas’s demo control is not on the page', () => {
  assert.match(status, /Simulate next event/);
  assert.doesNotMatch(page, /Simulate next event|advanceEnvelope/);
});

// ---------- the house pattern ----------

test('the page imports from ui, mounts the WorkerRail once, and prints failures as Unreadable', () => {
  assert.match(page, /from '\.\.\/\.\.\/ui'/);
  assert.equal((page.match(/<WorkerRail\b/g) || []).length, 1);
  assert.match(page, /unavailable=\{picker\?\.absent \?/, 'the rail’s absences are not the Worker’s');
  assert.ok((page.match(/<Unreadable /g) || []).length >= 3, 'a failed read must say so, with a retry');
  // Never a zero in place of a figure that failed to load.
  assert.doesNotMatch(page, /\|\| 0\b|\?\? 0\b/);
});

test('the three api.js methods exist beside the routes they call', () => {
  assert.match(api, /esignVoid: \(id, reason\) =>\s*request\(`\/legal\/esign\/\$\{id\}\/void`/);
  assert.match(api, /esignRemind: \(id\) => request\(`\/legal\/esign\/\$\{id\}\/remind`/);
  const route = read('cloudflare-worker/src/routes/esign.ts');
  for (const r of ["esign.get('/templates/:doc_type'", "esign.post('/:id{[0-9]+}/void'", "esign.post('/:id{[0-9]+}/remind'"]) {
    assert.ok(route.includes(r), `${r} is not mounted`);
  }
});
