/**
 * D5929 (#5929) — the rules of New licence's frame and its territory step (Licences v2 board L21), as pure functions:
 * the six steps' marks, which step may be opened, the territory step's countries and conflicts, the sentence a
 * conflict is shown with, how the Worker's refusal is read, and what Leave says. `IssueLicenceFlow.jsx` draws the
 * frame and `TerritoryEditor.jsx`'s `TerritoryStep` draws step 2.
 *
 * The territory step writes through the route the licence page already uses, `PUT /admin/licences/:uid/territories`,
 * and reads who holds what from `GET /admin/licences/territories`. The Worker refuses an overlap (409
 * `territory_conflict`) and the unique index on `licence_territories.country_code` is the real guard; the check here
 * only shows the conflict before the person presses Continue.
 */
import { EU_27, EU_CODES } from '../../../lib/licenceCoverage.js';
import { outcomeOfError } from '../../../lib/mutationOutcome.js';
import { NEW_LICENCE_STEPS, refusalSentence, stepLine } from './newLicenceModel.js';

export { NEW_LICENCE_STEPS, stepLine };

/** The territory step's index in `NEW_LICENCE_STEPS`. */
export const TERRITORY_STEP = 1;

/* ---------------------------------------------------------------- the frame */

/**
 * Each step's mark in the step list: `current` (`aria-current="step"`), `done` (the person moved on from it) or
 * `todo`. A step is `done` only once it was left forwards, so a step skipped by a jump (Edit from the review to
 * step 1) does not claim to be done.
 */
export function stepMarks(current, passed) {
  const seen = passed instanceof Set ? passed : new Set(passed || []);
  return NEW_LICENCE_STEPS.map((name, i) => ({
    i, name,
    state: i === current ? 'current' : seen.has(i) ? 'done' : 'todo',
  }));
}

/**
 * Whether the step list may open step `i`. Step 1 always; every later step needs the draft step 1 creates, and no
 * step past the furthest one reached is opened from the list (Continue on each card is the way forward).
 */
export function canOpenStep(i, { licence, reached = 0 } = {}) {
  if (i === 0) return true;
  if (!licence?.uid) return false;
  return i <= reached;
}

/**
 * Leaving the flow. Nothing typed and no draft: it closes. A draft created, or anything typed: it asks first, in the
 * words of board LNS47E. A licence already issued is no longer a draft, so it closes.
 */
export function leavePlan({ licence, dirty }) {
  if (licence?.uid && licence.status && licence.status !== 'draft') return { ask: false };
  if (licence?.uid) {
    return {
      ask: true,
      body: `The draft ${licence.licence_ref || 'licence'} stays in the ledger as Draft, with everything saved so far. You can finish it from its licence page. Values typed on this step and not yet saved are discarded.`,
    };
  }
  if (!dirty) return { ask: false };
  return { ask: true, body: 'Nothing has been saved yet: no draft exists until step 1 creates it. The values you typed are discarded.' };
}

/**
 * Where each kind's members land and where its host is bound (D196, D197). Today's inline form said this under its
 * Kind control; the frame keeps it under step 1 until the draft exists, so moving to the stepped flow removes
 * nothing. The keys are the kinds `POST /admin/licences` admits (`LICENCE_KINDS`).
 */
export const KIND_HOSTS = Object.freeze([
  ['subsidiary', 'Axal-branded territory. They still bind their own host in Admin Settings → Domain. Super Admin stays on axal.vc and app.axal.vc.'],
  ['white_label', 'Same subsidiary console, their brand, no HQ brand desk. Members land on a platform host at activation; their admin binds a custom one later, in Settings → Domain. Super Admin stays on axal.vc.'],
]);

/* ---------------------------------------------------------------- step 2 */

/** A country's name where the platform knows it (the 27 EU states), else its code. */
export const countryName = (code) => EU_27[code] || code;

/** The countries the step offers as chips: the EU 27 by name. Any other ISO code is added by hand. */
export const TERRITORY_CHOICES = Object.freeze([...EU_CODES].sort((a, b) => EU_27[a].localeCompare(EU_27[b], 'en')));

/** The "Add a country" field: one ISO 3166-1 alpha-2 code, the shape `PUT /:uid/territories` admits. */
export function readCountryCode(text) {
  const t = String(text ?? '').trim().toUpperCase();
  if (!t) return { ok: false, message: 'Enter a two-letter country code, such as CH' };
  if (!/^[A-Z]{2}$/.test(t)) return { ok: false, message: 'A country is its two-letter ISO code, such as CH' };
  return { ok: true, code: t };
}

/** The codes a draft holds, as the step starts from them. */
export const codesOf = (licence) => (Array.isArray(licence?.territories) ? licence.territories.map((c) => String(c).toUpperCase()) : []);

/** Who holds each country, other than this licence: keeping your own country is not a conflict. */
export function heldByOthers(held, uid) {
  const m = new Map();
  for (const h of held || []) {
    if (!h || !h.country_code || (uid && h.licence_uid === uid)) continue;
    m.set(String(h.country_code).toUpperCase(), h);
  }
  return m;
}

/** The chosen countries another licence holds, each with its holder. Suspended and draft holders count. */
export function territoryConflicts(codes, held, uid) {
  const others = heldByOthers(held, uid);
  return (codes || []).filter((c) => others.has(c)).map((code) => {
    const h = others.get(code);
    return { code, name: countryName(code), holder: { uid: h.licence_uid || null, ref: h.licence_ref || null, name: h.brand_name || h.licence_ref || 'Another licence', status: h.status || null } };
  });
}

/** A conflict's heading, as L21 draws it: "Austria is already held". */
export const conflictTitle = (c) => `${c.name} is already held`;

/**
 * A conflict's sentence, as L21 draws it, naming the holder: "<holder> holds Austria (suspended licences still
 * hold their countries). Overlapping territories are refused; remove Austria or terminate the other licence first."
 * A holder that is not active says its state, so a suspended one reads as suspended.
 */
export function conflictSentence(c) {
  const who = c.holder.status && c.holder.status !== 'active' ? `${c.holder.name} (${c.holder.status})` : c.holder.name;
  return `${who} holds ${c.name} (suspended licences still hold their countries). Overlapping territories are refused; remove ${c.name} or terminate the other licence first.`;
}

/**
 * Continue on step 2: what it may send, or why it is off. Off while a chosen country is held by another licence,
 * and with no country chosen (issuing needs one).
 */
export function territoryPlan(codes, conflicts) {
  if (!codes?.length) return { ok: false, why: 'Choose at least one country. Issuing needs one.' };
  if (conflicts?.length) return { ok: false, why: `Remove ${conflicts.map((c) => c.name).join(', ')} to continue.` };
  return { ok: true, countries: [...codes] };
}

/**
 * The Worker's answer to a territory save that failed, read: `conflict` (409 `territory_conflict`, its own sentence,
 * "AT is held by <ref> (suspended)"), `unknown` (no answer: it may have saved) or `refused` (its sentence).
 */
export function territoryRefusal(e) {
  if (e?.code === 'territory_conflict' || (e?.status === 409 && Array.isArray(e?.data?.conflicts))) {
    return { kind: 'conflict', message: refusalSentence(e, 'Another licence holds one of these countries.'), conflicts: Array.isArray(e?.data?.conflicts) ? e.data.conflicts : [] };
  }
  if (outcomeOfError(e) === 'unknown') return { kind: 'unknown', message: 'No answer came back, so the territory may or may not have been saved. Check before trying again.' };
  return { kind: 'refused', message: refusalSentence(e, 'The territory was not saved.') };
}
