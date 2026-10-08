/**
 * D648 (#1448) — the Admin Console's source, as the tests read it.
 *
 * Until D648 the fourteen consoles lived in one file, `pages/AdminPage.jsx`,
 * and the tests that pin a console's wording or wiring read that file. Since
 * D648 the page is a shell and each console is its own file under
 * `pages/admin/consoles/`. This returns the shell followed by every console,
 * in the dropdown's order, so a test that asks "does the Admin Console still
 * say X" keeps asking the same question of the same code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ADMIN_CONSOLE_FILES = [
  'frontend/src/pages/AdminPage.jsx',
  'frontend/src/pages/admin/consoles/UsersConsole.jsx',
  'frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx',
  'frontend/src/pages/admin/consoles/KycConsole.jsx',
  'frontend/src/pages/admin/consoles/LegalConsole.jsx',
  'frontend/src/pages/admin/consoles/PersonasConsole.jsx',
  'frontend/src/pages/admin/consoles/DirectoryConsole.jsx',
  'frontend/src/pages/admin/consoles/IntegrationKeysConsole.jsx',
  'frontend/src/pages/admin/consoles/GithubSyncConsole.jsx',
  'frontend/src/pages/admin/consoles/PromoCodesConsole.jsx',
  'frontend/src/pages/admin/consoles/PaymentsConsole.jsx',
  'frontend/src/pages/admin/consoles/BillingConsole.jsx',
  'frontend/src/pages/admin/consoles/WellbeingConsole.jsx',
  'frontend/src/pages/admin/consoles/shared.jsx',
];

/** The shell and every console, one after another, as written. */
export function adminConsoleSource() {
  return ADMIN_CONSOLE_FILES.map((f) => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n');
}
