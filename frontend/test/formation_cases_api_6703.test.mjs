/** D6703 (#6703): new-company intake uses the project door first and retains the subject on retry. */
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { formationCasesApi } = await import('../src/lib/api/formationCases.js');

test('new-company intake creates a project first, then opens its server case', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ path: new URL(url, 'https://example.test').pathname, body: JSON.parse(options.body) });
    return Response.json(calls.length === 1 ? { id: 6703, name: 'Synthetic venture' } : { case: { uid: 'fc_synthetic' } });
  };
  try {
    const result = await formationCasesApi.createForNewCompany({ name: 'Synthetic venture' });
    assert.deepEqual(calls, [
      { path: '/api/projects', body: { name: 'Synthetic venture' } },
      { path: '/api/formation/cases', body: { project_id: 6703, intent: 'new_company' } },
    ]);
    assert.equal(result.project.id, 6703);
    assert.equal(result.case.uid, 'fc_synthetic');
  } finally { globalThis.fetch = original; }
});

test('a failed intake retains the created project id so retry can resume it', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? Response.json({ id: 6703 }) : Response.json({ error: 'unavailable', message: 'Try again' }, { status: 503 });
  try {
    await assert.rejects(formationCasesApi.createForNewCompany({ name: 'Synthetic venture' }), error => error.projectId === 6703 && error.status === 503);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
