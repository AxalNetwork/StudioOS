/**
 * #1437 — every page uses `useToast` the way the hook is shaped.
 *
 * `useToast()` returns `{ toast, showToast, dismissToast, success, error }`,
 * and `toast` is DATA: null, a string, or `{ kind, msg }`. Three misuses took
 * admin consoles down or hid their messages:
 *   1. rendering `toast` raw (`{toast}`): an object throws inside React, so
 *      Payments and Billing fell to the error screen on their first message;
 *   2. calling `toast(...)` as a function: it throws, so Advisors and partners
 *      left its editor open after a save and a second Save duplicated it;
 *   3. taking a field the hook does not return (`push`, `Toast`): undefined,
 *      so due diligence threw on a load error.
 * And two quiet ones: 4. setting messages that are never drawn (Exploring);
 * 5. passing the kind as `showToast`'s second argument, which is a DURATION
 *    in ms: `showToast('Invite sent.', 'success')` set a 'success' ms timer,
 *    so the message cleared at once and never read as a success (Referrals).
 *
 * Messages are drawn through `components/ToastMessage.jsx`, or through
 * `toastText(toast)` where a page lays the text out itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { spawnSync } from 'node:child_process';
import { codeOnly } from './_codeOnly.mjs';
import ToastMessage, { toastText, toastIsError } from '../src/components/ToastMessage.jsx';

const SRC = new URL('../src/', import.meta.url).pathname;
const RETURNS = new Set(['toast', 'showToast', 'dismissToast', 'success', 'error']);
const SKIP = new Set(['components/useToast.js', 'components/ToastMessage.jsx']);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// No RegExp is built from a name at runtime (Semgrep detect-non-literal-regexp):
// names are found with indexOf and checked at their boundaries, and only the
// fixed literals below are regular expressions.
const IDENT = /[\w$]/;
const FIELD = /^[A-Za-z_$][\w$]*/;
const KIND_TAIL = /^(?:[^,()]*\?\s*)?(['"])[A-Za-z]+\1(?:\s*:\s*(['"])[A-Za-z]+\2)?$/;

/** Each index where `name` stands as a whole identifier (or dotted path). */
function occurrences(code, name) {
  const out = [];
  for (let i = code.indexOf(name); i >= 0; i = code.indexOf(name, i + 1)) {
    const before = code[i - 1] || '';
    const after = code[i + name.length] || '';
    if (!IDENT.test(before) && before !== '.' && !IDENT.test(after)) out.push(i);
  }
  return out;
}

/** The first non-space character at or after `i` (or before it, going back), with its index. */
function nextChar(code, i) { while (i < code.length && /\s/.test(code[i])) i += 1; return [code[i] || '', i]; }
function prevChar(code, i) { while (i >= 0 && /\s/.test(code[i])) i -= 1; return [code[i] || '', i]; }

/** `showToast(msg, 'success')`: the second argument is a duration, not a kind. */
function kindAsDuration(code, call) {
  for (const at of occurrences(code, call)) {
    const [open, o] = nextChar(code, at + call.length);
    if (open !== '(') continue;
    let depth = 0;
    let close = -1;
    let lastComma = -1;
    for (let k = o; k < code.length; k += 1) {
      if (code[k] === '(') depth += 1;
      else if (code[k] === ')') { depth -= 1; if (depth === 0) { close = k; break; } }
      else if (code[k] === ',' && depth === 1) lastComma = k;
    }
    if (close < 0 || lastComma < 0) continue;
    if (KIND_TAIL.test(code.slice(lastComma + 1, close).trim())) return true;
  }
  return false;
}

/** Every misuse of `useToast` in one file's code, as sentences. */
export function toastMisuses(code) {
  const problems = [];
  const calls = [...code.matchAll(/(?:const|let)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*useToast\s*\(/g)];
  for (const m of calls) {
    const lhs = m[1];
    let drawn;
    let setters = false;
    if (lhs.startsWith('{')) {
      let toastName = null;
      for (const part of lhs.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean)) {
        const [field, alias] = part.split(':').map((x) => x.trim());
        if (!RETURNS.has(field)) problems.push(`takes "${field}", which useToast does not return`);
        if (field === 'toast') toastName = alias || field;
        else setters = true;
        if (field === 'showToast' && kindAsDuration(code, alias || field)) problems.push(`passes a kind as "${alias || field}"'s duration; use success(msg), error(msg) or showToast({ kind, msg })`);
      }
      if (toastName) {
        const uses = occurrences(code, toastName);
        if (uses.some((i) => nextChar(code, i + toastName.length)[0] === '(')) problems.push(`calls "${toastName}" (the current message) as a function`);
        const raw = uses.some((i) => {
          const [before, b] = prevChar(code, i - 1);
          const [after, a] = nextChar(code, i + toastName.length);
          if (before !== '{' || after !== '}') return false;
          const outer = code[b - 1] || '';
          return outer !== '=' && !IDENT.test(outer) && nextChar(code, a + 1)[0] !== '=';
        });
        if (raw) problems.push(`renders "${toastName}" raw; use <ToastMessage toast={${toastName}} /> or toastText(${toastName})`);
        drawn = uses.length > 1;
      } else {
        drawn = false;
      }
    } else {
      const fields = occurrences(code, lhs)
        .filter((i) => code[i + lhs.length] === '.')
        .map((i) => FIELD.exec(code.slice(i + lhs.length + 1))?.[0])
        .filter(Boolean);
      for (const f of fields) {
        if (!RETURNS.has(f)) problems.push(`reads "${lhs}.${f}", which useToast does not return`);
        else if (f !== 'toast') setters = true;
      }
      if (kindAsDuration(code, `${lhs}.showToast`)) problems.push(`passes a kind as "${lhs}.showToast"'s duration; use ${lhs}.success(msg), ${lhs}.error(msg) or ${lhs}.showToast({ kind, msg })`);
      drawn = fields.includes('toast');
    }
    if (setters && !drawn) problems.push('sets messages but never draws them');
  }
  return problems;
}

test('every useToast user takes only what the hook returns, never renders or calls the message raw, and draws what it sets', () => {
  const bad = [];
  for (const p of files(SRC)) {
    const rel = relative(SRC, p);
    if (SKIP.has(rel)) continue;
    const src = readFileSync(p, 'utf8');
    if (!/\buseToast\s*\(/.test(src)) continue;
    for (const problem of toastMisuses(codeOnly(src))) bad.push(`${rel}: ${problem}`);
  }
  assert.deepEqual(bad, []);
});

test('the guard catches each misuse it names', () => {
  assert.deepEqual(toastMisuses(`const { toast } = useToast(); toast('x', 'error'); return <div>{toast}</div>;`), [
    'calls "toast" (the current message) as a function',
    'renders "toast" raw; use <ToastMessage toast={toast} /> or toastText(toast)',
  ]);
  assert.deepEqual(toastMisuses(`const { toast, push } = useToast(); <ToastMessage toast={toast} />`), ['takes "push", which useToast does not return']);
  assert.deepEqual(toastMisuses(`const { showToast } = useToast(); showToast('x');`), ['sets messages but never draws them']);
  assert.deepEqual(toastMisuses(`const t = useToast(); t.push('x'); <ToastMessage toast={t.toast} />`), ['reads "t.push", which useToast does not return']);
  assert.deepEqual(toastMisuses(`const t = useToast(); t.success('x');`), ['sets messages but never draws them']);
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast('x'); <ToastMessage toast={toast} /><Tab toast={toast} />`), []);
  assert.deepEqual(toastMisuses(`const { toast: saved, showToast: setSaved } = useToast(); setSaved('ok'); <p>{toastText(saved)}</p>`), []);
  const kindAsMs = 'passes a kind as "showToast"\'s duration; use success(msg), error(msg) or showToast({ kind, msg })';
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast('Invite sent.', 'success'); <ToastMessage toast={toast} />`), [kindAsMs]);
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast(e?.message || 'x', "error"); <ToastMessage toast={toast} />`), [kindAsMs]);
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast(\`n \${a}\`, r.failed?.length ? 'warning' : 'success'); <ToastMessage toast={toast} />`), [kindAsMs]);
  assert.deepEqual(toastMisuses(`const t = useToast(); t.showToast('x', 'error'); <ToastMessage toast={t.toast} />`), ['passes a kind as "t.showToast"\'s duration; use t.success(msg), t.error(msg) or t.showToast({ kind, msg })']);
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast({ kind: 'error', msg: 'x' }, 6000); showToast('Saved', ms); <ToastMessage toast={toast} />`), []);
  // A name inside a longer identifier is not the binding: `lastToast(...)`, `{shoppingToast}` and `x.toast(` are other things.
  assert.deepEqual(toastMisuses(`const { toast, showToast } = useToast(); showToast({ kind: 'ok', msg: 'x' }); lastToast('a', 'error'); <p>{shoppingToast}</p>; api.toast('x'); <ToastMessage toast={toast} />`), []);
});

test('ToastMessage draws both payload shapes, and nothing for no message', () => {
  assert.equal(renderToStaticMarkup(h(ToastMessage, { toast: null })), '');
  assert.equal(renderToStaticMarkup(h(ToastMessage, { toast: { kind: 'ok', msg: '' } })), '');
  const ok = renderToStaticMarkup(h(ToastMessage, { toast: { kind: 'ok', msg: 'Synced 3 products' } }));
  assert.match(ok, /role="status"/);
  assert.match(ok, /bg-emerald-600[^>]*>.*Synced 3 products/);
  for (const kind of ['err', 'error']) {
    const bad = renderToStaticMarkup(h(ToastMessage, { toast: { kind, msg: 'Sync failed' } }));
    assert.match(bad, /role="alert"/);
    assert.match(bad, /bg-red-600/);
  }
  assert.match(renderToStaticMarkup(h(ToastMessage, { toast: 'Saved.' })), /Saved\./);
  assert.equal(toastText({ kind: 'success', msg: 'Done' }), 'Done');
  assert.equal(toastText('Plain'), 'Plain');
  assert.equal(toastText(null), '');
  assert.equal(toastIsError({ kind: 'err' }), true);
  assert.equal(toastIsError('err'), false);
});

test('Payments, Billing, the signed-document view and Advisors and partners render a success and an error message without a crash', () => {
  // `useToast` is replaced by one that already holds a message, so the real
  // panels render with it. On main, `{toast}` threw here ("Objects are not
  // valid as a React child"). Module mocks need their own flag, so they run
  // in a child process; its result is read back as JSON.
  const child = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--no-warnings',
    '--import', new URL('./_deck-loader.mjs', import.meta.url).pathname,
    new URL('./_toast_render_child.mjs', import.meta.url).pathname,
  ], { encoding: 'utf8', timeout: 120000 });
  const line = (child.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `the render check printed nothing: ${child.stderr}`);
  const results = JSON.parse(line);
  for (const panel of ['BillingPanel', 'SignedDocLightbox', 'AdminNetworkProfiles']) {
    for (const kind of ['success', 'error']) {
      const r = results[`${panel}:${kind}`];
      assert.ok(r, `${panel} with a ${kind} message was not rendered`);
      assert.equal(r.error, null, `${panel} crashed on a ${kind} message: ${r.error}`);
      assert.ok(r.html.includes(`the ${kind} message`), `${panel} did not draw its ${kind} message`);
    }
  }
});
