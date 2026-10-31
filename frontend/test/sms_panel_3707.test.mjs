import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule, mutationCheck, textOf } from './_form_d695.mjs';

const settings = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
const start = settings.indexOf('function SmsPanel(');
const prelude = `import React, { useState, useEffect, useRef } from 'react';
import { normalizePhoneInput, phoneCountry, phonePlaceholder, PHONE_COUNTRIES, PHONE_ERROR } from '../lib/phoneNumber';
import { loadRecaptcha as realLoad, invisibleToken } from '../lib/recaptcha';
const inputCls = '';
const Card = ({title,description,children}) => <section><h2>{title}</h2><p>{description}</p>{children}</section>;
const Field = ({label,hint,children}) => <label>{label}{hint}{children}</label>;
const useAuth = () => ({user:null});
const isSuperAdminUser = () => false;
export const control = {load:Promise.resolve()};
const loadRecaptcha = () => control.load.then(realLoad);
export const api = {
 status:{configured:false,sms_available:true,sms_ready:true,recaptcha_site_key:'synthetic-key',allowed_countries:['CH','US','GB']},
 sends:[], confirms:[], statusReads:0, sendError:null, confirmError:null,
 async getPersonalProfile(){return {country:'CH'};},
 async smsStatus(){this.statusReads++;return {...this.status};},
 async smsStartEnrollment(...args){this.sends.push(args);if(this.sendError)throw this.sendError;return {session_info:'session-'+this.sends.length,last4:'0000',resend_after_s:60,expires_in_s:600};},
 async smsConfirmEnrollment(...args){this.confirms.push(args);if(this.confirmError)throw this.confirmError;this.status.configured=true;this.status.last4='0000';this.status.country='CH';return {ok:true};}
};
`;
const source = prelude + settings.slice(start, settings.indexOf('\nfunction ', start + 10)) + '\nexport { SmsPanel };';
const button = (f, label) => f.nodes().find(n => n.tagName === 'BUTTON' && textOf(n).trim() === label);
const change = (f, id, value) => act(async () => f.props(f.by(id)).onChange({ target: { value } }));
async function panel(module, holdCheck = false) {
  const before = globalThis.grecaptcha;
  let options, tokens = 0;
  const calls = { renders: 0, resets: 0 };
  globalThis.grecaptcha = {
    render(_container, opts) { calls.renders++; options = opts; return 0; },
    execute() { if (!holdCheck) options.callback('synthetic-token-' + ++tokens); },
    reset() { calls.resets++; },
  };
  const f = await mountForm(h(module.SmsPanel, { data: { totp_configured: true }, flash() {}, onChanged() {} }));
  const unmount = f.unmount;
  f.unmount = async () => { await unmount(); if (before === undefined) delete globalThis.grecaptcha; else globalThis.grecaptcha = before; };
  f.widget = calls;
  f.finishCheck = () => options.callback('synthetic-token-' + ++tokens);
  return f;
}
async function numberStep(f) { await f.click('Add a phone number'); await change(f, 'sms-phone-input', '079 000 00 00'); }

async function validity(module) {
  let ready;
  module.control.load = new Promise(resolve => { ready = resolve; });
  module.api.status.allowed_countries = ['CH'];
  const f = await panel(module);
  try {
    await f.click('Add a phone number');
    assert.equal(f.props(button(f, 'Send verification code')).disabled, true);
    await change(f, 'sms-phone-input', '079 000 00 00');
    assert.equal(f.props(button(f, 'Send verification code')).disabled, true);
    await change(f, 'sms-phone-input', '123');
    await act(async () => ready());
    assert.deepEqual([f.props(button(f, 'Send verification code')).disabled, f.text().includes('Enter a mobile number')], [true, true]);
    await change(f, 'sms-phone-input', '+12025550123');
    assert.deepEqual([f.props(button(f, 'Send verification code')).disabled, f.text().includes("Texts to United States aren't offered yet.")], [true, true]);
    await change(f, 'sms-phone-input', '079 000 00 00');
    assert.equal(f.props(button(f, 'Send verification code')).disabled, false);
    // Ready is a separate precondition from a valid destination.
    module.control.load = Promise.resolve();
    await f.click('Send verification code');
    assert.deepEqual(module.api.sends, [['+41790000000', 'CH', 'synthetic-token-1']]);
  } finally { await f.unmount(); }
}
test('send requires a valid allowed number and the loaded browser check', async () => {
  await mutationCheck(source, 'pages/SettingsPage.jsx', validity, [
    ["const countryOk = !normalizedPhone || status?.allowed_countries === null || (Array.isArray(status?.allowed_countries) && status.allowed_countries.includes(normalizedPhone.country));", 'const countryOk = true;'],
    ['&& !!normalizedPhone &&', '&&'],
    ['&& countryOk && checkReady;', '&& countryOk;'],
    ['normalizedPhone.e164, normalizedPhone.country, token', 'normalizedPhone.e164, normalizedPhone.country, null'],
  ]);
});

async function cancelCheck(module) {
  const f = await panel(module, true);
  try {
    await numberStep(f);
    let sending;
    await act(async () => { sending = f.props(button(f, 'Send verification code')).onClick(); await Promise.resolve(); });
    assert.equal(f.props(button(f, 'Cancel')).disabled, false);
    await f.click('Cancel');
    // Even a late widget completion must not send after the member cancels.
    await act(async () => { f.finishCheck(); await sending; });
    assert.deepEqual([module.api.sends.length, !!button(f, 'Add a phone number'), !!f.by('sms-error'), f.widget.resets], [0, true, false, 1]);
    await f.click('Add a phone number');
    assert.equal(f.props(f.by('sms-phone-input')).disabled, false);
  } finally { await f.unmount(); }
}
test('a pending or dismissed bot check can be cancelled without sending or leaving the form busy', async () => {
  await mutationCheck(source, 'pages/SettingsPage.jsx', cancelCheck, [["pendingCheck.current?.abort(); setStep('idle');", "setStep('idle');"]]);
});

async function sendFlow(module, t) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100_000 });
  const f = await panel(module);
  try {
    await numberStep(f);
    await f.click('Send verification code');
    assert.deepEqual([f.text().includes('number ending 0000'), f.props(f.by('sms-code-input')).autoComplete, f.props(f.by('sms-code-input')).inputMode, f.props(button(f, 'Verify')).disabled, f.props(f.by('sms-resend')).disabled, textOf(f.by('sms-resend'))], [true, 'one-time-code', 'numeric', true, true, 'Resend in 1:00']);
    await act(async () => t.mock.timers.tick(60_000));
    assert.deepEqual([f.props(f.by('sms-resend')).disabled, textOf(f.by('sms-resend'))], [false, 'Resend']);
    await f.click('Resend');
    assert.deepEqual([module.api.sends.map(c => c[2]), f.widget], [['synthetic-token-1', 'synthetic-token-2'], { renders: 1, resets: 2 }]);
    await change(f, 'sms-code-input', '123');
    assert.equal(f.props(button(f, 'Verify')).disabled, true);
    await change(f, 'sms-code-input', '1234567');
    await f.click('Verify');
    assert.deepEqual([module.api.confirms, f.text().includes('Enrolled'), !!button(f, 'Remove SMS factor')], [[['session-2', '123456']], true, true]);
    assert.ok(f.text().includes('SMS is less secure than your authenticator app — anyone who takes over your phone number can use it to sign in.') && f.text().includes('Billing changes, impersonation and other sensitive actions will always still require your authenticator code.'));
  } finally { await f.unmount(); t.mock.timers.reset(); }
}
test('send shows the code and mask; resend waits and refreshes the token; verify enables the factor', async t => {
  await mutationCheck(source, 'pages/SettingsPage.jsx', m => sendFlow(m, t), [
    ['setResendAt(Date.now() + (res.resend_after_s ?? 60) * 1000);', 'setResendAt(0);'],
  ]);
});

async function refusalFlow(module, code = 'region_blocked') {
  const f = await panel(module), message = 'A readable sentence for ' + code + '.';
  try {
    await numberStep(f);
    const verification = ['invalid_code', 'session_expired'].includes(code);
    const error = Object.assign(new Error(message), { code });
    if (verification) { await f.click('Send verification code'); module.api.confirmError = error; await change(f, 'sms-code-input', '123456'); await f.click('Verify'); }
    else { module.api.sendError = error; await f.click('Send verification code'); }
    assert.deepEqual([textOf(f.by('sms-error')), f.props(f.by('sms-error')).role], [message, 'alert']);
    if (verification) assert.equal(f.props(f.by('sms-code-input')).value, code === 'session_expired' ? '' : '123456');
    if (code === 'session_expired') assert.equal(f.props(f.by('sms-resend')).disabled, false);
    if (['sms_unavailable', 'phone_auth_disabled'].includes(code)) assert.equal(module.api.statusReads, 2);
  } finally { await f.unmount(); }
}
test('each send/verify refusal stays inline in words; expiry invites resend and setup refusals refresh', async () => {
  for (const code of ['invalid_phone', 'invalid_country', 'country_not_allowed', 'rate_limited', 'quota_exceeded', 'region_blocked', 'recaptcha_required', 'phone_auth_disabled', 'sms_unavailable', 'invalid_code', 'session_expired', 'upstream_error']) await refusalFlow(await sourceModule(source, 'pages/SettingsPage.jsx'), code);
  await mutationCheck(source, 'pages/SettingsPage.jsx', refusalFlow, [['const message = e?.message || fallback;', 'const message = e?.code || fallback;']]);
});

async function unavailable(module, available = true) {
  module.api.status.sms_available = available;
  module.api.status.sms_ready = false;
  const f = await panel(module);
  try {
    assert.deepEqual([!!button(f, 'Add a phone number'), !!button(f, 'Send verification code'), f.text().includes(available ? "SMS backup isn't available yet" : 'SMS verification is not enabled')], [false, false, true]);
  } finally { await f.unmount(); }
}
test('missing credentials and incomplete setup have explanations and no dead send button', async () => {
  await unavailable(await sourceModule(source, 'pages/SettingsPage.jsx'), false);
  await mutationCheck(source, 'pages/SettingsPage.jsx', unavailable, [["if (!status.sms_ready && !status.configured)", 'if (false)']]);
});

async function retryReadiness(module) {
  module.api.status.sms_ready = false;
  const f = await panel(module);
  try {
    module.api.status.sms_ready = true;
    await f.click('Try again');
    assert.deepEqual([module.api.statusReads, !!button(f, 'Add a phone number')], [2, true]);
  } finally { await f.unmount(); }
}
test('an unavailable setup read can be retried after the provider recovers', async () => {
  await mutationCheck(source, 'pages/SettingsPage.jsx', retryReadiness, [[
    '<button onClick={refresh} className="text-sm text-violet-700 mr-3">Try again</button>',
    '<button onClick={() => {}} className="text-sm text-violet-700 mr-3">Try again</button>',
  ]]);
});

const helperSource = readFileSync(new URL('../src/lib/recaptcha.js', import.meta.url), 'utf8');
test('widget render errors and expired checks reject in words and reset the pending widget', async () => {
  const helper = await sourceModule(helperSource, 'lib/recaptcha.js'), before = globalThis.grecaptcha;
  let options, resets = 0;
  try {
    globalThis.grecaptcha = { render() { throw new Error('synthetic provider diagnostic'); }, execute() {} };
    await assert.rejects(helper.invisibleToken({}, 'synthetic-key'), { message: 'The security check could not load. Reload the page and try again.' });
    globalThis.grecaptcha = { render(_node, p) { options = p; return 1; }, execute() { options['expired-callback'](); }, reset() { resets++; } };
    await assert.rejects(helper.invisibleToken({}, 'synthetic-key'), { message: 'The security check expired. Try again.' });
    assert.equal(resets, 1);
  } finally { if (before === undefined) delete globalThis.grecaptcha; else globalThis.grecaptcha = before; }
});
test('widget loader is shared, reports script failure, and retries without network calls', async () => {
  const helper = await sourceModule(helperSource, 'lib/recaptcha.js'), before = globalThis.document, old = globalThis.grecaptcha;
  const scripts = [];
  delete globalThis.grecaptcha;
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild(script) { scripts.push(script); } } };
  try {
    const one = helper.loadRecaptcha(), two = helper.loadRecaptcha();
    scripts[0].onerror();
    await assert.rejects(one, { message: 'The security check could not load. Reload the page and try again.' });
    await assert.rejects(two);
    const retry = helper.loadRecaptcha();
    globalThis.grecaptcha = { render() {}, execute() {}, ready(fn) { fn(); } };
    scripts[1].onload();
    assert.deepEqual([one === two, scripts.length, scripts[0].src, await retry === globalThis.grecaptcha], [true, 2, 'https://www.google.com/recaptcha/api.js?render=explicit', true]);
  } finally { globalThis.document = before; if (old === undefined) delete globalThis.grecaptcha; else globalThis.grecaptcha = old; }
});
