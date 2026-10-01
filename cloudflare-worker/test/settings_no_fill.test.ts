/**
 * Company Settings gets no fill, and this is the field-by-field reason.
 *
 * Task #188's plan named four surfaces and this was one of them: *"Company +
 * account settings — mixed. Legal name, jurisdiction, sector, description, links.
 * Several are `restatement` from what the platform already holds; a jurisdiction
 * lookup is `sourced`. **Never fill an identity field the platform cannot
 * verify** — it is the one place a wrong fill carries legal weight."*
 *
 * APPLYING THAT GUARDRAIL HONESTLY TO THE ACTUAL FIELD LIST LEAVES NOTHING TO
 * FILL, and the first reason is that two of the fields it was written to protect
 * are not on this page. `company_profiles` has no legal name, no jurisdiction and
 * no incorporation date — those live on `entities` and `compliance_events`, which
 * is a legal-filing surface and a different piece of work. What Company Settings
 * actually edits is eleven columns, and every one of them is refused:
 *
 *   company_name             IDENTITY. The legal-weight case the plan names.
 *   website, linkedin_url,   A URL IS A MODEL'S LIKELIEST FABRICATION. The
 *   logo_url                 competitor fill's own prompt forbids inventing one;
 *                            a fill whose whole output is a URL cannot.
 *   stage, revenue_range,    FACTS ONLY THE COMPANY HOLDS. Nothing in the project
 *   employee_count,          to match back against and nothing outside it to
 *   international_presence   cite — so neither `restatement` nor `sourced` can
 *                            keep its promise, and `composition` may not occupy a
 *                            column holding a measured value.
 *   expansion_goals          INTENT, which only the founder has.
 *   description,             PROSE — and ALREADY SERVED. The brand builder's
 *   current_products         autofill drafts exactly this from
 *                            `project.description` and `.problem_statement`
 *                            (`suggestDescription` in SpinoutLabBrandPage), and
 *                            that path now keeps its provenance. A second
 *                            mechanism drafting the same sentences from the same
 *                            source into a different column is a second answer to
 *                            one question, which is what this registry exists to
 *                            stop.
 *
 * AND THE PAGE HAS NO RAIL. Adding one to reach a single field would put a spend
 * meter and a model card on an administrative form — `eadwynConfig`'s own rule is
 * that "config follows a mount, never the other way round", and the mount here
 * would exist only to justify the config.
 *
 * SO THIS FILE IS THE REFUSAL, KEPT WHERE A FUTURE CHANGE WILL HIT IT. Deciding
 * not to build something leaves no code behind, which means it leaves nothing to
 * disagree with later — and the next person to read the plan will find a surface
 * listed as planned and no trace of why it is absent. A test that fails when a
 * fill starts targeting `company_profiles` is that trace.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/settings_no_fill.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILL_KINDS } from '../src/services/fills/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');

/** Every column `PATCH /company/:uid` will write. The route's own allow-list. */
const EDITABLE = [
  'company_name', 'stage', 'revenue_range', 'employee_count',
  'current_products', 'international_presence', 'expansion_goals',
  'logo_url', 'website', 'linkedin_url', 'description',
];

test('the route still edits exactly the columns this refusal was reasoned about', () => {
  // A NEW COLUMN INVALIDATES THE REASONING ABOVE, which is the point of pinning
  // the list rather than the conclusion. If Company Settings grows a field, the
  // question "is it fillable" has to be asked about it, and this is where it gets
  // asked.
  const route = read('src/routes/company.ts');
  const at = route.indexOf("const updatable = ['company_name'");
  assert.ok(at > 0, 'the company PATCH no longer declares an allow-list');
  const list = route.slice(at, route.indexOf('] as const;', at));
  for (const field of EDITABLE) {
    assert.ok(list.includes(`'${field}'`), `${field} left the allow-list — re-check this file`);
  }
  const found = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(found.sort(), [...EDITABLE].sort(),
    'Company Settings edits a column this refusal has not been reasoned about');
});

test('no fill kind writes a company_profiles column', () => {
  // The mechanical half. Every reason in the header is prose; this is the check.
  const registry = read('src/services/fills/registry.ts');
  assert.doesNotMatch(registry, /company_profiles/,
    'a fill kind targets company_profiles — read this file’s header first');
  for (const k of Object.values(FILL_KINDS)) {
    assert.notEqual(k.surface.split('/')[0], 'settings',
      `${k.kind} claims a settings surface`);
    assert.notEqual(k.assistSurface, 'settings');
  }
});

test('the two fields that COULD be drafted already are, by one mechanism', () => {
  // `description` and `current_products` are the only two that could honestly be
  // proposed, and the brand builder already drafts exactly that prose from exactly
  // that source. A second path would be the duplication this registry exists to
  // prevent — so the assertion is that the existing one is still there, because
  // the moment it is gone this refusal stops being justified.
  const brand = readFileSync(
    resolve(HERE, '../../frontend/src/pages/SpinoutLabBrandPage.jsx'), 'utf8',
  );
  assert.match(brand, /const suggestDescription = \(\) => \{/,
    'the brand autofill no longer drafts from the project record');
  assert.match(brand, /project\?\.description, project\?\.problem_statement,/,
    'the brand autofill no longer reads the project’s own description');
  // And it keeps its provenance, which is what makes it the one worth keeping.
  assert.match(brand, /const \[aiProposed, setAiProposed\] = useState\(\{\}\)/,
    'the brand autofill stopped recording what Eadwyn wrote');
});

test('Company Settings has no AI rail, and adding one needs a reason of its own', () => {
  // `eadwynConfig`'s rule — config follows a mount — cuts both ways: there is no
  // mount here, so there must be no entry, and a mount added only to justify an
  // entry is the dead-config failure `ui_assist_rail_and_sidebar` already refuses.
  const page = readFileSync(
    resolve(HERE, '../../frontend/src/pages/CompanySettingsPage.jsx'), 'utf8',
  );
  assert.doesNotMatch(page, /AssistLayout|WorkerRail|AssistRail/,
    'Company Settings mounted an AI rail — this refusal needs revisiting');
  const config = readFileSync(
    resolve(HERE, '../../frontend/src/ui/eadwynConfig.js'), 'utf8',
  );
  assert.doesNotMatch(config, /\n  settings: \{/,
    'eadwynConfig declares a settings surface with nothing mounting it');
});
