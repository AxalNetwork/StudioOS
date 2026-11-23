/** D6703 (#6703): minimal formation intake values, with the store behind each prefilled field. */
import type { Env } from '../types';
import { COUNTRY_ALIASES } from './researchTaxonomy';

// ISO 3166-1 alpha-2 codes. DisplayNames supplies names, never city-to-country guesses.
const ISO_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const countryCodes = new Map(ISO_CODES.flatMap(code => [[code.toLowerCase(), code], [names.of(code)!.toLowerCase(), code]]));
// Preserve the names used by the platform's country picker and common country abbreviations.
for (const key of ['czech republic', 'south korea', 'north korea', 'russia', 'turkey', 'united states', 'united kingdom', 'uk']) {
  if (COUNTRY_ALIASES[key]) countryCodes.set(key, COUNTRY_ALIASES[key]);
}

export function formationCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return countryCodes.get(value.trim().toLowerCase()) ?? null;
}

export type IntakeFounder = { user_id: number; name: string; residence_country: string | null; nationality: string | null };
export type FormationPrefill = {
  values: { project: { id: number; name: string } | null; company_name: string | null; founders: IntakeFounder[]; project_members: unknown[]; company_members: unknown[]; officers: unknown[];
    locations: unknown[]; operating_countries: string[]; cap_table: { uid: string; inputs: unknown } | null };
  provenance: Record<string, string>;
};

export async function formationPrefill(env: Env, subject: { project_id: number | null; company_id: number | null }): Promise<FormationPrefill> {
  const provenance: Record<string, string> = {};
  const values: FormationPrefill['values'] = { project: null, company_name: null, founders: [], project_members: [], company_members: [], officers: [], locations: [], operating_countries: [], cap_table: null };
  const project = subject.project_id == null ? null : await env.DB.prepare(
    'SELECT id, name, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL',
  ).bind(subject.project_id).first<{ id: number; name: string; founder_id: number | null; company_id: number | null }>();
  const companyId = subject.company_id ?? project?.company_id ?? null;
  if (project) {
    values.project = { id: project.id, name: project.name };
    provenance.project = 'projects';
    values.company_name = project.name;
    provenance.company_name = 'projects.name';
    const members = (await env.DB.prepare(
      `SELECT u.id AS user_id, u.name, u.country, u.nationality FROM users u
        WHERE u.founder_id = ? OR u.id IN (SELECT user_id FROM project_members
          WHERE project_id = ? AND status = 'accepted' AND removed_at IS NULL AND role IN ('founder', 'cofounder')) ORDER BY u.id`,
    ).bind(project.founder_id, project.id).all<IntakeFounder & { country: string | null }>()).results || [];
    values.founders = members.map((member, index) => {
      provenance[`founders.${index}.user_id`] = 'users.id';
      provenance[`founders.${index}.name`] = 'users.name';
      provenance[`founders.${index}.residence_country`] = 'users.country';
      provenance[`founders.${index}.nationality`] = 'users.nationality';
      return { user_id: member.user_id, name: member.name, residence_country: formationCountry(member.country), nationality: formationCountry(member.nationality) };
    });
    values.project_members = (await env.DB.prepare(
      "SELECT user_id, role FROM project_members WHERE project_id = ? AND status = 'accepted' AND removed_at IS NULL ORDER BY user_id",
    ).bind(project.id).all()).results || [];
    provenance.project_members = 'project_members';
    const cap = await env.DB.prepare(
      'SELECT uid, inputs_json FROM cap_table_scenarios WHERE project_id = ? AND is_variant = 0 ORDER BY id LIMIT 1',
    ).bind(project.id).first<{ uid: string; inputs_json: string }>();
    if (cap) { values.cap_table = { uid: cap.uid, inputs: JSON.parse(cap.inputs_json) }; provenance.cap_table = 'cap_table_scenarios.inputs_json'; }
  }
  if (companyId != null) {
    const company = await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(companyId).first<{ company_name: string }>();
    if (company) { values.company_name = company.company_name; provenance.company_name = 'company_profiles.company_name'; }
    {
      const members = (await env.DB.prepare(
        `SELECT u.id AS user_id, u.name, u.country, u.nationality, u.founder_id, l.role_in_company FROM user_company_links l
          JOIN users u ON u.id = l.user_id WHERE l.company_id = ? ORDER BY u.id`,
      ).bind(companyId).all<IntakeFounder & { country: string | null; role_in_company: string; founder_id: number | null }>()).results || [];
      values.company_members = members.map(m => ({ user_id: m.user_id, role: m.role_in_company }));
      provenance.company_members = 'user_company_links';
      if (!project) values.founders = members.filter(m => m.role_in_company === 'Founder' || m.role_in_company === 'Owner' || m.founder_id != null).map((m, index) => {
        provenance[`founders.${index}.user_id`] = 'users.id'; provenance[`founders.${index}.name`] = 'users.name';
        provenance[`founders.${index}.residence_country`] = 'users.country'; provenance[`founders.${index}.nationality`] = 'users.nationality';
        return { user_id: m.user_id, name: m.name, residence_country: formationCountry(m.country), nationality: formationCountry(m.nationality) };
      });
    }
    values.officers = (await env.DB.prepare(
      'SELECT uid, name, office, title FROM company_officers WHERE company_id = ? AND ceased_on IS NULL ORDER BY id',
    ).bind(companyId).all()).results || [];
    provenance.officers = 'company_officers';
    const locations = (await env.DB.prepare(
      'SELECT uid, kind, city, country FROM company_locations WHERE company_id = ? AND closed_on IS NULL ORDER BY id',
    ).bind(companyId).all<{ uid: string; kind: string; city: string | null; country: string }>()).results || [];
    values.locations = locations.map(location => ({ ...location, country: formationCountry(location.country) }));
    provenance.locations = 'company_locations';
    values.operating_countries = [...new Set(locations.map(l => formationCountry(l.country)).filter((c): c is string => c != null))];
    provenance.operating_countries = 'company_locations.country';
  }
  return { values, provenance };
}
