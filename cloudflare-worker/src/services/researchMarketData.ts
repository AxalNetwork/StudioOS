/**
 * Research › Markets global sourced observations (D7318, #7318): the append-only observation store, the source
 * registry (World Bank WDI enabled, the rest registered but off) and the World Bank ingest the refresh route calls.
 */
import type { Env } from '../types';

export const WORLD_BANK_METRICS = {
  'NY.GDP.MKTP.CD': ['gdp_nominal_usd','GDP (current US$)','USD'],
  'NY.GDP.PCAP.CD': ['gdp_per_capita_usd','GDP per capita (current US$)','USD/person'],
  'NY.GDP.MKTP.KD.ZG': ['real_gdp_growth_pct','Real GDP growth','percent'],
  'FP.CPI.TOTL.ZG': ['inflation_cpi_pct','Inflation, consumer prices','percent'],
  'SP.POP.TOTL': ['population','Population','people'],
  'GC.DOD.TOTL.GD.ZS': ['government_debt_pct_gdp','Central government debt','percent_of_GDP'],
  'BN.CAB.XOKA.GD.ZS': ['current_account_pct_gdp','Current account balance','percent_of_GDP'],
  'SL.UEM.TOTL.ZS': ['unemployment_pct','Unemployment','percent'],
  'IT.NET.USER.ZS': ['internet_users_pct','Individuals using the Internet','percent'],
  'GB.XPD.RSDV.GD.ZS': ['rd_intensity_pct_gdp','Research and development expenditure','percent_of_GDP'],
} as const;

export function normalizeIso3(value: unknown): string | null {
  const code=String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
export function normalizeValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n=Number(value); return Number.isFinite(n) ? n : null;
}
export function worldBankStatus(): 'unspecified' { return 'unspecified'; }

export async function ingestWorldBank(env: Env, opts: { from?: number; to?: number } = {}) {
  const now=new Date().toISOString();
  const from=opts.from ?? new Date().getUTCFullYear()-5, to=opts.to ?? new Date().getUTCFullYear();
  const vintage=now;
  const run=await env.DB.prepare(
    "INSERT INTO research_market_ingestion_runs(source_id,vintage,started_at,status) VALUES('world-bank',?,?, 'running') RETURNING id"
  ).bind(vintage,now).first<{id:number}>();
  let seen=0, inserted=0;
  try {
    const countriesResponse=await fetch('https://api.worldbank.org/v2/country?format=json&per_page=400',{headers:{Accept:'application/json'}});
    if(!countriesResponse.ok) throw new Error('World Bank country metadata HTTP '+countriesResponse.status);
    const countriesPayload=await countriesResponse.json() as any;
    const countryCodes=new Set((Array.isArray(countriesPayload?.[1])?countriesPayload[1]:[])
      .filter((x:any)=>x?.region?.id && x.region.id!=='NA').map((x:any)=>normalizeIso3(x?.id)).filter(Boolean));
    for (const [indicator, meta] of Object.entries(WORLD_BANK_METRICS)) {
      const url='https://api.worldbank.org/v2/country/all/indicator/'+encodeURIComponent(indicator)
        +'?format=json&per_page=20000&date='+from+':'+to;
      const response=await fetch(url,{headers:{Accept:'application/json'}});
      if(!response.ok) throw new Error('World Bank '+indicator+' HTTP '+response.status);
      const payload=await response.json() as any;
      const rows=Array.isArray(payload?.[1]) ? payload[1] : [];
      for (const row of rows) {
        const iso3=normalizeIso3(row?.countryiso3code);
        const value=normalizeValue(row?.value);
        if(!iso3 || !countryCodes.has(iso3) || value===null || !/^\d{4}$/.test(String(row?.date ?? ''))) continue;
        seen++;
        const key=indicator+':'+iso3+':'+row.date;
        const prior=await env.DB.prepare(
          'SELECT id,value FROM research_market_observations WHERE source_id=? AND source_observation_key=? ORDER BY id DESC LIMIT 1'
        ).bind('world-bank',key).first<{id:number;value:number}>();
        if(prior && Number(prior.value)===value) continue;
        const r=await env.DB.prepare(
          `INSERT OR IGNORE INTO research_market_observations
          (source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,observation_status,published_at,retrieved_at,confidence,source_observation_key,vintage,supersedes_observation_id)
          VALUES('world-bank',?,?, 'country',?,?,?,?, 'unspecified',NULL,?,'source_reported',?,?,?)`
        ).bind(meta[0],meta[1],iso3,String(row.date),value,meta[2],now,key,vintage,prior?.id ?? null).run();
        inserted += Number(r.meta?.changes ?? 0);
      }
    }
    await env.DB.prepare("UPDATE research_market_ingestion_runs SET finished_at=?,status='succeeded',rows_seen=?,rows_inserted=?,rows_unchanged=? WHERE id=?")
      .bind(new Date().toISOString(),seen,inserted,seen-inserted,run!.id).run();
    await env.DB.prepare("UPDATE research_market_sources SET last_attempt_at=?,last_success_at=?,last_error=NULL WHERE id='world-bank'")
      .bind(now,now).run();
    return {source_id:'world-bank',vintage,rows_seen:seen,rows_inserted:inserted,rows_unchanged:seen-inserted};
  } catch (error) {
    const message=error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE research_market_ingestion_runs SET finished_at=?,status='failed',rows_seen=?,rows_inserted=?,error=? WHERE id=?")
      .bind(new Date().toISOString(),seen,inserted,message.slice(0,1000),run!.id).run();
    await env.DB.prepare("UPDATE research_market_sources SET last_attempt_at=?,last_error=? WHERE id='world-bank'")
      .bind(now,message.slice(0,1000)).run();
    throw error;
  }
}
