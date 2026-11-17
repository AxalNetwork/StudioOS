/** D6562: freeze contractual inputs alongside rendered text, compare recorded values and expose the five replacement readiness fields. */
import type { Env } from '../types';
import type { LicenceRow } from './licenceLedgerCore';
import { CORE_TERM_KEYS, LICENCE_TERM_KEYS, readLicenceTerms } from './licenceTerms';
import { currentTerms } from './licenceExclusivity';

export type AgreementSnapshot = { version: 1; terms_revision: number; schedule_revision: number; values: Record<string, unknown> };
export async function agreementInputs(env: Env, licence: LicenceRow) {
  const [territories, seats, schedule, exclusivity] = await Promise.all([
    env.DB.prepare('SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code').bind(licence.id).all<{country_code:string}>(),
    env.DB.prepare('SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ? ORDER BY seat_type').bind(licence.id).all<{seat_type:string; seats_licensed:number}>(),
    readLicenceTerms(env, licence.uid), currentTerms(env, licence.uid),
  ]);
  if (!territories.success || !seats.success) throw new Error('agreement_inputs_unreadable');
  const countries = (territories.results || []).map(t => t.country_code);
  const seatRows = seats.results || [];
  const contractualExclusivity = exclusivity && exclusivity.contractual && ['in_force','at_risk'].includes(exclusivity.state)
    ? { scope_type: exclusivity.scope_type, countries: exclusivity.territory.countries, regions: exclusivity.territory.regions,
      starts_on: exclusivity.starts_on, ends_on: exclusivity.ends_on, review_on: exclusivity.review_on,
      cure_period_days: exclusivity.cure_period_days, targets: exclusivity.targets } : null;
  const values: Record<string, unknown> = {};
  for (const key of [...CORE_TERM_KEYS,'legal_entity_name','brand_name','registered_address','signatory_name','signatory_title'] as const) values[key] = (licence as any)[key] ?? null;
  values.territory = countries;
  for (const seat of seatRows) values[`seats.${seat.seat_type}`] = seat.seats_licensed;
  for (const key of LICENCE_TERM_KEYS) values[`schedule.${key}`] = schedule?.terms[key] ?? null;
  values.exclusivity = contractualExclusivity;
  const snapshot: AgreementSnapshot = {version:1, terms_revision:Number((licence as any).terms_revision ?? 0), schedule_revision:schedule?.revision ?? 0,values};
  return { snapshot, countries, seats:seatRows, terms:schedule?.terms ?? null, exclusivity:contractualExclusivity };
}
export function parseAgreementSnapshot(raw: unknown): AgreementSnapshot | null {
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (s?.version !== 1 || !Number.isSafeInteger(s.terms_revision) || s.terms_revision < 0 || !Number.isSafeInteger(s.schedule_revision) || s.schedule_revision < 0 || !s.values || typeof s.values !== 'object' || Array.isArray(s.values)) return null;
    // A truncated snapshot must not pass as a comparable or sendable document.
    for (const key of [...CORE_TERM_KEYS,'legal_entity_name','brand_name','registered_address','signatory_name','signatory_title','territory','exclusivity',...LICENCE_TERM_KEYS.map(k=>`schedule.${k}`)]) if (!(key in s.values)) return null;
    return s;
  } catch { return null; }
}
export function compareAgreementTerms(stored: AgreementSnapshot | null, current: AgreementSnapshot | null) {
  if (!stored || !current) return null;
  const changed = [...new Set([...Object.keys(stored.values),...Object.keys(current.values)])]
    .filter(key=>JSON.stringify(stored.values[key] ?? null)!==JSON.stringify(current.values[key] ?? null));
  return {differs:changed.length>0,changed_terms:changed.length,fields:changed};
}
export function agreementReadiness(snapshot: AgreementSnapshot | null) {
  const v=snapshot?.values;
  const present=(key:string)=>typeof v?.[key]==='string' && String(v[key]).trim().length>0;
  const commercial=!!v && ['term_years','annual_fee_cents','revenue_share_bps','token_split_bps'].every(k=>typeof v[k]==='number') && present('currency') && present('starts_on') && present('renews_on');
  const rows=[['legal_entity','Legal entity',present('legal_entity_name')],['territory','Territory',Array.isArray(v?.territory)&&v.territory.length>0],
    ['commercial_terms','Commercial terms',commercial],['governing_law','Governing law',present('schedule.governing_law')],['signatory_title','Signatory title',present('signatory_title')]] as const;
  return {ready:rows.every(r=>r[2]),fields:rows.map(([key,label,ready])=>({key,label,state:ready?'ready':'not_recorded',reason:ready?null:'Not recorded',fix:'terms'}))};
}
