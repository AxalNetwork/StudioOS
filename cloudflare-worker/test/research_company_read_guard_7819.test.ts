/** D7819 (#7819): prevent unreviewed new reads of the physical company directory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
const { transformSync } = createRequire(
  new URL('../package.json', import.meta.url),
)('esbuild');
const RESERVED = [
  'services/researchDirectoryReads.ts',
  'routes/research_markets.ts',
  'routes/research_sectors.ts',
];
export const PENDING_READERS = [
  ...RESERVED,
  'routes/competitors.ts',
  'routes/research_overview.ts',
  'routes/research_project_comparisons.ts',
  'services/competitorDirectoryLink.ts',
  'services/records/validate.ts',
  'services/researchCompanyDirectory.ts',
  'services/validateWriters.ts',
].map((p) => `cloudflare-worker/src/${p}`);
export const MAINTENANCE_WRITERS: string[] = [];
const OWN = 'cloudflare-worker/src/services/researchCompanyRead.ts';
export function withoutComments(source: string, path = 'file.ts') {
  return transformSync(source, {
    loader: path.endsWith('x') ? 'tsx' : 'ts',
    legalComments: 'none',
  }).code;
}
export function checkReaders(
  files: Record<string, string>,
  pending = PENDING_READERS,
  writers = MAINTENANCE_WRITERS,
) {
  const references = Object.entries(files)
    .filter(([path, text]) =>
      /\bresearch_company_directory\b/i.test(withoutComments(text, path)),
    )
    .map(([path]) => path);
  const errors = references
    .filter(
      (path) =>
        path !== OWN && !pending.includes(path) && !writers.includes(path),
    )
    .map(
      (path) =>
        `New physical directory reference; add a reviewed pending-reader or maintenance-writer entry: '${path}'`,
    );
  for (const path of [...pending, ...writers])
    if (
      !RESERVED.some((p) => path === `cloudflare-worker/src/${p}`) &&
      !references.includes(path)
    )
      errors.push(`Missing or stale entry: '${path}'`);
  return errors;
}
function tree(dir: string): Record<string, string> {
  return Object.assign(
    {},
    ...readdirSync(dir, { withFileTypes: true }).map((entry) =>
      entry.isDirectory()
        ? tree(resolve(dir, entry.name))
        : /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')
          ? {
              [`cloudflare-worker/src/${relative(resolve(import.meta.dirname, '../src'), resolve(dir, entry.name))}`]:
                readFileSync(resolve(dir, entry.name), 'utf8'),
            }
          : {},
    ),
  );
}
test('pure checker rejects new reads, stale and missing entries, and ignores comments', () => {
  const path = 'cloudflare-worker/src/new.ts';
  assert.match(
    checkReaders(
      { [path]: 'DB.prepare(`SELECT * FROM research_company_directory`)' },
      [],
      [],
    )[0],
    /new.ts/,
  );
  assert.deepEqual(
    checkReaders(
      {
        [path]:
          '// research_company_directory\n/* research_company_directory */',
      },
      [],
      [],
    ),
    [],
  );
  assert.deepEqual(
    checkReaders(
      { [path]: '`SELECT * FROM research_company_directory`' },
      [path],
      [],
    ),
    [],
  );
  assert.match(checkReaders({}, [path], [])[0], /Missing or stale/);
  assert.deepEqual(
    checkReaders(
      {},
      RESERVED.map((p) => `cloudflare-worker/src/${p}`),
      [],
    ),
    [],
  );
  assert.deepEqual(
    checkReaders(
      { [path]: '`UPDATE research_company_directory SET name=?`' },
      [],
      [path],
    ),
    [],
  );
});
test('every real physical directory reader is explicitly pending or the reviewed read service', () => {
  assert.deepEqual(
    checkReaders(tree(resolve(import.meta.dirname, '../src'))),
    [],
  );
});
