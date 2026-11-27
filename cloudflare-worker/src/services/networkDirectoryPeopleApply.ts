/**
 * D7674 part 4 (#7674): the people-only controlled apply of a reviewed #7672 directory manifest.
 *
 * The owner's answer B (2026-11-27) lets signed-in members read a professional-only projection of people: name,
 * a `linkedin.com/in/` profile, geography, sectors and affiliations. This file accepts exactly those source
 * columns and nothing else. A contact-shaped column or value (email, phone, address, a personal site) is refused
 * with a count, never dropped silently, as the organisation contract refuses a disallowed field (part 2); a LinkedIn
 * cell must be `https://(www.)linkedin.com/in/<slug>` and nothing looser. The organisation route keeps refusing
 * people, and this route refuses a record reviewed as an organisation (`organisation_records_refused`): only the
 * Folk organisations a person's reviewed `Companies` cell names come in here, as affiliation targets.
 *
 * Everything after the envelope is the organisation apply's own machinery (`networkDirectoryApply.ts`): the server
 * re-plans with the landed planner, holds the plan to the reviewed run, applies idempotent batches from durable
 * checkpoints, reads every count back before completion, and is held in production by the same
 * `PRODUCTION_APPLY_HELD`. No SQL is accepted, nothing is published, and no account, membership, relationship,
 * notice or outreach is created. No employment is inferred: an affiliation is the source's association, its
 * currentness unknown until a reviewer records it.
 */
import type { Env } from '../types';
import { DirectoryRefusal } from './networkDirectory';
import { canonical, type DirectoryPlan } from '../../../scripts/lib/networkDirectoryPlan.mjs';
import {
  APPLY_LIMITS, CONTACT_FIELD, EMAIL_VALUE, PERSON_ROW_KEYS, RECORD_KEYS, ROW_KEYS, applyPlan, envelopeBase, isObject, replanReviewed, strings,
  type ApplyEnvelope, type ApplyResult,
} from './networkDirectoryApply';

export const PEOPLE_APPLY_CONTRACT = 'network-directory-people-apply-v1';

/**
 * The professional columns each source may upload for a person, from D7672's mapping table, cut to the owner's
 * list. Airtable: name, headquarters (geography), sector focus, LinkedIn. Folk: the person's name and its parts,
 * `Urls` (accepted only as a strict LinkedIn profile), industry (sectors), `Companies` and `Job title` (the
 * affiliation and its title). Stage, type, investing status, previous investments and every website stay out.
 */
export const PEOPLE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  airtable_angels: Object.freeze(['Name', 'Headquarters', 'Sector Focus', 'LinkedIn']),
  folk_french_vcs: Object.freeze(['Person', 'First name', 'Last name', 'Urls', 'Industry', 'Companies', 'Job title']),
});
/** The column holding the person's LinkedIn profile, per source. */
const PROFILE_FIELD: Readonly<Record<string, string>> = Object.freeze({ airtable_angels: 'LinkedIn', folk_french_vcs: 'Urls' });

/** A personal LinkedIn profile, and nothing looser: https, linkedin.com (or www.), `/in/` and one slug. */
export const LINKEDIN_PROFILE = /^https:\/\/(?:www\.)?linkedin\.com\/in\/(?:[A-Za-z0-9-]|%[0-9A-Fa-f]{2}){3,100}\/?$/;
/** A column whose name reads as a contact channel or a personal site. Checked only for columns outside the mapping. */
const PEOPLE_CONTACT_FIELD = new RegExp(`${CONTACT_FIELD.source}|web\\s?site|homepage|\\bsite\\b|\\burl\\b|\\blinks?\\b|blog|instagram|facebook|skype|signal`, 'i');
/** A phone number: nine or more digits with separators, not inside a longer word. */
const PHONE_VALUE = /(?<![\w])\+?\d[\d\s().-]{7,}\d(?![\w])/;
/** A link in a cell that is not the profile column, or a link in the profile column that is not LinkedIn: a personal site. */
const SITE_VALUE = /https?:\/\/|\bwww\./i;
/** The keys a reviewed Folk organisation (an affiliation target) carries in `manifest.organizations`. */
const ORGANISATION_DECISION_KEYS = new Set(['source', 'source_organization_key', 'name', 'website', 'disposition', 'reasons']);

const refuse = (status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) =>
  new DirectoryRefusal(status, code, sentence, extra);

const PEOPLE_ONLY = 'Only person records are applied here. A record reviewed as an organisation uploads through the organisation route; nothing was written.';
const MANIFEST_INVALID = 'The review manifest is not a version 1 manifest in the expected shape. Nothing was written.';

/** Each cell value a contact rule reads: a string, or the strings of a list. */
const cellStrings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const contactValue = (s: string) => EMAIL_VALUE.test(s) || PHONE_VALUE.test(s);

/**
 * The people envelope: the shared checks, then every record and manifest cell held to the professional mapping.
 * Every offending cell is counted before anything is refused, and the refusal carries the counts, never a value
 * or a column name. Pure: reads no database.
 */
export function peopleEnvelope(body: Record<string, unknown>, env: Pick<Env, 'ENVIRONMENT'>): ApplyEnvelope {
  const { target, snapshot, plan, records, manifest, max_batches } = envelopeBase(body, env, PEOPLE_APPLY_CONTRACT, 'person');
  const counts = { contact_fields: 0, fields_not_permitted: 0, invalid_linkedin_urls: 0 };
  const touched = { contact: new Set<number>(), field: new Set<number>(), linkedin: new Set<number>() };
  const identities = new Set<string>();
  const folkCompanies = new Set<string>();
  records.forEach((r, i) => {
    if (!isObject(r) || Object.keys(r).some(k => !RECORD_KEYS.has(k)) || !isObject(r.raw_fields)) {
      throw refuse(400, 'records_invalid', `Send 1 to ${APPLY_LIMITS.MAX_RECORDS} person records.`);
    }
    const allowed = typeof r.source === 'string' && Object.hasOwn(PEOPLE_FIELDS, r.source) ? PEOPLE_FIELDS[r.source] : null;
    if (!allowed) throw refuse(422, 'source_not_people_mapped', 'That source has no professional people mapping. Nothing was written.');
    for (const [field, value] of Object.entries(r.raw_fields as Record<string, unknown>)) {
      if (!allowed.includes(field)) {
        if (PEOPLE_CONTACT_FIELD.test(field) || cellStrings(value).some(contactValue)) { counts.contact_fields++; touched.contact.add(i); }
        else { counts.fields_not_permitted++; touched.field.add(i); }
        continue;
      }
      if (field === PROFILE_FIELD[r.source as string]) {
        if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) continue;
        if (typeof value === 'string' && (contactValue(value) || (SITE_VALUE.test(value) && !/linkedin\.com/i.test(value)))) {
          counts.contact_fields++; touched.contact.add(i); continue;
        }
        if (typeof value !== 'string' || !LINKEDIN_PROFILE.test(value.trim())) { counts.invalid_linkedin_urls++; touched.linkedin.add(i); }
        continue;
      }
      if (cellStrings(value).some(s => contactValue(s) || SITE_VALUE.test(s))) { counts.contact_fields++; touched.contact.add(i); }
    }
    if (r.source === 'folk_french_vcs' && Array.isArray((r.raw_fields as any).Companies)) {
      for (const c of (r.raw_fields as any).Companies) if (typeof c === 'string') folkCompanies.add(c.trim());
    }
    identities.add(canonical([r.source, r.source_record_id]));
  });
  // A manifest carries review decisions, never a contact value: an email anywhere in it is counted too.
  const manifestContacts = strings(manifest).filter(s => EMAIL_VALUE.test(s)).length;
  counts.contact_fields += manifestContacts;
  for (const row of Array.isArray(manifest.rows) ? manifest.rows : []) {
    if (isObject(row) && typeof row.title === 'string' && (contactValue(row.title) || SITE_VALUE.test(row.title))) counts.contact_fields++;
  }
  const extra = { ...counts, records_affected: new Set([...touched.contact, ...touched.field, ...touched.linkedin]).size };
  if (counts.contact_fields) {
    throw refuse(422, 'contact_field_refused', 'The upload carries contact fields (an email, a phone number, an address or a personal site). People are uploaded with professional fields only (owner answer B, 2026-11-27); remove them. Nothing was written.', extra);
  }
  if (counts.fields_not_permitted) {
    throw refuse(422, 'field_not_permitted', 'The upload carries a column outside the professional people mapping. Remove it before upload. Nothing was written.', extra);
  }
  if (counts.invalid_linkedin_urls) {
    throw refuse(422, 'linkedin_url_invalid', 'A LinkedIn cell is not a personal profile link of the form https://linkedin.com/in/<name>. Correct or remove it. Nothing was written.', extra);
  }
  for (const g of Array.isArray(manifest.duplicate_channel_groups) ? manifest.duplicate_channel_groups : []) {
    if (!isObject(g) || g.channel_type !== 'linkedin') {
      throw refuse(422, 'contact_field_refused', 'Only a LinkedIn channel review is accepted; contact channels are never uploaded. Nothing was written.', { ...counts, contact_fields: 1, records_affected: 0 });
    }
  }
  if (manifest.organizations !== undefined && !Array.isArray(manifest.organizations)) throw refuse(400, 'manifest_invalid', MANIFEST_INVALID);
  for (const o of (manifest.organizations ?? []) as unknown[]) {
    if (!isObject(o) || Object.keys(o).some(k => !ORGANISATION_DECISION_KEYS.has(k))) throw refuse(400, 'manifest_invalid', MANIFEST_INVALID);
    // An affiliation target only: a Folk organisation a reviewed person's Companies cell names.
    if (o.source !== 'folk_french_vcs' || typeof o.source_organization_key !== 'string' || !folkCompanies.has(o.source_organization_key.trim())) {
      throw refuse(422, 'organisation_records_refused', PEOPLE_ONLY);
    }
    if (typeof o.website === 'string' && /linkedin\.com\/in\//i.test(o.website)) {
      throw refuse(422, 'contact_field_refused', 'An organisation website is a personal profile link. Nothing was written.', { ...counts, contact_fields: 1, records_affected: 0 });
    }
  }
  const decisions = new Set<string>();
  for (const row of manifest.rows as unknown[]) {
    if (!isObject(row)) throw refuse(400, 'manifest_invalid', MANIFEST_INVALID);
    if (row.entity_kind !== 'person') throw refuse(422, 'organisation_records_refused', PEOPLE_ONLY);
    if (Object.keys(row).some(k => !ROW_KEYS.has(k) && !PERSON_ROW_KEYS.has(k))) throw refuse(400, 'manifest_invalid', MANIFEST_INVALID);
    decisions.add(canonical([row.source, row.source_record_id]));
  }
  for (const k of identities) {
    if (!decisions.has(k)) throw refuse(422, 'record_unreviewed', 'A record has no reviewed person row in the manifest. An unclassified record could be an organisation, so nothing was written.');
  }
  for (const k of decisions) if (!identities.has(k)) throw refuse(400, 'manifest_invalid', MANIFEST_INVALID);
  return { target_environment: target, records, manifest, snapshot, plan, max_batches };
}

/**
 * The people contract's re-plan, a second check behind the envelope: no uploaded record became an organisation
 * (only reviewed Folk affiliation targets are organisations), and every person's planned profile is a strict
 * LinkedIn profile or nothing.
 */
export async function replanPeople(input: ApplyEnvelope): Promise<DirectoryPlan> {
  const plan = await replanReviewed(input);
  if (plan.summary.organizations !== plan.summary.derived_organizations.accepted) throw refuse(422, 'organisation_records_refused', PEOPLE_ONLY);
  for (const b of plan.batches) for (const s of b.statements) {
    if (!/^INSERT INTO network_directory_entries\b/.test(s.sql)) continue;
    // The entry statement's parameters: uid, kind, source, source row id, name, first, last, profile, website.
    const [, kind, , , , , , profile, website] = s.params;
    if (kind === 'person' && ((profile !== null && !LINKEDIN_PROFILE.test(String(profile))) || website !== null)) {
      throw refuse(422, 'linkedin_url_invalid', 'A planned profile is not a personal LinkedIn profile link. Nothing was written.');
    }
  }
  return plan;
}

/** Re-plan, then the shared idempotent, resumable apply with read-back (D7674 part 2). */
export async function applyPeopleManifest(env: Env, input: ApplyEnvelope): Promise<ApplyResult> {
  return applyPlan(env, input, await replanPeople(input));
}
