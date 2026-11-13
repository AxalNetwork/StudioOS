/**
 * The company switcher tells the truth about whether a company exists.
 *
 * Reported as "creating new companies in the top sidebar still doesn't appear."
 * The switcher's button read "My Company" while its own dropdown read "No
 * company yet." — because the label fell back to a hardcoded string when the
 * user had none:
 *
 *   const displayName = loading ? '…' : (company?.company_name ?? 'My Company');
 *
 * So an account with zero companies looked like an account with one, and the
 * only place saying otherwise was a dropdown you had to open. Worse, the
 * memberships fetch was `.catch(() => {})`, so a 401 or a 500 produced exactly
 * the same empty list as a genuinely empty account — the failure and the
 * success were indistinguishable, which is why "I created one and nothing
 * appeared" could not be diagnosed from the UI at all.
 *
 * Both assertions run against `codeOnly()`. The component now MENTIONS
 * "My Company" in the comment explaining why it is gone, and a naive grep
 * would match that comment and pass on a file that had regressed — the exact
 * failure mode `_codeOnly.mjs` exists for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const SRC = 'frontend/src/ui/CompanySwitcher.jsx';
const raw = readFileSync(resolve(process.cwd(), SRC), 'utf8');
const code = codeOnly(raw);

test('the switcher invents no company name when the user has none', () => {
  assert.ok(
    !/\bMy Company\b/.test(code),
    `${SRC} still falls back to a hardcoded company name. An account with zero ` +
      'companies then renders as though it has one, contradicting the dropdown.',
  );

  // The label must come from the real record, not a literal.
  assert.ok(
    /company\?\.company_name/.test(code),
    'the displayed name no longer reads from the active company record',
  );
});

test('a failed memberships load is surfaced, not swallowed', () => {
  assert.ok(
    !/\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(code),
    `${SRC} swallows an error with an empty catch. A failed load then looks ` +
      'exactly like an empty account, so the real state is unreadable.',
  );

  assert.ok(
    /setLoadError\(/.test(code),
    'nothing records why the company list failed to load',
  );
});

test('the empty state and the error state are distinct', () => {
  // "No company yet." must not render when the list is empty only because the
  // request failed — that is the claim that sent this bug the wrong way.
  assert.ok(
    /!loadError && companies\.length === 0/.test(code),
    'the "No company yet." branch does not exclude the load-error case, so a ' +
      'failed request still asserts that the account has no companies',
  );
});
