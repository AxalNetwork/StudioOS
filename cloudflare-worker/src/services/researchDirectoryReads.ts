/** D7713 (#7713) groups company placement by raw labels and reads a sorted page of members by UID. */
import type { Env } from '../types';
import { loadOverrides, mapCompanyCountry, mapCompanySector } from './researchTaxonomy';

interface RawGroup { sector: string | null; country: string | null; count: number; newest?: string | null }
export interface CompanyGroup extends RawGroup { markets: string[]; code: string | null }

/** Only the country detail needs a date. Other routes can count from the covering index alone. */
export async function companyGroups(env: Env, withDates = false) {
  const [overrides, grouped] = await Promise.all([
    loadOverrides(env),
    withDates
      ? env.DB.prepare(`SELECT sector, country, COUNT(*) AS count, MAX(as_of) AS newest
          FROM research_company_directory GROUP BY sector, country`).all<RawGroup>()
      : env.DB.prepare(`SELECT sector, country, COUNT(*) AS count
          FROM research_company_directory GROUP BY sector, country`).all<RawGroup>(),
  ]);
  const sectors = new Map<string, string[]>();
  const countries = new Map<string, string | null>();
  const groups = (grouped.results || []).map((row): CompanyGroup => {
    // The crosswalk treats NULL as the empty label, but SQL membership and displayed raw labels preserve both.
    const sector = row.sector ?? '';
    const country = row.country ?? '';
    if (!sectors.has(sector)) sectors.set(sector, mapCompanySector(sector, overrides).targets);
    if (!countries.has(country)) countries.set(country, mapCompanyCountry(country, overrides).targets[0] ?? null);
    return { ...row, markets: sectors.get(sector)!, code: countries.get(country)! };
  });
  return { groups, overrides };
}

interface NameKey { uid: string; name: string; group_index: number }
interface HeadcountKey extends NameKey { employee_count: number | null }
export interface CompanyRow {
  uid: string; name: string; website: string; country: string | null; founded_year: number | null; sector: string | null;
}
interface PageRow extends CompanyRow {
  employee_count: number | null; employee_as_of: string | null; last_funding_amount: number | null;
  last_funding_currency: string | null; last_funding_date: string | null; last_funding_type: string | null;
  as_of: string; source_url: string;
}

// Same locale and sensitivity as the Markets comparator. Build the collation rules once per isolate.
const nameCollator = new Intl.Collator('en', { sensitivity: 'base' });
export const directoryNameOrder = (a: { name: string }, b: { name: string }) => nameCollator.compare(a.name, b.name);
export const byHeadcount = (a: Pick<HeadcountKey, 'employee_count' | 'name'>, b: Pick<HeadcountKey, 'employee_count' | 'name'>) =>
  (b.employee_count ?? -1) - (a.employee_count ?? -1) || directoryNameOrder(a, b);

/**
 * Fetch just the matching sort keys. Rowid order reproduces the previous table scan for stable comparator ties.
 * The bound pair's ordinal is the tie key for breakdowns: labels with equal counts and collation retain the
 * order in which a member first appeared. The sector breakdown used the unsorted members.
 */
export async function companyPage(env: Env, groups: CompanyGroup[], kind: 'market' | 'country' | 'sector') {
  if (!groups.length) return { rows: [], orderedGroups: [] };
  const pairs = JSON.stringify(groups.map(({ sector, country }) => [sector, country]));
  let keys: NameKey[];
  let groupOrder: Set<number>;
  if (kind === 'country') {
    const { results } = await env.DB.prepare(
      `SELECT uid, name, employee_count, labels.key AS group_index
         FROM json_each(?) AS labels CROSS JOIN research_company_directory AS d
        WHERE d.sector IS json_extract(labels.value, '$[0]') AND d.country IS json_extract(labels.value, '$[1]')
        ORDER BY d.rowid`,
    ).bind(pairs).all<HeadcountKey>();
    keys = (results || []).sort(byHeadcount);
    groupOrder = new Set(keys.map((key) => key.group_index));
  } else {
    const { results } = await env.DB.prepare(
      `SELECT uid, name, labels.key AS group_index
         FROM json_each(?) AS labels CROSS JOIN research_company_directory AS d
        WHERE d.sector IS json_extract(labels.value, '$[0]') AND d.country IS json_extract(labels.value, '$[1]')
        ORDER BY d.rowid`,
    ).bind(pairs).all<NameKey>();
    keys = results || [];
    if (kind === 'sector') {
      groupOrder = new Set(keys.map((key) => key.group_index));
      keys.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      keys.sort(directoryNameOrder);
      groupOrder = new Set(keys.map((key) => key.group_index));
    }
  }
  // Counts belong to the grouped read, even if a member disappears before the sort-key read.
  for (let i = 0; i < groups.length; i++) groupOrder.add(i);
  const orderedGroups = Array.from(groupOrder, (i) => groups[i]);
  const uids = keys.slice(0, 50).map((key) => key.uid);
  const { results } = await env.DB.prepare(
    `SELECT d.uid, d.name, d.website, d.country, d.founded_year, d.sector, d.employee_count, d.employee_as_of,
            d.last_funding_amount, d.last_funding_currency, d.last_funding_date, d.last_funding_type, d.as_of, d.source_url
       FROM json_each(?) AS page CROSS JOIN research_company_directory AS d WHERE d.uid = page.value ORDER BY page.key`,
  ).bind(JSON.stringify(uids)).all<PageRow>();
  return { rows: results || [], orderedGroups };
}
