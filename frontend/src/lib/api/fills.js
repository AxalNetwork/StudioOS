// D1325 (#3486, #2431 part 2) — the Fill with Eadwyn sheet's read. Worker:
// routes/fills.ts. No model runs and nothing is written: part 3 (D1326) adds
// the run, the record and the undo.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const fillsApi = {
  /** `{ page, form, project, record? }` → each field's value, mark, waiting values and trigger, the sources and Eadwyn's quote. */
  sheet: ({ page, form, project, record = null }) => request(
    `/fills/sheet?page=${enc(page)}&form=${enc(form)}&project=${enc(project)}${record != null ? `&record=${enc(record)}` : ''}`,
  ),
};
