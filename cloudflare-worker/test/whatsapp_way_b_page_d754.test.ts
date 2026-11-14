/**
 * D754 way B (#1939, part 2) — what WhatsApp's page and Record a Session read
 * from wb1's routes beyond the link itself: Axal's public number with a plain
 * `wa.me` link, and, for a Super Admin only, which of Axal's settings are
 * unset, by name and never by value.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_way_b_page_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AXAL, AXAL_TOKEN, ME, call, seen, world } from './_whatsapp_axal_fixture.ts';
import { AXAL_NUMBER_SETTINGS, axalContact, axalNumberMissing } from '../src/services/channels/whatsappLink.ts';

const SUPER = 1; // the fixture's Super Admin (users.id 1, in super_admins)
const ROUTES: [string, string][] = [['POST', '/whatsapp/link'], ['GET', '/whatsapp/link'], ['POST', '/whatsapp/link/x/confirm'],
  ['DELETE', '/whatsapp/link'], ['GET', '/whatsapp/captures'], ['POST', '/whatsapp/captures/x/consent']];

test.afterEach(() => { seen.length = 0; });

test('GET /whatsapp/link carries Axal\'s public number and a plain wa.me link with no code', async () => {
  const { env } = world();
  const r = await call(env, ME, 'GET', '/whatsapp/link');
  assert.equal(r.status, 200);
  assert.equal(r.body.axal_number, AXAL.WHATSAPP_AXAL_DISPLAY_NUMBER);
  assert.equal(r.body.axal_link, 'https://wa.me/15550009999');
  assert.ok('claim' in r.body && 'link' in r.body, 'the link view is still there');
});

test('a Super Admin reads which settings are unset, by name only; a member reads the plain refusal', async () => {
  const { env } = world({ axal: { WHATSAPP_AXAL_WABA_ID: '', WHATSAPP_AXAL_DISPLAY_NUMBER: '  ' } });
  for (const [method, path] of ROUTES) {
    const admin = await call(env, SUPER, method, path, method === 'POST' ? {} : undefined);
    assert.equal(admin.status, 503, `${method} ${path}`);
    assert.equal(admin.body.code, 'not_available');
    assert.deepEqual(admin.body.missing, ['WHATSAPP_AXAL_WABA_ID', 'WHATSAPP_AXAL_DISPLAY_NUMBER'], `${method} ${path}`);
    const member = await call(env, ME, method, path, method === 'POST' ? {} : undefined);
    assert.equal(member.status, 503);
    assert.equal(member.body.missing, undefined, `a member read the setting names on ${method} ${path}`);
  }
  const all = seen.join('\n');
  for (const v of [AXAL_TOKEN, AXAL.WHATSAPP_AXAL_PHONE_NUMBER_ID]) assert.equal(all.includes(v), false, 'a setting\'s value reached a response');
});

test('the names, the contact and readiness come from one list', () => {
  assert.deepEqual([...AXAL_NUMBER_SETTINGS], Object.keys(AXAL));
  assert.deepEqual(axalNumberMissing(AXAL as any), []);
  assert.deepEqual(axalNumberMissing({} as any), [...AXAL_NUMBER_SETTINGS]);
  assert.deepEqual(axalNumberMissing({ ...AXAL, WHATSAPP_AXAL_ACCESS_TOKEN: 7 } as any), ['WHATSAPP_AXAL_ACCESS_TOKEN']);
  assert.deepEqual(axalContact({ ...AXAL, WHATSAPP_AXAL_WABA_ID: '' } as any), {}, 'a contact was drawn while way B is off');
  assert.deepEqual(axalContact({ ...AXAL, WHATSAPP_AXAL_DISPLAY_NUMBER: 'call us' } as any), {}, 'a number with no digits became a link');
});
