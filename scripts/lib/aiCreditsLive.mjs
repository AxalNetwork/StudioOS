/**
 * D755 CR10 (#1987) — the rules of the read-only AI credits live check
 * (`scripts/check-ai-credits-live.mjs`), kept here so they are tested without
 * the network. Each judge takes what one fetch returned and answers
 * `{ errors, warnings }`:
 *   - an ERROR is a deployed surface answering wrong: a malformed body, a
 *     person in the public read, a 5xx, or `/plans-and-pricing` not serving
 *     the SPA shell. The check exits 1.
 *   - a WARNING is a surface not deployed yet (the route answers 404 or the
 *     SPA's HTML), or a missing cache header. The check exits 0.
 * Nothing here signs in, buys or calls Stripe.
 */

export const PLANS_PATH = '/api/public/plans-and-packs';
export const PRICING_PATH = '/plans-and-pricing';

const FAMILIES = new Set(['founder', 'investor', 'advisor', 'partner', 'market_intelligence', 'other']);
const SOURCES = new Set(['recorded', 'environment']);
// Keys that would name or identify a person. The public read must carry none.
const PERSONAL_KEYS = new Set(['recorded_by', 'recorded_by_name', 'user_id', 'member_id', 'email', 'name']);
const LABEL = /^\$\d+(\.\d{2})? of tokens$/;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function keysOf(value, out = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!Array.isArray(value)) out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

function judgeAllowance(a, where, errors) {
  if (a === null) return;
  if (!a || typeof a !== 'object' || !isCount(a.daily_microusd) || !isCount(a.monthly_microusd) || !SOURCES.has(a.source))
    errors.push(`${where}: allowance is not {daily_microusd, monthly_microusd, source}`);
}

/** The body of `GET /api/public/plans-and-packs`, as CR2 (#1919) serves it. */
export function judgePlansBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['the body is not a JSON object'], warnings: [] };
  if (!Array.isArray(body.plans) || body.plans.length === 0) errors.push('plans is not a non-empty array');
  else body.plans.forEach((p, i) => {
    const where = `plans[${i}]`;
    if (!p || typeof p !== 'object') return errors.push(`${where} is not an object`);
    if (!FAMILIES.has(p.family)) errors.push(`${where}.family is not a known family`);
    if (p.licence_key !== null && typeof p.licence_key !== 'string') errors.push(`${where}.licence_key is not a string or null`);
    if (!Array.isArray(p.prices)) errors.push(`${where}.prices is not an array`);
    else p.prices.forEach((x, j) => {
      if (!x || typeof x.price_id !== 'string' || !isCount(x.unit_amount) || typeof x.currency !== 'string')
        errors.push(`${where}.prices[${j}] is not {price_id, unit_amount, currency}`);
    });
    judgeAllowance(p.allowance, where, errors);
  });
  if (!Array.isArray(body.packs)) errors.push('packs is not an array');
  else body.packs.forEach((k, i) => {
    const where = `packs[${i}]`;
    if (!k || typeof k !== 'object') return errors.push(`${where} is not an object`);
    if (k.uid !== null && typeof k.uid !== 'string') errors.push(`${where}.uid is not a string or null`);
    if (typeof k.label !== 'string' || !LABEL.test(k.label)) errors.push(`${where}.label is not "$N of tokens"`);
    if (typeof k.price_id !== 'string' || !/^price_[A-Za-z0-9]+$/.test(k.price_id)) errors.push(`${where}.price_id is not a price ID`);
    if (!isCount(k.unit_amount) || k.unit_amount < 500) errors.push(`${where}.unit_amount is not whole cents from $5`);
    if (k.currency !== 'usd') errors.push(`${where}.currency is not usd`);
    if (!isCount(k.credit_microusd) || k.credit_microusd !== k.unit_amount * 10000) errors.push(`${where}.credit_microusd is not its face value`);
    if (!isCount(k.bonus_microusd) || k.bonus_microusd > k.unit_amount * 1000) errors.push(`${where}.bonus_microusd is not 0 to 10% of face`);
  });
  for (const key of ['covers', 'resets'])
    if (typeof body[key] !== 'string' || !body[key].trim()) errors.push(`${key} is not a sentence`);
  const personal = [...new Set(keysOf(body).filter((k) => PERSONAL_KEYS.has(k)))];
  if (personal.length) errors.push(`the public read names a person: ${personal.join(', ')}`);
  return { errors, warnings: [] };
}

/** One fetch of the public read: `{status, contentType, cacheControl, text}`. */
export function judgePlansResponse(res) {
  const type = String(res.contentType || '').toLowerCase();
  if (res.status === 404 || res.status === 405 || (res.status === 200 && type.includes('text/html')))
    return { errors: [], warnings: [`${PLANS_PATH} is not deployed yet (HTTP ${res.status}${type.includes('text/html') ? ', HTML' : ''})`] };
  if (res.status !== 200) return { errors: [`${PLANS_PATH} answered HTTP ${res.status}`], warnings: [] };
  if (!type.includes('application/json')) return { errors: [`${PLANS_PATH} answered ${type || 'no content type'}, not JSON`], warnings: [] };
  let body;
  try { body = JSON.parse(res.text); } catch { return { errors: [`${PLANS_PATH} answered a body that is not JSON`], warnings: [] }; }
  const out = judgePlansBody(body);
  if (!/max-age=\d+/.test(String(res.cacheControl || ''))) out.warnings.push(`${PLANS_PATH} carries no max-age cache header`);
  return out;
}

/** One fetch of `/plans-and-pricing`: the SPA shell, as every shell route serves it. */
export function judgePricingShell(res) {
  const type = String(res.contentType || '').toLowerCase();
  const errors = [];
  if (res.status !== 200) errors.push(`${PRICING_PATH} answered HTTP ${res.status}`);
  else if (!type.includes('text/html')) errors.push(`${PRICING_PATH} answered ${type || 'no content type'}, not HTML`);
  else if (!String(res.text || '').includes('<div id="root">')) errors.push(`${PRICING_PATH} is not the SPA shell (no <div id="root">)`);
  return { errors, warnings: [] };
}
