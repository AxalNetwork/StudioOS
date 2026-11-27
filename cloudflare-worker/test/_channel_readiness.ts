/**
 * The rollout readiness checks' one harness: WhatsApp (D861, #2506) and
 * Telegram (D868, #2514) run their gates through it, so the two checks have
 * one shape rather than two.
 *
 *   · Each gate is a function `(environment, api) => Promise<void>` that throws
 *     an AssertionError when the gate is broken.
 *   · `runReadiness` runs every gate on an isolated D1 fixture for each
 *     environment (development, preview, production).
 *   · Each mutation rewrites one line of a channel module, imports the
 *     rewritten copy (no tracked file changes), and must fail its gate; the
 *     restored code must pass it. A mutation target must occur exactly once.
 *
 * These checks certify code behaviour. They do not certify a provider's
 * approval, live credentials, or an operator's authorization to switch a
 * channel on: that is the owner's PR to wrangler.toml.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { world, mockFetch, noSecretsSeen, seen } from './_channels_fixture.ts';

export const ENVIRONMENTS = ['development', 'preview', 'production'] as const;
export const AT = new Date('2026-10-22T12:00:00.000Z');

/** A seeded fixture for `environment`, with every outbound fetch mocked; closed and checked for leaks after. */
export async function readinessFixture(environment: string, check: (w: any) => Promise<void>, route: Parameters<typeof mockFetch>[0] = () => undefined) {
  const w = await world({ seed: true });
  w.env.ENVIRONMENT = environment;
  const fetch = mockFetch(route);
  try { await check(w); }
  finally {
    fetch.restore();
    w.db.close();
    noSecretsSeen();
    seen.length = 0;
  }
}

let serial = 0;
/** A copy of `path` (relative to this file) with `before` replaced by `after`, imported fresh. */
export async function mutate(path: string, before: string, after: string, tag: string) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8');
  assert.equal(source.split(before).length, 2, 'one mutation target');
  const { stripTypeScriptTypes } = await import('node:module');
  let changed = stripTypeScriptTypes(source.replace(before, () => after), { mode: 'strip' });
  changed = changed.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => prefix + (spec.startsWith('.')
      ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href
      : import.meta.resolve(spec)) + quote);
  return import('data:text/javascript;base64,' + Buffer.from(changed + `\n// ${tag} ` + ++serial).toString('base64'));
}

export type Gate<Api> = (environment: string, api: Api) => Promise<void>;
/** [name, which module of the api it replaces, file under services/channels/, before, after, the gate that must catch it] */
export type Mutation<Api> = [string, keyof Api & string, string, string, string, Gate<Api>];

/** Register every gate per environment, then every mutation against production. */
export function runReadiness<Api extends Record<string, unknown>>(
  tag: string, original: Api, cases: Record<string, Gate<Api>>, mutations: Mutation<Api>[],
) {
  for (const environment of ENVIRONMENTS) {
    for (const [name, check] of Object.entries(cases)) test(`${tag} ${environment}: ${name}`, () => check(environment, original));
  }
  for (const [name, key, file, before, after, check] of mutations) {
    test(`${tag} mutation: ${name}`, async () => {
      const module = await mutate('../src/services/channels/' + file, before, after, tag);
      await assert.rejects(() => check('production', { ...original, [key]: module }), { name: 'AssertionError' });
      await check('production', original);
    });
  }
}
