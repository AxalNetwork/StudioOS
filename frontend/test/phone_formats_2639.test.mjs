import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule, mutationCheck } from './_form_d695.mjs';
import { normalizePhoneInput, phoneCountry, phonePlaceholder, PHONE_COUNTRIES, PHONE_ERROR } from '../src/lib/phoneNumber.js';

// Entirely synthetic Swiss subscriber digits; US 555, UK 07700 900 and
// French 06 39 98 fixtures are fictional/documentation ranges. No SMS is sent.
const CH = '+41790000000';
const cases = [
  ['079 000 00 00','CH',CH], ['0041 79 000 00 00','CH',CH],
  ['+41 (0)79 000-00.00','CH',CH], [CH,'CH',CH],
  ['0041 79 000 00 00','US',CH], ['079‑000‑00‑00','CH',CH],
  ['(202) 555-0123','US','+12025550123'],
  ['07700 900123','GB','+447700900123'],
  ['06 39 98 01 23','FR','+33639980123'],
  ['+33 (0)6 39 98 01 23','CH','+33639980123'],
  ['02 0000 0000','IT','+390200000000'], // Italian zero is significant.
];
const phoneSource = readFileSync(new URL('../src/lib/phoneNumber.js', import.meta.url), 'utf8');
function verifyNumbers(api) {
  for (const [input,country,expected] of cases) assert.equal(api.normalizePhoneInput(input,country)?.e164, expected, input);
  assert.equal(api.normalizePhoneInput('+33 (0)6 39 98 01 23','CH')?.country, 'FR');
  for (const input of ['123','0790000','not a number','+999123456789','+41790000000 ext 2','++41790000000','079/0000000','0'.repeat(90)]) assert.equal(api.normalizePhoneInput(input,'CH'), null, input);
  assert.equal(api.normalizePhoneInput('(202) 555-0123','AQ'),null);
  assert.equal(api.normalizePhoneInput('+12025550123','AQ')?.e164,'+12025550123');
  assert.equal(api.phonePlaceholder('AQ'),'+country code …');
  assert.equal(api.phoneCountry('ch'), 'CH');
  assert.equal(api.phoneCountry(null), 'US');
  assert.equal(api.phoneCountry('XX'), 'US');
  assert.equal(api.phonePlaceholder('CH'), '079 …');
  assert.equal(api.phonePlaceholder('GB'), '07700 900…');
  assert.ok(api.PHONE_COUNTRIES.find(c => c.country === 'CH').label.includes('(+41)'));
}
test('#2639: national, 00 and international formats agree; invalid input stays refused and country rules retain Italy’s zero', async () => {
  verifyNumbers({ normalizePhoneInput, phoneCountry, phonePlaceholder, PHONE_COUNTRIES });
  await mutationCheck(phoneSource, 'lib/phoneNumber.js', verifyNumbers, [
    [".replace(/^00/, '+')", ''],
    ['defaultCountry: selected', "defaultCountry: 'US'"],
    ['!parsed.isPossible()', 'false'],
    ['parsed.country ||', 'null ||'],
    ["if (!input.startsWith('+') && rawCountry && !isSupportedCountry(rawCountry)) return null;", ''],
    ["isSupportedCountry(country) ? country : 'US'", "'US'"],
  ]);
});

const settings = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
const prelude = `import React, { useState, useEffect } from 'react';
import { normalizePhoneInput, phoneCountry, phonePlaceholder, PHONE_COUNTRIES, PHONE_ERROR } from '../lib/phoneNumber';
const inputCls = '';
const Card = ({ children }) => <div>{children}</div>;
const Field = ({label,hint,children}) => <label>{label}{hint}{children}</label>;
const CompletionRing = () => null;
const useAuth = () => ({user:null});
const isSuperAdminUser = () => false;
export const api = {
 profile: {country:'CH'}, calls: [],
 async getPersonalProfile() { return this.profile; },
 async smsStatus() { return {configured:false,sms_available:true}; },
 async smsStartEnrollment(...args) { this.calls.push(args); return {session_info:'synthetic-session'}; },
 async updatePersonalProfile(patch) { this.calls.push(patch); return this.profile; }
};
`;
const smsStart = settings.indexOf('function SmsPanel(');
const smsSource = prelude + settings.slice(smsStart, settings.indexOf('\nfunction ',smsStart+10)) + '\nexport { SmsPanel };';
async function smsCase(module, input = cases[0][0], country = 'CH', expected = CH, expectedCountry = country) {
  module.api.profile = {country}; module.api.calls.length = 0;
  const messages = [];
  const f = await mountForm(h(module.SmsPanel, {data:{totp_configured:true},flash:(...args)=>messages.push(args)}));
  try {
    await f.click('Add a phone number');
    const countryInput = f.by('sms-phone-country');
    assert.equal(countryInput.tagName,'SELECT');
    assert.equal(f.props(countryInput).value, phoneCountry(country));
    assert.equal(f.props(f.by('sms-phone-input')).placeholder, phonePlaceholder(country));
    await act(async () => f.props(f.by('sms-phone-input')).onChange({target:{value:input}}));
    assert.equal(f.props(f.by('sms-phone-input')).value,input,'typing must not truncate or erase punctuation');
    if (expected) assert.ok(f.text().includes("We'll text " + normalizePhoneInput(input,country).international));
    await f.click('Send verification code');
    if (expected) assert.deepEqual(module.api.calls, [[expected,expectedCountry,null]]);
    else { assert.equal(module.api.calls.length,0); assert.equal(messages.at(-1)[0],PHONE_ERROR); }
  } finally { await f.unmount(); }
}
test('#2639: SMS country defaults from profile (else US), previews and sends canonical destinations', async () => {
  const module = await sourceModule(smsSource, 'pages/SettingsPage.jsx');
  for (const [input,country,expected] of cases.slice(0,-1)) await smsCase(module,input,country,expected,normalizePhoneInput(input,country).country);
  await smsCase(module,'(202) 555-0123',null,'+12025550123','US');
  await smsCase(module,'123','CH',null);
  await mutationCheck(smsSource, 'pages/SettingsPage.jsx', smsCase, [
    ['setCountry(phoneCountry(profile?.country))', "setCountry('US')"],
    ['normalizedPhone.e164, normalizedPhone.country, null', 'phone, country, null'],
    ["We'll text {normalizedPhone.international}.", ''],
    ['setPhone(e.target.value)', "setPhone(e.target.value.slice(0, 5))"],
    ['placeholder={phonePlaceholder(country)}', 'placeholder="+1…"'],
  ]);
  await mutationCheck(smsSource, 'pages/SettingsPage.jsx', module => smsCase(module, '123', 'CH', null), [
    ["if (!normalizedPhone) { flash(PHONE_ERROR, 'error'); return; }", ''],
  ]);
  await mutationCheck(smsSource, 'pages/SettingsPage.jsx', module => smsCase(module, '+33 (0)6 39 98 01 23', 'CH', '+33639980123', 'FR'), [
    ['normalizedPhone.e164, normalizedPhone.country, null', 'normalizedPhone.e164, country, null'],
  ]);
});
test('#2639: SMS selection changes national parsing and a late/unreadable profile cannot silently overwrite it', async () => {
  const module = await sourceModule(smsSource, 'pages/SettingsPage.jsx');
  let resolveProfile;
  module.api.getPersonalProfile = () => new Promise(resolve => {resolveProfile=resolve;});
  const f = await mountForm(h(module.SmsPanel, {data:{},flash(){}}));
  try {
    await f.click('Add a phone number');
    assert.equal(f.props(f.by('sms-phone-country')).disabled,true);
    await act(async () => resolveProfile({country:'CH'}));
    await act(async () => f.props(f.by('sms-phone-country')).onChange({target:{value:'GB'}}));
    await act(async () => f.props(f.by('sms-phone-input')).onChange({target:{value:'07700 900123'}}));
    await f.click('Send verification code');
    assert.deepEqual(module.api.calls, [['+447700900123','GB',null]]);
  } finally { await f.unmount(); }
  module.api.getPersonalProfile = async () => {throw new Error('synthetic read failure');};
  const broken = await mountForm(h(module.SmsPanel, {data:{},flash(){}}));
  try { await broken.click('Add a phone number'); assert.ok(broken.text().includes('Profile country unreadable')); }
  finally { await broken.unmount(); }
});

const profileSource = readFileSync(new URL('../src/pages/account/AccountProfile.jsx', import.meta.url), 'utf8');
async function verifyProfile(module, invalid = false) {
  const calls=[];
  const f = await mountForm(h(module.PersonalDetailsCard, {account:{name:'Fixture'},identity:{status:'ready',data:{}},details:{status:'ready',data:{country:'CH'}},onSave:async patch=>{calls.push(patch);return {};}}));
  try {
    await f.click('Edit');
    const byId = id => f.nodes().find(n => f.props(n).id===id);
    assert.equal(f.props(byId('ac-country')).value,'CH');
    await act(async () => f.props(byId('ac-phone')).onChange({target:{value:invalid?'123':'079 000 00 00'}}));
    if (!invalid) assert.ok(f.text().includes("We'll save +41 79 000 00 00"));
    await f.click('Save');
    if (invalid) { assert.equal(calls.length,0); assert.ok(f.text().includes(PHONE_ERROR)); }
    else assert.equal(calls[0].phone_e164,CH);
  } finally { await f.unmount(); }
}
test('#2639: active profile editor normalises before saving and keeps invalid numbers in the form', async () => {
  const module = await sourceModule(profileSource,'pages/account/AccountProfile.jsx');
  await verifyProfile(module); await verifyProfile(module,true);
  await mutationCheck(profileSource,'pages/account/AccountProfile.jsx',verifyProfile,[
    ['phone_e164: parsed.e164','phone_e164: patch.phone_e164'],
    ["We'll save {normalizedPhone.international}.", ''],
  ]);
  await mutationCheck(profileSource,'pages/account/AccountProfile.jsx',module=>verifyProfile(module,true),[
    ['if (!parsed) return { phone_e164: PHONE_ERROR };', ''],
  ]);
});
const legacyStart=settings.indexOf('function PersonalIdentityCard(');
const legacySource = prelude + settings.slice(legacyStart,settings.indexOf('// ---------- Corporate',legacyStart)) + '\nexport { PersonalIdentityCard };';
async function verifyLegacy(module, invalid = false) {
  module.api.calls.length=0;
  const f=await mountForm(h(module.PersonalIdentityCard,{flash(){}}));
  try {
    await act(async () => f.props(f.by('identity-phone-input')).onChange({target:{value:invalid?'123':'079 000 00 00'}}));
    if (!invalid) assert.ok(f.text().includes("We'll save +41 79 000 00 00"));
    await act(async () => f.props(f.by('identity-phone-save')).onClick());
    if (invalid) { assert.equal(module.api.calls.length,0); assert.ok(f.text().includes(PHONE_ERROR)); }
    else assert.deepEqual(module.api.calls,[{phone_e164:CH}]);
  } finally {await f.unmount();}
}
test('#2639: legacy identity editor also previews and sends canonical phone',async()=>{
  await mutationCheck(legacySource,'pages/SettingsPage.jsx',verifyLegacy,[
    ['phone_e164: normalizedPhone.e164','phone_e164: phoneInput'],
    ["We'll save {normalizedPhone.international}.", ''],
  ]);
  await mutationCheck(legacySource,'pages/SettingsPage.jsx',module=>verifyLegacy(module,true),[
    ['if (!normalizedPhone) { setFieldErrors(previous => ({ ...previous, phone_e164: PHONE_ERROR })); return; }', 'if (!normalizedPhone) { save({ phone_e164: phoneInput }); return; }'],
  ]);
});

async function verifyStoredCountry(module) {
  for (const country of ['AQ','XX','UK','ch']) {
    const calls=[];
    const f=await mountForm(h(module.PersonalDetailsCard,{account:{name:'Fixture'},identity:{status:'ready',data:{}},details:{status:'ready',data:{country}},onSave:async patch=>{calls.push(patch);return {};}}));
    try {
      await f.click('Edit');
      const byId=id=>f.nodes().find(n=>f.props(n).id===id);
      assert.equal(f.props(byId('ac-country')).value,country,'show the actual stored value');
      if (country==='AQ' || country==='XX') {
        await act(async()=>f.props(byId('ac-phone')).onChange({target:{value:'(202) 555-0123'}}));
        await f.click('Save');
        assert.equal(calls.length,0,'unknown phone country needs an explicit calling prefix');
        assert.ok(f.text().includes(PHONE_ERROR));
      }
      await act(async()=>f.props(byId('ac-phone')).onChange({target:{value:'+12025550123'}}));
      await f.click('Save');
      assert.equal(calls[0].phone_e164,'+12025550123');
      assert.equal('country' in calls[0],false,'saving a phone must not rewrite profile country');
    } finally {await f.unmount();}
  }
}
test('#2639: legacy and unsupported profile countries stay visible and cannot be silently parsed as US',async()=>{
  await mutationCheck(profileSource,'pages/account/AccountProfile.jsx',verifyStoredCountry,[
    ["{...ed.upper('country')}","{...ed.upper('country')} value=\"US\""],
    ['normalizePhoneInput(patch.phone_e164, ed.draft.country ?? det.country)',"normalizePhoneInput(patch.phone_e164, 'US')"],
  ]);
});

async function verifyOtherFieldErrors(module) {
  module.api.updatePersonalProfile = async () => { throw { data: { errors: { tax_residency_country: 'Synthetic tax residency refusal' } } }; };
  const f=await mountForm(h(module.PersonalIdentityCard,{flash(){}}));
  try {
    const tax=f.nodes().find(n=>n.tagName==='INPUT' && f.props(n).maxLength===2 && f.props(n).value==='');
    await act(async()=>f.props(tax).onBlur());
    assert.ok(f.text().includes('Synthetic tax residency refusal'));
    await act(async()=>f.props(f.by('identity-phone-input')).onChange({target:{value:'123'}}));
    await act(async()=>f.props(f.by('identity-phone-save')).onClick());
    assert.ok(f.text().includes(PHONE_ERROR));
    assert.ok(f.text().includes('Synthetic tax residency refusal'),'phone refusal preserves other field errors');
  } finally {await f.unmount();}
}
test('#2639: local phone refusal retains unrelated identity errors',async()=>{
  await mutationCheck(legacySource,'pages/SettingsPage.jsx',verifyOtherFieldErrors,[
    ['setFieldErrors(previous => ({ ...previous, phone_e164: PHONE_ERROR }))','setFieldErrors({ phone_e164: PHONE_ERROR })'],
  ]);
});
async function verifySavedMask(module) {
  const f=await mountForm(h(module.PersonalDetailsCard,{account:{name:'Fixture'},identity:{status:'ready',data:{}},details:{status:'ready',data:{country:'CH',has_phone:true,phone_last4:'0000'}},onSave:async()=>({})}));
  try {
    await f.click('Edit');
    const input=f.nodes().find(n=>f.props(n).id==='ac-phone');
    assert.ok(f.props(input).placeholder.includes('0000'),'keep the saved-number mask while replacing it');
    assert.equal(f.props(input).value,'','never load the stored full phone');
  } finally {await f.unmount();}
}
test('#2639: saved profile phone remains masked in the replacement editor',async()=>{
  await mutationCheck(profileSource,'pages/account/AccountProfile.jsx',verifySavedMask,[
    ['det.has_phone ? phoneLabel(det) : phonePlaceholder(ed.draft.country ?? det.country)','phonePlaceholder(ed.draft.country ?? det.country)'],
    ["phone_e164: '', city:","phone_e164: 'exposed-number', city:"],
  ]);
});
