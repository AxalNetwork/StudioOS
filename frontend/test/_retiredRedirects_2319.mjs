// D2319 (#2319), #4415: the owner's retired-address policy, independent of live routes.
import { readFileSync } from 'node:fs';
import { matchPath } from 'react-router-dom';
const decision = readFileSync(new URL('../../documentation/architecture/decisions/D2319.md', import.meta.url), 'utf8');
export const retiredRedirects = [...decision.split('<!-- retired-paths:begin -->')[1].split('<!-- retired-paths:end -->')[0].matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
export function isRetiredRedirect(path) {
  if (typeof path !== 'string') return false;
  const pathname = path.split(/[?#]/)[0];
  return retiredRedirects.some((pattern) => Boolean(matchPath({ path: pattern, end: true }, pathname)));
}
