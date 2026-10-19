/**
 * D765 (#2090) — the rail context a member route hands `run()`.
 *
 * The browser names the page the member is on in `X-Rail-Page`, and the
 * option they pressed in `X-Rail-Option` (`frontend/src/ui/railPage.js`,
 * merged into every `request()`). Until D768's page keys land, the page is
 * the rail's workspace, the key the page's switch is stored under. A route
 * passes its own page and option as the fallback, so a run from a client that
 * sent neither still carries context and still obeys the switch.
 */
import type { Context } from 'hono';
import { ASSIST_OFF_MESSAGE, railOptionKey, railPageKey, railRecordKey, type RailContext } from '../services/aiRouter';
import { refuse } from './refusal';

export const RAIL_PAGE_HEADER = 'X-Rail-Page';
export const RAIL_OPTION_HEADER = 'X-Rail-Option';
/** D770 (#2095): the record view the run was started from (`type:id`, D768's page map). */
export const RAIL_RECORD_HEADER = 'X-Rail-Record';

/** A header value as the browser URI-encodes it (`·` and `&` in a page key); null when it does not decode. */
function header(c: Context<any>, name: string): string | null {
  const raw = c.req.header(name);
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}

/**
 * The request's page and option where they are valid keys, else the route's.
 * `record` is the route's own (`type:id`) when it names one, since the route
 * has resolved and scoped it; else the browser's `X-Rail-Record` (D770), a
 * label on the member's own log row that the route never reads as access.
 */
export function railFor(c: Context<any>, fallback: RailContext, record?: string | null): RailContext {
  const page = railPageKey(header(c, RAIL_PAGE_HEADER)) ?? fallback.page;
  const option = railOptionKey(header(c, RAIL_OPTION_HEADER)) ?? fallback.option ?? null;
  return { page, option, record: record ?? fallback.record ?? railRecordKey(header(c, RAIL_RECORD_HEADER)) ?? null };
}

/** The one answer to an `assist_off` refusal: 403, in the switch's words. */
export function refuseAssistOff(c: Context<any>): Response {
  return refuse(c, 403, { code: 'assist_off', message: ASSIST_OFF_MESSAGE });
}

/**
 * A fallback page from an app path the route already has (`/validate/x` →
 * `validate`): the workspace most of the rail's pages are named after. `dflt`
 * when the path has no usable first segment.
 */
export function pageFromPath(path: unknown, dflt: string): string {
  const first = typeof path === 'string' ? path.split('/').find(Boolean) : undefined;
  return railPageKey(first ? first.toLowerCase() : null) ?? dflt;
}
