/**
 * #6252 (D6252): Eadwyn's two drafts on the fund pages (`routes/fund_drafts.ts`). Both are a POST behind a press,
 * never on render; each answers `{ draft: { body, sources, ... } }` and writes nothing.
 */
import { request } from '../api.js';
import { railPressHeaders } from '../railPage.js';

const id = (value) => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Choose a recorded fund or reporting period.');
  return String(value);
};
const here = () => (typeof window === 'undefined' ? undefined : String(window.location?.pathname || '') || undefined);

export const fundDraftsApi = {
  /** The fund brief, from the fund's recorded facts. */
  brief: (fundId) => request(`/funds/${id(fundId)}/drafts/brief`, {
    method: 'POST', headers: railPressHeaders('draft:fund-brief'), body: JSON.stringify({ page: here() }),
  }),
  /** The letter's opening paragraph, from the saved period's recorded capital movements. */
  letter: (fundId, periodId) => request(`/funds/${id(fundId)}/report-periods/${id(periodId)}/drafts/letter`, {
    method: 'POST', headers: railPressHeaders('draft:letter-opening'), body: JSON.stringify({ page: here() }),
  }),
};
