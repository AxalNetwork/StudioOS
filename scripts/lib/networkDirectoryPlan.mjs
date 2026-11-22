/** D7672 (#7672): deterministic, offline directory plan; source claims never grant access or establish a relationship. */
import { createHash } from 'node:crypto';

export const VERSION = 'network-directory-7672-v1';
export const SOURCES = Object.freeze({
  airtable_angels: { name: 'Airtable Angels directory', url: 'https://airtable.com/apph9tTMHZwV2BwWX/shrpsT1Tj9VtmdY7d/tblQIsXHKoY0EtXO7?backgroundColor=purple&viewControls=on' },
  folk_french_vcs: { name: 'Folk French VC directory', url: 'https://app.folk.app/shared/French-VC%27s-mD2puZZ9RyakVW7ATq6VaFaFme7Cjjf9' },
});
export const WRITE_TABLES = Object.freeze([
  'network_directory_sources', 'network_directory_import_runs', 'network_directory_entries',
  'network_directory_source_records', 'network_directory_private_sources', 'network_directory_import_rows',
  'network_directory_affiliations', 'network_directory_reviews',
]);

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const uid = (...parts) => hash(parts).slice(0, 32);
const str = (value, max = 10000) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const labels = value => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(v => str(v, 300)).filter(Boolean))].sort();
const key = (source, id) => canonical([source, id]);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const statement = (sql, ...params) => ({ sql, params });
const companyKeys = record => [...new Set((Array.isArray(record.raw_fields.Companies) ? record.raw_fields.Companies : [])
  .filter(v=>typeof v==='string' && v.trim() && v.length<=300))].sort();

/** Validates without fetching. Credentials, local/IP hosts and non-HTTP schemes are refused. */
export function professionalUrl(value, kind = null) {
  if (!str(value, 2049) || value.length > 2048) return null;
  try {
    let input=value.trim();
    if (/^(?:(?:www|[a-z]{2})\.)?linkedin\.com\//i.test(input)) input=`https://${input}`;
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (/^[a-z]{2}\.linkedin\.com$/.test(host)) host='linkedin.com';
    if (!host.includes('.') || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host) || /\.(local|localhost|internal|test|invalid)$/.test(host)) return null;
    if (kind) {
      if (kind==='organization' && /^\/company\/[^/]+\/mycompany\/?$/.test(url.pathname)) url.pathname=url.pathname.replace(/\/mycompany\/?$/,'');
      if (host !== 'linkedin.com' || !(kind === 'person' ? /^\/in\/[^/]+\/?$/ : /^\/company\/[^/]+\/?$/).test(url.pathname)) return null;
      url.pathname = url.pathname.toLowerCase();
    }
    url.protocol = 'https:'; url.hostname = host; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

const dispositionCounts = rows => ({ input: rows.length, accepted: rows.filter(r => r.disposition === 'accept').length,
  review: rows.filter(r => r.disposition === 'review').length, skipped: rows.filter(r => r.disposition === 'skip').length });

function normalized(record, decision) {
  const f = record.raw_fields || {};
  const folk = record.source === 'folk_french_vcs';
  const organization = !!record.derived_organization;
  const kind = decision?.entity_kind || (organization ? 'organization' : 'unknown');
  const reasons = labels(decision?.reasons);
  let disposition = decision?.disposition || 'review';
  if (!decision) reasons.push('classification_missing');
  if (!['accept', 'review', 'skip'].includes(disposition)) throw new Error('Invalid manifest disposition');
  if (!['person', 'organization', 'unknown'].includes(kind)) throw new Error('Invalid manifest entity kind');
  const name = str(organization ? record.display_name : folk ? f.Person : f.Name, 300);
  if (!name || kind === 'unknown') { disposition = disposition === 'skip' ? 'skip' : 'review'; reasons.push(!name ? 'name_missing' : 'entity_kind_unknown'); }
  const rawProfile = organization ? null : folk ? f.Urls : f.LinkedIn;
  const profile = ['none','review'].includes(decision?.linkedin_disposition) ? null : professionalUrl(rawProfile, kind);
  // An organization's personal LinkedIn can be a founder's page. Preserve it privately;
  // it is never its identity and never evidence of an affiliation.
  if (rawProfile && !profile) reasons.push('profile_url_not_entity_identity');
  const orgWebsite = organization ? decision.website : null;
  const website = professionalUrl(orgWebsite);
  if (orgWebsite && !website) { disposition = 'review'; reasons.push('organization_website_invalid'); }
  const investingRaw = str(f['Currently investing?']);
  const investing = investingRaw === 'Yes' ? 1 : investingRaw === 'No' ? 0 : null;
  return { record, decision: decision || {}, kind, disposition, reasons: labels(reasons),
    fields: { display_name: name, first_name: kind === 'person' && folk ? str(f['First name'], 300) : null,
      last_name: kind === 'person' && folk ? str(f['Last name'], 300) : null,
      profile_url: profile, website, geography: str(f.Headquarters, 500),
      roles: [], source_categories: labels(f.Type), sectors: labels(folk ? f.Industry : f['Sector Focus']), stages: labels(f['Investment Stage']),
      currently_investing: investing, previous_investments_raw: str(f['Previous Investments']),
    } };
}

const ENTRY_SQL = `INSERT INTO network_directory_entries
 (uid,kind,source_uid,source_external_id,display_name,first_name,last_name,profile_url,website,geography,roles_json,source_categories_json,sectors_json,stages_json,currently_investing,previous_investments_raw,observed_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(uid) DO UPDATE SET display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name,
 profile_url=excluded.profile_url,website=excluded.website,geography=excluded.geography,roles_json=excluded.roles_json,source_categories_json=excluded.source_categories_json,
 sectors_json=excluded.sectors_json,stages_json=excluded.stages_json,currently_investing=excluded.currently_investing,
 previous_investments_raw=excluded.previous_investments_raw,observed_at=excluded.observed_at
 WHERE network_directory_entries.kind=excluded.kind AND network_directory_entries.verification_status='unverified_source_claim'
 AND network_directory_entries.publication_status='staged' AND network_directory_entries.linked_user_id IS NULL AND network_directory_entries.linked_company_id IS NULL
 AND julianday(excluded.observed_at)>julianday(network_directory_entries.observed_at)`;

/** Returns parameterized, sequential, atomic-per-batch statements. Does not open a database. */
export function buildDirectoryPlan({ records, manifest }) {
  if (!Array.isArray(records) || records.length > 100000 || !manifest || manifest.version !== 1 || !Array.isArray(manifest.rows)) throw new Error('Expected records and a version 1 review manifest');
  const decisions = new Map();
  for (const row of manifest.rows) {
    const k = key(row.source, row.source_record_id);
    if (decisions.has(k)) throw new Error('Duplicate manifest source identity');
    decisions.set(k, row);
  }
  const organizationDecisions = new Map();
  for (const org of manifest.organizations || []) {
    if (!Object.hasOwn(SOURCES,org.source) || !str(org.source_organization_key, 300) || !str(org.name, 300)) throw new Error('Invalid organization review key');
    const k = key(org.source, org.source_organization_key);
    if (organizationDecisions.has(k)) throw new Error('Duplicate organization review key');
    organizationDecisions.set(k, org);
  }
  const organizationTimes = new Map();
  for (const r of records) {
    if (Object.hasOwn(r,'derived_organization') || Object.hasOwn(r,'decision')) throw new Error('Reserved source record properties');
    if (!Object.hasOwn(SOURCES,r.source) || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(r.source_record_id || '') || !r.raw_fields || typeof r.raw_fields !== 'object' || Array.isArray(r.raw_fields)) throw new Error('Invalid source record shape');
    if (typeof r.observed_at !== 'string' || Buffer.byteLength(canonical(r.raw_fields)) > 1024*1024) throw new Error('Invalid source observation or oversized row');
    const date = new Date(r.observed_at);
    if (!Number.isFinite(date.getTime())) throw new Error('Source observation date required');
    const time = date.toISOString();
    for(const name of companyKeys(r)) {
      const k=key(r.source,name);
      if(!organizationTimes.has(k) || time>organizationTimes.get(k))organizationTimes.set(k,time);
    }
  }
  const derived = [...organizationDecisions.values()].map(d => {
    const observedAt=organizationTimes.get(key(d.source,d.source_organization_key));
    if (!observedAt) throw new Error('Organization key has no source association');
    return { source: d.source, source_record_id: `organization:${d.source_organization_key}`, raw_fields: { Name: d.name },
      display_name: d.name, observed_at: observedAt, derived_organization: true, decision: { ...d, entity_kind: 'organization' } };
  });
  const rows = [...records, ...derived].map(r => normalized(r, r.derived_organization ? r.decision : decisions.get(key(r.source, r.source_record_id))));
  rows.sort((a,b) => compare(key(a.record.source,a.record.source_record_id),key(b.record.source,b.record.source_record_id))
    || compare(new Date(b.record.observed_at).toISOString(),new Date(a.record.observed_at).toISOString())
    || compare(canonical(a.record.raw_fields),canonical(b.record.raw_fields)));
  const identities = new Map();
  for (const row of rows) {
    const k = key(row.record.source, row.record.source_record_id);
    const prior = identities.get(k);
    if (prior) {
      if (canonical(prior.record.raw_fields) !== canonical(row.record.raw_fields)) {
        prior.disposition = 'review'; prior.reasons.push('conflicting_source_identity');
        row.disposition = 'review'; row.reasons.push('conflicting_source_identity');
      } else { row.disposition = 'skip'; row.reasons.push('repeated_input_row'); }
    } else identities.set(k, row);
  }
  // Exact identity collisions create review candidates, never automatic merges.
  const profiles = new Map();
  for (const row of rows.filter(r => r.disposition === 'accept' && r.fields.profile_url)) {
    const k = canonical([row.kind, row.fields.profile_url]);
    const group = profiles.get(k) || []; group.push(row); profiles.set(k,group);
  }
  const duplicateGroups = [...profiles.values()].filter(g => g.length > 1);
  for (const group of duplicateGroups) for (const row of group) { row.disposition = 'review'; row.reasons.push('duplicate_profile_identity'); }
  const occurrences = new Map();
  for (const row of rows) {
    const r = row.record;
    row.reasons = labels(row.reasons);
    row.contentHash = hash(r.raw_fields);
    row.decisionHash = hash({ kind: row.kind, disposition: row.disposition, reasons: row.reasons, fields: row.fields,
      affiliation: row.decision.affiliation_disposition || null, title: row.decision.title_disposition || null,
      has_title_override:Object.hasOwn(row.decision,'title'),title_override:row.decision.title ?? null });
    row.recordUid = uid('record',r.source,r.source_record_id,row.contentHash,row.decisionHash);
    row.entryUid = row.disposition === 'accept' ? uid('entry',r.source,r.source_record_id) : null;
    const k = key(r.source,r.source_record_id); const n = occurrences.get(k) || 0; occurrences.set(k,n+1);
    row.rowKey = canonical([r.source,r.source_record_id,n]);
  }
  const sourceRows = rows.filter(r => !r.record.derived_organization);
  const orgRows = rows.filter(r => r.record.derived_organization);
  const acceptedOrganizations = new Map(orgRows.filter(r => r.entryUid).map(r => [key(r.record.source, r.decision.source_organization_key), r]));
  const manifestHash = hash(manifest);
  const inputHash = hash([manifestHash,rows.map(r => [r.recordUid,r.rowKey,new Date(r.record.observed_at).toISOString()])]);
  const runUid = uid(VERSION,inputHash);
  const allCounts = dispositionCounts(rows);
  const prelude = [...new Set(rows.map(r => r.record.source))].sort().map(s => statement(
    'INSERT INTO network_directory_sources (uid,name,url) VALUES (?,?,?) ON CONFLICT(uid) DO NOTHING',s,SOURCES[s].name,SOURCES[s].url));
  prelude.push(statement(`INSERT INTO network_directory_import_runs (uid,planner_version,input_hash,input_count,accepted_count,review_count,skipped_count)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(uid) DO NOTHING`,runUid,VERSION,inputHash,allCounts.input,allCounts.accepted,allCounts.review,allCounts.skipped));
  const batches = [{ key:'prepare',statements:prelude }];
  let affiliationCount = 0, affiliationReviews = 0;
  // Organizations first: every association's targets exist before its atomic batch.
  const ordered = [...orgRows,...sourceRows];
  for (const row of ordered) {
    const r=row.record, f=row.fields, statements=[];
    if (row.entryUid) statements.push(statement(ENTRY_SQL,row.entryUid,row.kind,r.source,r.source_record_id,f.display_name,f.first_name,f.last_name,
      f.profile_url,f.website,f.geography,JSON.stringify(f.roles),JSON.stringify(f.source_categories),JSON.stringify(f.sectors),JSON.stringify(f.stages),f.currently_investing,f.previous_investments_raw,new Date(r.observed_at).toISOString()));
    statements.push(statement(`INSERT INTO network_directory_source_records
      (uid,source_uid,external_record_id,content_hash,decision_hash,entry_uid,entry_kind,disposition,reasons_json,claims_json,observed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO NOTHING`,row.recordUid,r.source,r.source_record_id,row.contentHash,row.decisionHash,row.entryUid,
      row.entryUid ? row.kind : null,row.disposition,JSON.stringify(row.reasons),canonical(f),new Date(r.observed_at).toISOString()));
    statements.push(statement('INSERT INTO network_directory_private_sources (source_record_uid,raw_json) VALUES (?,?) ON CONFLICT(source_record_uid) DO NOTHING',row.recordUid,canonical({fields:r.raw_fields,review:row.decision})));
    statements.push(statement('INSERT INTO network_directory_import_rows (run_uid,row_key,source_record_uid,observed_at) VALUES (?,?,?,?) ON CONFLICT(run_uid,row_key) DO NOTHING',runUid,row.rowKey,row.recordUid,new Date(r.observed_at).toISOString()));
    if(row.entryUid)statements.push(statement(`INSERT INTO network_directory_reviews (uid,source_record_uid,reason)
      SELECT ?,?,'equal_time_source_conflict' WHERE EXISTS (
        SELECT 1 FROM network_directory_source_records prior JOIN network_directory_import_rows seen ON seen.source_record_uid=prior.uid
        WHERE prior.source_uid=? AND prior.external_record_id=? AND prior.uid<>? AND prior.disposition<>'skip'
          AND julianday(seen.observed_at)=julianday(?) AND (prior.content_hash<>? OR prior.decision_hash<>?))
      ON CONFLICT(uid) DO NOTHING`,uid('equal-time-review',row.recordUid),row.recordUid,r.source,r.source_record_id,row.recordUid,new Date(r.observed_at).toISOString(),row.contentHash,row.decisionHash));
    if (row.disposition === 'review') statements.push(statement('INSERT INTO network_directory_reviews (uid,source_record_uid,reason) VALUES (?,?,?) ON CONFLICT(uid) DO NOTHING',uid('review',row.recordUid),row.recordUid,row.reasons.join('; ') || 'classification_review'));
    if (row.entryUid && row.kind === 'person' && r.source === 'folk_french_vcs') {
      for (const orgName of companyKeys(r)) {
        const org = acceptedOrganizations.get(key(r.source,orgName));
        if (!org || row.decision.affiliation_disposition !== 'accept_source_claim') {
          affiliationReviews++;
          statements.push(statement('INSERT INTO network_directory_reviews (uid,source_record_uid,reason) VALUES (?,?,?) ON CONFLICT(uid) DO NOTHING',uid('affiliation-review',row.recordUid,orgName),row.recordUid,'affiliation_requires_review'));
          continue;
        }
        const title = row.decision.title_disposition === 'review' ? null : Object.hasOwn(row.decision,'title') ? str(row.decision.title,500) : str(r.raw_fields['Job title'],500);
        statements.push(statement(`INSERT INTO network_directory_affiliations (uid,person_uid,organization_uid,source_record_uid,title,observed_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET source_record_uid=excluded.source_record_uid,title=excluded.title,observed_at=excluded.observed_at
          WHERE network_directory_affiliations.verification_status='unverified_source_claim'
          AND julianday(excluded.observed_at)>julianday(network_directory_affiliations.observed_at)`,
          uid('affiliation',row.entryUid,org.entryUid),row.entryUid,org.entryUid,row.recordUid,title,new Date(r.observed_at).toISOString()));
        affiliationCount++;
      }
    }
    batches.push({key:row.rowKey,statements});
  }
  const reviews=[];
  for (const group of duplicateGroups) for (let i=1;i<group.length;i++) reviews.push(statement(
    'INSERT INTO network_directory_reviews (uid,source_record_uid,candidate_record_uid,reason) VALUES (?,?,?,?) ON CONFLICT(uid) DO NOTHING',
    uid('duplicate',group[0].recordUid,group[i].recordUid),group[0].recordUid,group[i].recordUid,'duplicate_profile_identity'));
  for (const group of manifest.duplicate_channel_groups || []) {
    if (!['linkedin','email'].includes(group.channel_type) || !Array.isArray(group.records)) throw new Error('Invalid source channel review');
    const members=group.records.map(r=>identities.get(key(r.source,r.source_record_id)));
    if (members.some(r=>!r)) throw new Error('Source channel review names an unknown row');
    for(let i=1;i<members.length;i++)reviews.push(statement(
      'INSERT INTO network_directory_reviews (uid,source_record_uid,candidate_record_uid,reason) VALUES (?,?,?,?) ON CONFLICT(uid) DO NOTHING',
      uid('channel-review',group.channel_type,members[0].recordUid,members[i].recordUid),members[0].recordUid,members[i].recordUid,`shared_source_${group.channel_type}_review`));
  }
  if (reviews.length) batches.push({key:'duplicate-reviews',statements:reviews});
  batches.push({key:'complete',statements:[statement(`UPDATE network_directory_import_runs SET status='complete',completed_at=datetime('now')
    WHERE uid=? AND status='planned' AND input_count=(SELECT count(*) FROM network_directory_import_rows WHERE run_uid=?)`,runUid,runUid)]});
  const summary={ planner_version:VERSION,run_uid:runUid,review_manifest_hash:manifestHash,production_written:false,
    source_rows:dispositionCounts(sourceRows),derived_organizations:dispositionCounts(orgRows),all_staged_records:allCounts,
    people:rows.filter(r=>r.entryUid&&r.kind==='person').length,organizations:rows.filter(r=>r.entryUid&&r.kind==='organization').length,
    affiliations:affiliationCount,affiliations_needing_review:affiliationReviews,duplicate_identity_groups:duplicateGroups.length,source_channel_review_groups:(manifest.duplicate_channel_groups || []).length,
    by_source:Object.fromEntries(Object.keys(SOURCES).map(s=>[s,dispositionCounts(sourceRows.filter(r=>r.record.source===s))])),
    atomic_batches:batches.length,statements:batches.reduce((n,b)=>n+b.statements.length,0) };
  return { version:1,execution_contract:{sequential:true,atomic_per_batch:true,stop_on_error:true,operator_only:true},summary,batches };
}
