/**
 * #3932 (#3696 Q4): the currencies a company may name as its default.
 *
 * ISO 4217 list one, the active codes for money in circulation. Left out on
 * purpose: the fund and unit-of-account codes (BOV, CHE, CHW, CLF, COU, MXV,
 * USN, UYI, UYW, XSU, XUA), the precious metals (XAU, XAG, XPD, XPT), the SDR
 * (XDR) and the testing and "no currency" codes (XTS, XXX). A company is
 * invoiced and reports in money, not in a fund unit.
 *
 * A code is three uppercase letters. This list is what makes it a currency:
 * "ABC" has the shape and is refused.
 *
 * D5029: the list itself lives in `frontend/src/lib/money.js`, beside each currency's minor-unit exponent, so the
 * page and the Worker share one list and one conversion; this file keeps its names for the callers that exist.
 */
import { CURRENCY_CODES } from '../../../frontend/src/lib/money.js';

export const ISO_4217_CODES: ReadonlySet<string> = new Set(CURRENCY_CODES);

export const CURRENCY_INVALID_MESSAGE =
  'Choose a currency by its three-letter ISO 4217 code, such as USD, EUR or GBP.';

/** The code when it is a currency on the list; null when it is not. */
export function currencyCode(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v) && ISO_4217_CODES.has(v) ? v : null;
}
