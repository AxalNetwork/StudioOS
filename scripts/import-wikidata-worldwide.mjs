#!/usr/bin/env node
/**
 * D7316 — worldwide Wikidata identity importer for Research > Companies.
 *
 * This is additive to migration 403. It queries one ISO country at a time,
 * applies the existing Research sector crosswalk, deduplicates deterministically,
 * and writes a reviewed SQL migration plus a JSON dry-run/coverage report.
 * It never opens D1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ENDPOINT, LICENCE, SOURCE_NAME, USER_AGENT, cleanText, pickWebsite,
  pickYear, sqlValue,
} from './import-wikidata-companies.mjs';
import { COMPANY_SECTOR_RULES, normalizeLabel } from '../cloudflare-worker/src/services/researchTaxonomy.ts';

export const DEFAULT_OUT='cloudflare-worker/sql/migrations/419_research_company_directory_worldwide.sql';
export const DEFAULT_REPORT='documentation/audits/research-companies-worldwide-coverage.json';
export const DEFAULT_TARGET=600;
export const MIN_TOTAL=25000;
export const MIN_COUNTRIES=50;
export const REGION_MIN={north_america:1000,europe:1000,asia:1000,latin_america:250,africa:250,middle_east:250,oceania:250};

export const COUNTRIES=[
 ['US','United States','north_america'],['CA','Canada','north_america'],['MX','Mexico','north_america'],
 ['GB','United Kingdom','europe'],['FR','France','europe'],['DE','Germany','europe'],['CH','Switzerland','europe'],
 ['NL','Netherlands','europe'],['SE','Sweden','europe'],['NO','Norway','europe'],['DK','Denmark','europe'],['FI','Finland','europe'],
 ['ES','Spain','europe'],['IT','Italy','europe'],['IE','Ireland','europe'],['EE','Estonia','europe'],['LV','Latvia','europe'],['LT','Lithuania','europe'],
 ['PL','Poland','europe'],['CZ','Czechia','europe'],['AT','Austria','europe'],['BE','Belgium','europe'],['PT','Portugal','europe'],['RO','Romania','europe'],
 ['CN','China','asia'],['IN','India','asia'],['JP','Japan','asia'],['KR','South Korea','asia'],['SG','Singapore','asia'],
 ['ID','Indonesia','asia'],['VN','Vietnam','asia'],['MY','Malaysia','asia'],['PH','Philippines','asia'],['TH','Thailand','asia'],
 ['AE','United Arab Emirates','middle_east'],['SA','Saudi Arabia','middle_east'],['IL','Israel','middle_east'],['TR','Türkiye','middle_east'],
 ['NG','Nigeria','africa'],['ZA','South Africa','africa'],['KE','Kenya','africa'],['EG','Egypt','africa'],['GH','Ghana','africa'],['MA','Morocco','africa'],['RW','Rwanda','africa'],
 ['BR','Brazil','latin_america'],['AR','Argentina','latin_america'],['CL','Chile','latin_america'],['CO','Colombia','latin_america'],['PE','Peru','latin_america'],['UY','Uruguay','latin_america'],
 ['AU','Australia','oceania'],['NZ','New Zealand','oceania'],
].map(([code,name,region])=>({code,name,region}));

const QID=/^Q[1-9]\d*$/;
const val=(b,k)=>b?.[k]?.value??null;
const qidOf=(v)=>/\/entity\/(Q[1-9]\d*)$/.exec(String(v??''))?.[1]??null;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

export function countryQuery(code,limit){
 if(!/^[A-Z]{2}$/.test(code)) throw new Error('bad ISO country code');
 if(!Number.isInteger(limit)||limit<1||limit>5000) throw new Error('bad limit');
 return `SELECT ?item ?name ?website ?inception ?industry ?industryLabel ?links WHERE {
 ?country wdt:P297 "${code}".
 ?item wdt:P17 ?country; wdt:P856 ?website; wdt:P452 ?industry; wikibase:sitelinks ?links; rdfs:label ?name.
 FILTER(LANG(?name)="en") FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
 ?industry rdfs:label ?industryLabel. FILTER(LANG(?industryLabel)="en")
 OPTIONAL { ?item wdt:P571 ?inception }
} ORDER BY DESC(?links) ?item LIMIT ${limit}`;
}

export function normalizeDomain(url){
 try { return new URL(url).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,''); } catch { return null; }
}
export function normalizeName(name){
 return cleanText(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
export function rowFromBinding(b,country,asOf){
 const uid=qidOf(val(b,'item')); const name=cleanText(val(b,'name'));
 const website=pickWebsite(new Set([val(b,'website')].filter(Boolean)));
 const sector=cleanText(val(b,'industryLabel')); const sectorKey=normalizeLabel(sector);
 if(!uid||!QID.test(uid)||!name||!website||!sector||!COMPANY_SECTOR_RULES[sectorKey]) return null;
 return {uid:uid.toLowerCase(),name,website,domain:normalizeDomain(website),country:country.name,country_code:country.code,
  founded_year:pickYear(new Set([val(b,'inception')].filter(Boolean)),Number(asOf.slice(0,4))),sector,
  source_name:SOURCE_NAME,source_url:`https://www.wikidata.org/wiki/${uid}`,source_license:LICENCE,as_of:asOf,
  region:country.region,links:Number(val(b,'links')||0)};
}
export function dedupe(rows,existing=[]){
 const uid=new Set(existing.map(x=>x.uid).filter(Boolean)),domain=new Set(existing.map(x=>x.domain).filter(Boolean)),
  nameCountry=new Set(existing.map(x=>x.nameCountry).filter(Boolean));
 const report={duplicate_by_id:0,duplicate_by_domain:0,duplicate_by_name_country:0}; const accepted=[];
 for(const r of rows){
  const nk=`${normalizeName(r.name)}|${r.country_code}`;
  if(uid.has(r.uid)){report.duplicate_by_id++;continue;}
  if(r.domain&&domain.has(r.domain)){report.duplicate_by_domain++;continue;}
  if(nameCountry.has(nk)){report.duplicate_by_name_country++;continue;}
  uid.add(r.uid); if(r.domain)domain.add(r.domain); nameCountry.add(nk); accepted.push(r);
 }
 return {accepted,report};
}
export function coverage(rows){
 const countries={},regions={},sectors={},sources={},licenses={}; let withWebsite=0,withFounded=0;
 for(const r of rows){countries[r.country_code]=(countries[r.country_code]||0)+1;regions[r.region]=(regions[r.region]||0)+1;
  sectors[r.sector]=(sectors[r.sector]||0)+1;sources[r.source_name]=(sources[r.source_name]||0)+1;
  licenses[r.source_license]=(licenses[r.source_license]||0)+1;if(r.website)withWebsite++;if(r.founded_year)withFounded++;}
 const largest=Math.max(0,...Object.values(countries));
 return {total:rows.length,country_count:Object.keys(countries).length,countries,regions,sectors,sources,licenses,
  completeness:{website:withWebsite,founded_year:withFounded},largest_country_share:rows.length?largest/rows.length:0};
}
export function acceptance(c){
 const failures=[]; if(c.total<MIN_TOTAL)failures.push(`total ${c.total} < ${MIN_TOTAL}`);
 if(c.country_count<MIN_COUNTRIES)failures.push(`countries ${c.country_count} < ${MIN_COUNTRIES}`);
 if(c.largest_country_share>.35)failures.push('single-country share > 35%');
 for(const [r,n] of Object.entries(REGION_MIN))if((c.regions[r]||0)<n)failures.push(`${r} ${c.regions[r]||0} < ${n}`);
 return {pass:failures.length===0,failures};
}
const COLS=['uid','name','website','country','country_code','founded_year','sector','source_name','source_url','source_license','as_of'];
export function migration(rows,asOf){
 const lines=rows.map(r=>`INSERT OR IGNORE INTO research_company_directory (${COLS.join(',')}) VALUES (${COLS.map(k=>sqlValue(r[k])).join(',')});`);
 return `-- 419 — D7316 worldwide Research company identities. Generated; do not hand-edit.
-- Source: Wikidata CC0, pulled ${asOf}. Identity fields only; financial metrics remain NULL.
-- Deterministic order: ISO country, sitelinks descending, Q-id; INSERT OR IGNORE preserves idempotence.
${lines.join('\n')}\n`;
}
function existing(root=process.cwd()){
 const paths=['cloudflare-worker/sql/migrations/228_research_company_directory.sql','cloudflare-worker/sql/migrations/403_research_company_directory_wikidata.sql'];
 const out=[];for(const p of paths){const s=readFileSync(resolve(root,p),'utf8');for(const m of s.matchAll(/VALUES \('(q\d+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g)){out.push({uid:m[1],domain:normalizeDomain(m[3]),nameCountry:null});}}return out;
}
async function sparql(q){
 for(let i=0;i<4;i++){const res=await fetch(`${ENDPOINT}?${new URLSearchParams({query:q})}`,{headers:{Accept:'application/sparql-results+json','User-Agent':USER_AGENT}});
  if(res.ok)return (await res.json()).results.bindings;if(![429,500,502,503,504].includes(res.status)||i===3)throw new Error(`Wikidata ${res.status}`);await sleep(2000*2**i);}
}
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i<0?d:process.argv[i+1];};
async function main(){
 const asOf=arg('as-of',new Date().toISOString().slice(0,10)),target=Number(arg('per-country',DEFAULT_TARGET));
 const out=arg('out',DEFAULT_OUT),reportPath=arg('report',DEFAULT_REPORT); if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw new Error('bad --as-of');
 const candidates=[];const stats={rows_read:0,rejected:0,missing_country:0,missing_website:0};
 for(const c of COUNTRIES){const bindings=await sparql(countryQuery(c.code,Math.min(5000,target*5)));stats.rows_read+=bindings.length;
  const rows=bindings.map(b=>rowFromBinding(b,c,asOf)).filter(Boolean).sort((a,b)=>b.links-a.links||a.uid.localeCompare(b.uid)).slice(0,target);
  stats.rejected+=bindings.length-rows.length;candidates.push(...rows);console.error(`[worldwide] ${c.code}: ${rows.length}`);await sleep(1000);}
 const {accepted,report:dupes}=dedupe(candidates,existing());accepted.sort((a,b)=>a.country_code.localeCompare(b.country_code)||b.links-a.links||a.uid.localeCompare(b.uid));
 const cov=coverage(accepted),gate=acceptance(cov),report={as_of:asOf,target_per_country:target,...stats,...dupes,accepted:accepted.length,coverage:cov,acceptance:gate};
 writeFileSync(out,migration(accepted,asOf));writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify(report,null,2));if(!gate.pass)process.exitCode=2;
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(`✖ import-wikidata-worldwide: ${e.message}`);process.exit(1);});
