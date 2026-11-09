// D5044 (#5044) — HQ Team's source as the source-reading tests read it: the composer and its parts.
//
// `HqTeamTable.jsx` composes the files in `pages/hq/team/` (see that folder's README). A test that
// pinned a rule by reading `HqTeamTable.jsx` reads `teamRaw()` instead, so the rule is checked
// wherever its code now lives; a test about one part reads `teamFile(name)`. The order is fixed:
// the composer first, then the parts as the page draws them.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

export const TEAM_TABLE = 'frontend/src/pages/hq/HqTeamTable.jsx';
export const TEAM_DIR = 'frontend/src/pages/hq/team';
export const TEAM_PARTS = [
  'useHqTeamRoster.js',
  'HqAdminRoster.jsx',
  'SignOutAccountAction.jsx',
  'BranchAccountSearch.jsx',
  'SupportSessionAction.jsx',
  'MoveAccountAction.jsx',
  'UnbindAdminAction.jsx',
  'governedAction.js',
  'ActionNotice.jsx',
  'teamInvalidation.js',
];

/** Every source file in the folder is listed above, so a new part cannot hide from these tests. */
export function unlistedParts() {
  return readdirSync(resolve(ROOT, TEAM_DIR))
    .filter((n) => /\.(jsx?|tsx?)$/.test(n) && !TEAM_PARTS.includes(n));
}

export const teamFile = (name) => read(`${TEAM_DIR}/${name}`);

/** The composer and every part, concatenated in the fixed order. */
export function teamRaw() {
  return [read(TEAM_TABLE), ...TEAM_PARTS.map(teamFile)].join('\n');
}
