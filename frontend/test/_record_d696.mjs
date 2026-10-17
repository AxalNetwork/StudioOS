// Synthetic record and isolated source mutations for D696. Never live user data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

export function fixture() {
  return {
    module: 'problem-discovery', id: '7', title: 'Harbour operators', sub: 'Teams coordinating local shipments.',
    pills: [{ text: 'Curated', tone: 'vio' }, { text: 'Needs evidence', tone: 'amb' }],
    facts: [
      { label: 'Interviews', value: 0 },
      { label: 'Segment', value: 'Harbour operators' },
      { label: 'Urgency', value: null, reason: 'No urgency score has been recorded.' },
      { label: 'Source', value: 'Research notes' },
    ],
    main: [
      { key: 'quotes', title: 'Quotes', action: { key: 'attach', label: 'Attach a quote', kind: 'form', form: { fields: [] } },
        rows: [
          { a: 'Waiting costs us time', b: 'Harbour research', c: 'Supported', tone: 'vio', href: '/validate/customer-research/2?project_id=3' },
          { a: 'Minutes', b: 'Review', c: 'Pending', tone: 'amb', action: 'open-minutes' },
          { a: 'Occurrence', b: 'Q4', action: { key: 'open-minutes', body: { occurrence: 'meeting-3' } } },
          { a: 'Untrusted reference', action: { key: 'undeclared', kind: 'write', label: 'Never send me' } },
        ] },
      { key: 'five-steps', title: 'Five steps', rows: [
        { a: 'Who they are', b: 'Port operations leads' }, { a: 'Context', b: 'Small local teams' },
        { a: 'Job to be done', b: 'Coordinate shipments' }, { a: 'Urgency', b: 'Daily delays' },
        { a: 'Value promised', b: 'One shared schedule' },
      ] },
      { key: 'interviews', title: 'Interviews scored against it', rows: [{ a: 'Mira Sampleton', b: 'mira@example.invalid' }] },
      { key: 'empty', title: 'Evidence', rows: [], empty: 'No evidence attached.' },
      { key: 'default-empty', title: 'Risks', rows: [] },
    ],
    side: [{ key: 'pain-themes', title: 'Pain themes', action: { key: 'add-theme', label: 'Add theme', kind: 'form' },
      rows: [{ a: 'Scheduling', b: 'Lost hours', c: 'Open', tone: 'unknown' }] }],
    actions: [
      { key: 'compare', label: 'Compare segments', kind: 'link', href: '/validate/ideal-customer-profile?project_id=3' },
      { key: 'draft', label: 'Draft email', kind: 'link', href: 'mailto:team@example.invalid?subject=Review' },
      { key: 'edit', label: 'Edit', kind: 'form', tone: 'primary', form: { fields: [] } },
      { key: 'delete', label: 'Delete', kind: 'write', tone: 'danger', confirm: 'Delete this record?' },
      { key: 'export-persona', label: 'Export persona', kind: 'link' },
      { key: 'open-minutes', label: 'Open minutes', kind: 'write' },
      { key: 'unsafe', label: 'Unsafe URL', kind: 'link', href: 'javascript:alert(1)' },
      { key: 'external', label: 'External URL', kind: 'link', href: 'https://example.invalid' },
      { key: 'missing', label: 'Missing URL', kind: 'link' },
    ],
    activity: [{ a: 'Harbour segment created', b: '15 Oct 2026' }],
    activity_total: 2,
    next: { text: 'Never display this next step on desktop', href: '/validate' },
  };
}

let serial = 0;
/** Resolve imports at the original file, so a mutation never edits the checkout. */
export async function sourceModule(source, path, jsx = false) {
  const url = new URL('../src/' + path, import.meta.url);
  const require = createRequire(url);
  const js = jsx ? (await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' } })).code : source;
  const resolved = js.replace(/((?:from\s*|import\s*\()\s*)['"]([^'"]+)['"]/g, (_match, prefix, specifier) => {
    const target = specifier.startsWith('.') ? new URL(specifier, url).href : specifier.startsWith('node:') ? specifier : pathToFileURL(require.resolve(specifier)).href;
    return prefix + JSON.stringify(target);
  });
  return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64') + '#d696-' + serial++);
}

export function mutate(source, before, after) {
  assert.ok(source.includes(before), 'mutation target still exists: ' + before);
  return source.replace(before, after);
}

export async function mutationCheck(source, path, verify, mutations, jsx = false) {
  await verify(await sourceModule(source, path, jsx));
  for (const [before, after] of mutations) {
    const changed = await sourceModule(mutate(source, before, after), path, jsx);
    await assert.rejects(async () => verify(changed), { name: 'AssertionError' }, 'mutation must be caught: ' + before);
  }
  await verify(await sourceModule(source, path, jsx));
}
