/** D1156: API boundary only; GR3's layout belongs to D987. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/lib/api/programGrants.js', import.meta.url), 'utf8');
function client() {
  const seen = [];
  const request = (...args) => { seen.push(args); return Promise.resolve({ programs: [] }); };
  const api = new Function('request', 'api', `${source.replace(/^import .*;$/m, '').replace('export const programGrantsApi', 'const programGrantsApi')}\nreturn programGrantsApi;`)(request, {});
  return { api, seen };
}
test('in-use read encodes one licence and forwards no caller-supplied figures', async () => {
  const { api, seen } = client();
  assert.deepEqual(await api.inUse('lic/a?other=1', { people:999 }),{ programs:[] });
  assert.deepEqual(seen,[['/admin/program-grants/licences/lic%2Fa%3Fother%3D1/in-use']]);
});
test('Send now posts only to the current studio endpoint without a figure body', async () => {
  const { api, seen } = client();
  await api.sendProgramReport({ licence:'other', claims:999 });
  assert.deepEqual(seen,[['/licence/mine/programs/report',{method:'POST'}]]);
});
