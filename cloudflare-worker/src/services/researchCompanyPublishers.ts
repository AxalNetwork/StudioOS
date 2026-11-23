/** D7810 (#7810): all stored company records grouped by their exact publisher, with reviewed reference terms kept separate from stored licence strings. */
import type { Env } from '../types';
export function companyPublishersLabel(names: readonly string[]) {
  const publishers = [
    ...new Set(names.map((name) => name.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'en'));
  return `company records from ${publishers.length} publishers${publishers.length ? `: ${publishers.join(', ')}` : ''}`;
}
export async function readCompanyPublishers(env: Pick<Env, 'DB'>) {
  // One grouped read. Deliberately all stored rows, including any held or withdrawn record; this is a provenance inventory, not a served-company total.
  const rows = await env.DB.prepare(
    `SELECT d.source_name,COUNT(*) AS record_count,MAX(d.as_of) AS latest_as_of,
  json_group_array(DISTINCT d.source_license) AS stored_licences_json,
  SUM(CASE WHEN d.source_name='Wikidata' AND NOT (d.source_url GLOB 'https://www.wikidata.org/wiki/?*' OR d.source_url GLOB 'https://wikidata.org/wiki/?*') THEN 1 ELSE 0 END) AS wikidata_non_record_links,
  p.publisher,p.licence_id,p.licence_name,p.licence_link,p.required_attribution,p.evidence_link,p.terms_reviewed_on
  FROM research_company_directory d LEFT JOIN research_company_publishers p ON p.source_name=d.source_name GROUP BY d.source_name ORDER BY d.source_name`,
  ).all<any>();
  const publishers = (rows.results || []).map(
    ({ stored_licences_json, ...row }) => ({
      ...row,
      stored_licences: JSON.parse(stored_licences_json).sort(),
      terms_state: row.publisher ? 'reviewed' : 'licence terms not reviewed',
    }),
  );
  return {
    scope: 'all stored company records',
    label: companyPublishersLabel(publishers.map((row) => row.source_name)),
    publishers,
    record_count: publishers.reduce(
      (n, row) => n + Number(row.record_count),
      0,
    ),
    wikidata_non_record_links: publishers.reduce(
      (n, row) => n + Number(row.wikidata_non_record_links),
      0,
    ),
  };
}
