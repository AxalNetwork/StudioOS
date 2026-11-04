/** D4438 (#4438) — SEG7's registry-backed scope and waiting suggestions; read failures never mean none. */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { personaSegmentScopesApi } from '../../../lib/api/personaSegmentScopes';
import { BLOCK_FAILED, SCOPE_LINE } from './segModel';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const SUB = 'text-xs text-axal-muted dark:text-gray-400';
const BUTTON = 'min-h-11 rounded-lg border border-axal-hairline px-3 py-2 text-sm font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const ready = (data) => ({ status: 'ready', data });
const error = () => ({ status: 'error', data: null });
const loading = () => ({ status: 'loading', data: null });

export function useScopedOverview(scope, tick, enabled, api = personaSegmentScopesApi) {
  const [state, setState] = useState({ seg: loading(), profiles: loading(), coverage: loading() });
  const [own, setOwn] = useState(0);
  const retry = useCallback(() => setOwn((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ scope, seg: loading(), profiles: loading(), coverage: loading() });
    api.overview(scope).then((data) => {
      if (!alive) return;
      setState({ scope,
        seg: data?.summary?.members ? ready(data.summary) : error(),
        profiles: Array.isArray(data?.profiles?.segments) ? ready(data.profiles) : error(),
        coverage: Array.isArray(data?.coverage?.segments) ? ready(data.coverage) : error(),
      });
    }, () => { if (alive) setState({ scope, seg: error(), profiles: error(), coverage: error() }); });
    return () => { alive = false; };
  }, [scope, tick, enabled, api, own]);
  return { ...(state.scope === scope ? state : { seg: loading(), profiles: loading(), coverage: loading() }), retry };
}

function ReadFailure({ retry }) {
  return <div role="alert" className="space-y-2 text-sm text-amber-900 dark:text-amber-200">{BLOCK_FAILED} <button type="button" className={BUTTON} onClick={retry}>Try again</button></div>;
}
export function ScopeControls({ scope, onChange, tick, api = personaSegmentScopesApi }) {
  const [read, setRead] = useState(loading);
  const [own, setOwn] = useState(0);
  useEffect(() => {
    let alive = true; setRead(loading());
    api.scopes().then((v) => {
      if (!Array.isArray(v?.scopes) || !v.scopes.some((s) => s.code === 'hq') || !v.registry) throw new Error('Incomplete scopes');
      if (alive) setRead(ready(v));
    }).catch(() => { if (alive) setRead(error()); });
    return () => { alive = false; };
  }, [api, tick, own]);
  return <section className={`${CARD} space-y-2`} data-testid="seg-scope-controls">
    <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-axal-ink dark:text-gray-100">Scope
      <select className="min-h-11 max-w-full rounded-full border border-axal-hairline bg-white px-3 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" value={scope} disabled={read.status !== 'ready'} onChange={(e) => onChange(e.target.value)} data-testid="seg-scope-select">
        {read.status === 'ready' ? read.data.scopes.map((s) => <option key={s.code} value={s.code}>{s.label}</option>) : <option value={scope}>{scope === 'hq' ? 'HQ-held accounts' : scope}</option>}
      </select>
    </label>
    {read.status === 'loading' && <p role="status" className={SUB}>Reading scopes…</p>}
    {read.status === 'error' && <ReadFailure retry={() => setOwn((n) => n + 1)} />}
    {read.status === 'ready' && !read.data.registry.readable && <ReadFailure retry={() => setOwn((n) => n + 1)} />}
    <p className={SUB} data-testid="seg-scope-line">{read.status === 'ready' && read.data.scopes.length === 1 && read.data.registry.readable ? SCOPE_LINE : 'Overview reads the selected studio’s accounts. All studios includes HQ; a studio that cannot be read is never counted as zero.'}</p>
    <p className={SUB}>Member lists and segment edits stay at HQ. To read one studio’s needs and offers, select that studio.</p>
  </section>;
}
export function SuggestionsInset({ scope, tick, api = personaSegmentScopesApi }) {
  const [state, setState] = useState(loading);
  const [own, setOwn] = useState(0);
  useEffect(() => {
    let alive = true; setState({ ...loading(), scope });
    api.suggestions(scope).then((v) => {
      if (!Array.isArray(v?.suggestions) || !v.suggestions.every((s) => s && typeof s.uid === 'string' && typeof s.text === 'string' && typeof s.origin_code === 'string')) throw new Error('Incomplete suggestions');
      if (alive) setState({ ...ready(v), scope });
    }).catch(() => { if (alive) setState({ ...error(), scope }); });
    return () => { alive = false; };
  }, [api, scope, tick, own]);
  const read = state.scope === scope ? state : loading();
  return <section className={`${CARD} space-y-2`} data-testid="seg-suggestions-inset">
    <span className="text-xs font-bold uppercase text-axal-muted dark:text-gray-400">Suggestions</span>
    <h2 className="text-sm font-bold text-axal-ink dark:text-gray-100">Waiting for HQ</h2>
    {read.status === 'loading' && <p role="status" className={SUB}>Reading…</p>}
    {read.status === 'error' && <ReadFailure retry={() => setOwn((n) => n + 1)} />}
    {read.status === 'ready' && <>
      {read.data.suggestions.length === 0 ? <p className={SUB}>No suggestions waiting for HQ in this scope.</p> : <ul className="space-y-2 text-sm text-axal-ink dark:text-gray-100">{read.data.suggestions.slice(0, 3).map((s) => <li key={s.uid}><p>{s.text}</p><p className={SUB}>{s.suggested_by_name || 'Name not recorded'} · {s.origin_code === 'hq' ? 'HQ-held' : s.origin_code}</p></li>)}</ul>}
      <p className={SUB}>Latest suggestions in this scope, from up to 200 open records.</p>
      <Link to="/admin/persona-segments/suggestions" className={`${BUTTON} inline-flex items-center`}>Review suggestions</Link>
    </>}
  </section>;
}
