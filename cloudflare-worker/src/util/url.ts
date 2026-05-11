/**
 * URL helpers shared by worker routes/services/providers.
 *
 * Why this exists: CodeQL flags `s.replace(/\/+$/, '')` (and similar
 * `\/+$` regexes) as `js/polynomial-redos` because, although V8/JSC
 * regexes execute these in linear time, the static rule treats `+$`
 * as polynomial-vulnerable. A bounded loop sidesteps the rule and is
 * also marginally faster on hot paths.
 *
 * Always use `stripTrailingSlashes(env.APP_URL || '')` instead of
 * `(env.APP_URL || '').replace(/\/+$/, '')` for any base-URL building.
 */
export function stripTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s.charCodeAt(i - 1) === 47 /* '/' */) i--;
  return i === s.length ? s : s.slice(0, i);
}
