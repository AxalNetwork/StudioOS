import { MODULES } from './modules.js';

/** Actions are routes in their own right, beside the cycle's module slugs. */
export const ACTION_PATHS = { validate: 'record', build: 'connect', raise: 'call', grow: 'update' };
export const STATIC_CHILDREN = ['/raise/cap-table/variants'];
export const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** Pages that draw the cycle's own gutter instead of the App shell's inset. */
export function isCyclePath(pathname) {
  if (typeof pathname !== 'string' || STATIC_CHILDREN.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return false;
  const parts = pathname.split('/');
  if (parts[0] !== '' || !Object.hasOwn(MODULES, parts[1])) return false;
  const [cycle, child, record, extra] = parts.slice(1);
  if (extra !== undefined) return false;
  if (child === undefined) return true;
  if (child === ACTION_PATHS[cycle]) return record === undefined || (cycle === 'validate' && record === 'live');
  if (!MODULES[cycle].some((module) => module.slug === child)) return false;
  return record === undefined || record === 'new' || RECORD_ID.test(record);
}
