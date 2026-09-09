/**
 * The signature the pad draws is the signature the worker requires.
 *
 * THE DEFECT THIS EXISTS AGAINST SHIPPED, AND IT MADE SIGNING IMPOSSIBLE.
 * `ESignPage`'s pad drew to a canvas, exported `toDataURL('image/png')`, and
 * handed the result to `submit(sigDataUrl)` — which then dropped it, under a
 * comment reading "SECURITY: deliberately do NOT ship the drawn-signature image
 * … The server treats authenticated click-through + typed_name as the legal
 * signature record (data minimisation — see services/signatures.py)."
 *
 * `services/signatures.py` IS THE DEV FASTAPI, WHICH IS NEVER DEPLOYED
 * (CLAUDE.md, fact 3). The production API is the Worker, `routes/esign.ts`
 * requires `signature_data_url` to carry a PNG data URL, and `services/pdf.ts`
 * embeds that PNG into the signed PDF's execution block. So a person could draw
 * their signature, type their legal name, tick the E-SIGN consent box, press
 * Sign & Submit, and get "Signature must be a PNG canvas drawing" — every time,
 * for as long as the comment stood.
 *
 * WHAT THIS FILE PINS, AND WHY IN THIS SHAPE. Not two literals that happen to
 * agree: the accepted prefix is DERIVED from the MIME type the pad exports, so
 * a pad that switched to JPEG or a route that tightened its prefix fails here
 * rather than in production. Three files have to keep saying the same thing —
 * the pad that makes it, the submit that sends it, and the route that reads it —
 * and the fourth assertion is that the route's reader is not dead weight.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const pageRaw = raw('frontend/src/pages/ESignPage.jsx');
const page = read('frontend/src/pages/ESignPage.jsx');
const api = read('frontend/src/lib/api.js');
const worker = raw('cloudflare-worker/src/routes/esign.ts');
const pdf = raw('cloudflare-worker/src/services/pdf.ts');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

test('the pad exports a PNG data URL and hands it to the submit', () => {
  const pad = between(page, 'const handleSubmit = () => {', 'return (');
  assert.match(pad, /const dataUrl = canvas\.toDataURL\('image\/png'\);/,
    'the pad no longer exports a PNG');
  assert.match(pad, /onSubmit\(dataUrl\);/, 'the pad no longer passes its export to the submit');
  // An empty canvas is never submitted: `hasInk` is set on the first stroke, so
  // a blank white PNG cannot become somebody's signature.
  assert.match(pad, /if \(!canvas \|\| !hasInk\) return;/,
    'an unsigned canvas can now be submitted as a signature');
});

test('the submit sends the drawing, under the name the route reads', () => {
  const submit = between(page, 'const submit = async (sigDataUrl) => {', 'const reject = async () => {');
  assert.match(submit, /signature_data_url: sigDataUrl,/,
    'the drawn signature is not being sent, so every submission 400s');
  assert.match(submit, /typed_name: typedName,/, 'the typed name is no longer sent');
  assert.match(submit, /accepted: true,/, 'the consent flag is no longer sent');
  // The payload reaches the body verbatim; nothing between here and the route
  // renames or drops a field.
  //
  // SCOPED TO THIS METHOD. `api.js` posts `JSON.stringify(payload)` in dozens
  // of places, so a whole-file match was satisfied by any of the others and let
  // this one send `{}` — an escape this suite's own mutation run caught.
  const method = between(api, 'esignSubmitSignature: async (token, payload) => {', 'esignReject');
  assert.match(method, /body: JSON\.stringify\(payload\),/,
    'the api method no longer posts the payload it was given');
  assert.match(method, /method: 'POST',/, 'the signature is no longer posted');
});

test('the accepted prefix is the one the pad’s MIME type produces', () => {
  // DERIVED, NOT TRANSCRIBED. `canvas.toDataURL('image/png')` yields
  // `data:image/png;base64,…`, so the route's constant is checked against the
  // pad's own argument rather than against a second copy of the same string.
  const mime = page.match(/canvas\.toDataURL\('([^']+)'\)/)[1];
  const prefix = worker.match(/const SIGNATURE_DATAURL_PREFIX = '([^']+)';/)[1];
  assert.equal(prefix, `data:${mime};base64,`,
    'the route accepts a prefix the signature pad does not produce');
  assert.match(worker, /if \(!sigDataUrl\.startsWith\(SIGNATURE_DATAURL_PREFIX\)\) \{/,
    'the route no longer checks the prefix it declares');
  assert.match(worker, /const sigDataUrl: string = body\?\.signature_data_url \|\| '';/,
    'the route reads the signature under a different field name than the page sends');
});

test('the route’s reader is not dead weight — the PNG goes into the signed PDF', () => {
  // A field the route demands and never uses would be a check with nothing
  // behind it, and this one has something behind it: the execution block of the
  // PDF the signer receives.
  assert.match(worker, /signatureDataUrl: sigDataUrl,/,
    'the submitted signature no longer reaches the PDF renderer');
  assert.match(pdf, /const img = await doc\.embedPng\(dataUriToBytes\(signatureDataUrl\)\);/,
    'the PDF no longer embeds the drawn signature');
  // And it is bounded, so a large canvas is refused with a message rather than
  // stored.
  assert.match(worker, /if \(sigB64\.length > MAX_SIGNATURE_BYTES \* 1\.4\) \{/,
    'the signature size cap is gone');
});

test('the reversed reasoning is recorded, so it is not "minimised" away again', () => {
  assert.ok(pageRaw.includes('THE DRAWN IMAGE IS THE ARTEFACT'),
    'the correction is no longer recorded, so the next reader removes the field again');
  assert.ok(pageRaw.includes('services/signatures.py` IS THE DEV FASTAPI, WHICH IS NEVER DEPLOYED'),
    'the note no longer says why the old rationale did not apply to production');
  // THE RETIRED INSTRUCTION IS QUOTED, NOT DELETED — the convention this repo
  // follows for a reason that was believed and acted on. What makes that safe
  // rather than confusing is the marker in front of it: an unattributed
  // "deliberately do NOT ship the drawn-signature image" reads as the current
  // rule, and the next reader obeys it.
  const at = pageRaw.indexOf('deliberately do NOT ship the drawn-signature image');
  assert.ok(at > 0, 'the retired rationale is no longer recorded at all');
  assert.ok(pageRaw.slice(Math.max(0, at - 400), at).includes('The comment that stood here read:'),
    'the retired instruction is no longer marked as a quotation, so it reads as current');
});
