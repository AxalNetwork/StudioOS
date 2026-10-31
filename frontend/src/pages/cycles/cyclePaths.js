import { MODULES } from './modules.js';

/** Actions are routes in their own right, beside the cycle's module slugs. */
export const ACTION_PATHS = { validate: 'record', build: 'connect', raise: 'call', grow: 'update' };
/** Static children outside the cycle gutter. D1029: the variants page was the last; it redirects now. */
export const STATIC_CHILDREN = [];
/** D694: the cycle gutter, shared with the pitch pages (#3717). */
export const CYCLE_GUTTER = 'min-w-0 px-[22px] pt-[14px] pb-[18px] lg:px-6 lg:pt-[22px] lg:pb-[30px] lg:@max-[760px]/cycle:px-[14px] lg:@max-[760px]/cycle:pt-[14px] lg:@max-[760px]/cycle:pb-[40px]';

export const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** Pages that draw the cycle's own gutter instead of the App shell's inset. */
export function isCyclePath(pathname) {
  if (typeof pathname !== 'string' || STATIC_CHILDREN.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return false;
  const parts = pathname.split('/');
  if (parts[0] !== '' || !Object.hasOwn(MODULES, parts[1])) return false;
  const [cycle, child, record, extra, more] = parts.slice(1);
  // D1024 (#2861): a Cap table scenario, and the compare page, sit two segments under the module.
  if (cycle === 'raise' && child === 'cap-table' && record === 'scenarios' && extra !== undefined) return more === undefined && RECORD_ID.test(extra.toLowerCase());
  if (extra !== undefined) return false;
  if (child === undefined) return true;
  if (child === ACTION_PATHS[cycle]) return record === undefined || (cycle === 'validate' && record === 'live');
  if (!MODULES[cycle].some((module) => module.slug === child)) return false;
  return record === undefined || record === 'new' || RECORD_ID.test(record);
}
