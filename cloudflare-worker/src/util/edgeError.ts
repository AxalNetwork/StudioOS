/**
 * D9186 (#9186): the last branch of `app.onError` in `index.ts`, for an error no earlier branch named.
 *
 * - An `HTTPException` already carries its answer (Hono's `bodyLimit` throws one with a 413), so it is
 *   that answer, not a 500.
 * - A D1/SQLite UNIQUE or FOREIGN KEY failure is the caller's conflict, not a crash: 409 with a fixed
 *   refusal body. The SQL text, table and column names never reach the body.
 * - Everything else stays the generic 500.
 *
 * Every branch but the HTTPException one logs `edge_unhandled` with the method, the matched route
 * pattern and a fixed D1 error class: never the message, bind values or the request path.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { PRIVATE_ERROR_DETAIL, reportPrivateError } from './errorPrivacy';
import { refuse } from './refusal';

/** Fixed D1/SQLite failure classes, read off the message and logged in its place. */
const D1_CLASSES: Array<[RegExp, string]> = [
  [/UNIQUE constraint failed/i, 'sqlite_constraint_unique'],
  [/FOREIGN KEY constraint failed/i, 'sqlite_constraint_foreignkey'],
  [/NOT NULL constraint failed/i, 'sqlite_constraint_notnull'],
  [/CHECK constraint failed/i, 'sqlite_constraint_check'],
  [/no such table/i, 'sqlite_no_such_table'],
  [/no such column/i, 'sqlite_no_such_column'],
  [/SQLITE_BUSY|database is locked/i, 'sqlite_busy'],
  [/\bD1_[A-Z_]+|SQLITE_[A-Z_]+/, 'd1_error'],
];

export function d1ErrorClass(err: unknown): string | undefined {
  let text = '';
  try { text = err instanceof Error && typeof err.message === 'string' ? err.message.slice(0, 4096) : ''; } catch { /* unreadable */ }
  return D1_CLASSES.find(([pattern]) => pattern.test(text))?.[1];
}

function routePattern(c: Context<any>): string | undefined {
  try { return c.req.routePath; } catch { return undefined; }
}

export function edgeFallback(c: Context<any>, err: unknown): Response {
  if (err instanceof HTTPException) return err.getResponse();
  const code = d1ErrorClass(err);
  reportPrivateError('edge_unhandled', err, code, { method: c.req.method, route: routePattern(c) });
  if (code === 'sqlite_constraint_unique') {
    return refuse(c, 409, { code: 'already_exists', message: 'That record already exists.' });
  }
  if (code === 'sqlite_constraint_foreignkey') {
    return refuse(c, 409, { code: 'related_record_conflict', message: 'That change names a record that does not exist, or one that other records still use.' });
  }
  return c.json({ detail: PRIVATE_ERROR_DETAIL }, 500);
}
