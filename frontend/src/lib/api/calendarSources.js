// D1484 part 2 (#3978, of #3723) — the member's calendar source settings (CAL4).
// Worker: routes/calendar.ts (`/calendar/sources`, `/calendar/settings`), migration 708.
import { request } from '../api.js';

const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) });

export const calendarSourcesApi = {
  /** `{ families:[{key,label}], sources:[{key,family,module,label,shown,colour,page_only}], copy_target }`. */
  sources: () => request('/calendar/sources'),
  /** Show or hide one source, or set its colour (a palette token, or null for its family's). Answers `{ source }`. */
  setSource: (key, { shown, colour } = {}) => put(`/calendar/sources/${encodeURIComponent(key)}`, {
    ...(shown === undefined ? {} : { shown }), ...(colour === undefined ? {} : { colour }),
  }),
  /** Where new Axal sessions are copied: 'all' | 'google' | 'microsoft' | 'none'. */
  setCopyTarget: (copyTarget) => put('/calendar/settings', { copy_target: copyTarget }),
};
