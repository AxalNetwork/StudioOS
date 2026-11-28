/**
 * #9184 — ONE WAY A ROUTE READS A JSON OBJECT BODY.
 *
 * A bare `await c.req.json()` throws a SyntaxError on a malformed body, and
 * `app.onError` used to turn that into the generic 500. The common guard,
 * `.catch(() => ({}))`, only covers the parse: a body of `null` parses to
 * `null`, and the next line's `body.email` throws a TypeError, another 500.
 * An array or a scalar gets past both and reads as an object with no fields.
 *
 * `readJsonObject(c)` returns the parsed plain object, or the 400 refusal for
 * the caller to return:
 *
 *   const body = await readJsonObject(c);
 *   if (body instanceof Response) return body;
 *
 *   invalid_json     the body does not parse (or is empty, unless `allowEmpty`)
 *   body_not_object  it parses to null, an array, a string, a number or a boolean
 *
 * `invalid_json` is the code the newsletter and contact routes already
 * answered with, so their clients see no change. `allowEmpty` is for a POST
 * whose body is optional: no body reads as `{}`, a malformed one is still 400.
 *
 * `isMalformedJsonBody(c)` is the `app.onError` backstop's test: a SyntaxError
 * is answered 400 only when the request's own body is what fails to parse.
 * `scripts/check-json-body.mjs` stops new bare reads in `src/routes/`.
 */
import type { Context } from 'hono';
import { refuse } from './refusal';

export const INVALID_JSON = 'invalid_json';
export const BODY_NOT_OBJECT = 'body_not_object';
export const INVALID_JSON_MESSAGE = 'The request body is not valid JSON. Send a JSON object.';
export const BODY_NOT_OBJECT_MESSAGE = 'The request body must be a JSON object.';

export type JsonObject = Record<string, any>;

/** The 400 for a body that does not parse. */
export function invalidJson(c: Context<any>): Response {
  return refuse(c, 400, { code: INVALID_JSON, message: INVALID_JSON_MESSAGE });
}

/** The parsed body when it is a plain object (not null, an array or a scalar); otherwise the 400 refusal. */
export async function readJsonObject<T extends object = JsonObject>(
  c: Context<any>,
  opts: { allowEmpty?: boolean } = {},
): Promise<T | Response> {
  let text: string;
  try { text = await c.req.text(); } catch { return invalidJson(c); }
  if (!text.trim()) return opts.allowEmpty ? ({} as T) : invalidJson(c);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return invalidJson(c); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse(c, 400, { code: BODY_NOT_OBJECT, message: BODY_NOT_OBJECT_MESSAGE });
  }
  return parsed as T;
}

/** True when the request's body is not valid JSON: it does not parse, or a write carries none at all. */
export async function isMalformedJsonBody(c: Context<any>): Promise<boolean> {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return false;
  let text: string;
  try { text = await c.req.text(); } catch { return false; }
  if (!text.trim()) return true;
  try { JSON.parse(text); return false; } catch { return true; }
}
