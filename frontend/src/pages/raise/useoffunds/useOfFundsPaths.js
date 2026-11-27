/**
 * #4574 (H4): Use of funds' addresses and the old financial model's forward, with nothing else in the file.
 * `UseOfFundsMovedRedirect` is mounted by App.jsx, so whatever it imports is in every visitor's first download;
 * importing `movedTo` from here keeps the forecast and use-of-funds models (and what they import) out of the shell.
 * `useOfFundsModel.js` and `scenariosForecastModel.js` re-export these, so every existing import still resolves.
 */
export const SLUG = 'use-of-funds';
export const HOME_PATH = `/raise/${SLUG}`;
export const FORECAST_PATH = `${HOME_PATH}/runway/forecast`;

/**
 * Where an old financial-model address lands: Forecast, the query and hash kept, `?project=` as the tool's
 * `?project_id=`, and `moved` naming the notice.
 */
export function movedTo(search = '', moved = 'capital-model') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (q.has('project')) {
    if (!q.has('project_id')) q.set('project_id', q.get('project'));
    q.delete('project');
  }
  if (moved) q.set('moved', moved);
  const out = q.toString();
  return { pathname: FORECAST_PATH, search: out ? `?${out}` : '' };
}
