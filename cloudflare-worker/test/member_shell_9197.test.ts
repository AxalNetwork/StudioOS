/** D9197: the shell read keeps each store scoped to the current account. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import { ensureUserSettings } from '../src/services/userSettings.ts';
import { memberShell } from '../src/services/memberShell.ts';
import type { Env } from '../src/types';

test('bundled shell data uses the caller, with independent failures and admin chat bypass', async (t) => {
  const { db, DB } = makeD1(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1), (2);
    CREATE TABLE onboarding_progress (user_id INTEGER PRIMARY KEY, flow TEXT, completed_at TEXT);
    INSERT INTO onboarding_progress VALUES (1, 'founder', '2026-10-05'), (2, 'chat', NULL);
    CREATE TABLE user_personas (user_id INTEGER, persona_id TEXT, is_primary INTEGER, updated_at TEXT);
    INSERT INTO user_personas VALUES (1, 'sample-old', 0, '2026-10-06'),
      (1, 'sample-founder', 1, '2026-10-05'), (2, 'sample-admin', 1, '2026-10-07');
  `);
  t.after(() => db.close());
  const env = { DB } as Env;
  await ensureUserSettings(env);
  db.prepare('INSERT INTO user_settings (user_id, theme, dismissed_explainers) VALUES (?, ?, ?)').run(1, 'light', '["studio"]');
  db.prepare('INSERT INTO user_settings (user_id, theme, dismissed_explainers) VALUES (?, ?, ?)').run(2, 'dark', '["network"]');

  assert.deepEqual(await memberShell(env, 1, 'founder'), {
    settings: { theme: 'light', dismissed: ['studio'] },
    progress: { flow: 'founder', completed_at: '2026-10-05' },
    persona: { primary: 'sample-founder' },
  });
  assert.deepEqual(await memberShell(env, 2, 'admin'), {
    settings: { theme: 'dark', dismissed: ['network'] },
    progress: { flow: null, completed_at: null },
    persona: { primary: 'sample-admin' },
  });
  db.exec('DROP TABLE user_personas');
  assert.deepEqual(await memberShell(env, 1, 'founder'), {
    settings: { theme: 'light', dismissed: ['studio'] },
    progress: { flow: 'founder', completed_at: '2026-10-05' },
    persona: null,
  });
});
