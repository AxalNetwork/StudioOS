/**
 * D4618 part 2 (#4618): the Account page's source, as the source-text pins read it.
 *
 * `SettingsPage.jsx` is the route, navigation and layout shell, plus Sign-in and security (which waits on #4614).
 * The profile, entity, privacy, notification and billing controllers moved, unchanged, into these modules under
 * `pages/account/`. A pin that held "the Account page draws X" reads the shell followed by them, so it holds
 * wherever the controller now lives; a pin about the shell alone still reads `SettingsPage.jsx`.
 */
import { readFileSync } from 'node:fs';

export const ACCOUNT_SECTION_FILES = [
  'frontend/src/pages/account/SettingsFields.jsx',
  'frontend/src/pages/account/AccountEntityRecords.jsx',
  'frontend/src/pages/account/ProfileSections.jsx',
  'frontend/src/pages/account/NotificationSections.jsx',
  'frontend/src/pages/account/PrivacySections.jsx',
  'frontend/src/pages/account/BillingSection.jsx',
];

const ROOT = new URL('../../', import.meta.url);

/** `SettingsPage.jsx` and then each extracted section module, joined by blank lines. */
export function readAccountPage() {
  return ['frontend/src/pages/SettingsPage.jsx', ...ACCOUNT_SECTION_FILES]
    .map((p) => readFileSync(new URL(p, ROOT), 'utf8'))
    .join('\n\n');
}
