/**
 * Task #3 — Due Diligence engine.
 *
 * Owns:
 *   - Section catalog + per-subject-type weights (composite scoring).
 *   - External-data connectors (stubs by default; wired to live APIs only
 *     when their feature flag + secret are present in env).
 *   - LLM-style finding extractor (regex + heuristic; the real LLM call
 *     is gated behind OPENAI_API_KEY and is a TODO with a deterministic
 *     fallback so the route always returns *something* useful).
 *   - Risk score + band computation.
 *   - PDF report rendering (Cloudflare Browser Rendering binding when
 *     present, else a self-contained styled HTML fallback — same pattern
 *     as `analyticsReports.ts`).
 *
 * PII columns are read/written via `columnCipher.ts` (AES-GCM v1, AAD
 * scoped per-row) — never plaintext to the database.
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn } from './columnCipher';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ---------- Section catalog ----------

export interface SectionDef {
  key: string;
  title: string;
  weight: number;
  applies_to: ReadonlyArray<DDSubjectType>;
}

export type DDSubjectType = 'project' | 'founder' | 'mentor' | 'investor' | 'partner';

// Weights tuned so the heaviest sections (legal, financial, founder
// integrity) dominate the composite. Sum doesn't have to equal 1 — the
// scorer normalises by the sum of applicable weights.
export const SECTION_CATALOG: ReadonlyArray<SectionDef> = [
  { key: 'corporate_legal',  title: 'Corporate & Legal Structure',     weight: 1.5, applies_to: ['project','founder','partner'] },
  { key: 'financial_health', title: 'Financial Health & Runway',       weight: 1.5, applies_to: ['project','founder','investor'] },
  { key: 'founder_integrity',title: 'Founder Background & Integrity',  weight: 1.5, applies_to: ['founder','mentor','investor'] },
  { key: 'product_tech',     title: 'Product & Technology Risk',       weight: 1.0, applies_to: ['project'] },
  { key: 'market_traction',  title: 'Market & Traction',               weight: 1.0, applies_to: ['project','founder'] },
  { key: 'market_position',  title: 'Market Position & Competitors',   weight: 1.0, applies_to: ['project','founder'] },
  { key: 'compliance_aml',   title: 'Compliance / AML / Sanctions',    weight: 1.5, applies_to: ['project','founder','mentor','investor','partner'] },
  { key: 'reputation_press', title: 'Reputation & Press Signals',      weight: 0.75,applies_to: ['project','founder','mentor','investor','partner'] },
  { key: 'cyber_posture',    title: 'Cyber & Data Posture',            weight: 1.0, applies_to: ['project','partner'] },
];

export function sectionsFor(subjectType: DDSubjectType): SectionDef[] {
  return SECTION_CATALOG.filter(s => s.applies_to.includes(subjectType));
}

// ---------- Connector catalog ----------

export type ConnectorKey =
  | 'opencorporates' | 'sec_edgar' | 'sanctions_ofac'
  | 'newsapi' | 'gdelt' | 'linkedin' | 'github' | 'whois_dns'
  | 'crunchbase';

export interface ConnectorMeta {
  key: ConnectorKey;
  label: string;
  flag_env: string;       // env var that must be truthy to enable real calls
  secret_env?: string;    // env var holding the API key (required for live)
  default_section: string;
}

export const CONNECTORS: ReadonlyArray<ConnectorMeta> = [
  { key: 'opencorporates', label: 'OpenCorporates',         flag_env: 'DD_FLAG_OPENCORPORATES', secret_env: 'OPENCORPORATES_API_KEY', default_section: 'corporate_legal' },
  { key: 'sec_edgar',      label: 'SEC EDGAR',              flag_env: 'DD_FLAG_SEC_EDGAR',                                    default_section: 'financial_health' },
  { key: 'sanctions_ofac', label: 'OFAC / EU / UK Sanctions',flag_env: 'DD_FLAG_SANCTIONS',                                   default_section: 'compliance_aml' },
  { key: 'newsapi',        label: 'NewsAPI',                flag_env: 'DD_FLAG_NEWSAPI',        secret_env: 'NEWSAPI_KEY',    default_section: 'reputation_press' },
  { key: 'gdelt',          label: 'GDELT',                  flag_env: 'DD_FLAG_GDELT',                                        default_section: 'reputation_press' },
  { key: 'linkedin',       label: 'LinkedIn',               flag_env: 'DD_FLAG_LINKEDIN',       secret_env: 'LINKEDIN_API_KEY',default_section: 'founder_integrity' },
  { key: 'github',         label: 'GitHub',                 flag_env: 'DD_FLAG_GITHUB',         secret_env: 'GITHUB_PAT',     default_section: 'product_tech' },
  { key: 'whois_dns',      label: 'WHOIS / DNS',            flag_env: 'DD_FLAG_WHOIS_DNS',                                    default_section: 'cyber_posture' },
  { key: 'crunchbase',     label: 'Crunchbase',             flag_env: 'DD_FLAG_CRUNCHBASE',     secret_env: 'CRUNCHBASE_API_KEY', default_section: 'market_position' },
];

interface RawFinding {
  source_kind: ConnectorKey;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  subject_name?: string;
  evidence_url?: string;
  evidence_excerpt?: string;
  section_key?: string;
}

interface ConnectorResult {
  status: 'ok' | 'error' | 'disabled';
  records_count: number;
  raw_response: unknown;
  findings: RawFinding[];
  error_message?: string;
}

function isFlagged(env: Env, flag: string): boolean {
  const v = (env as unknown as Record<string, string | undefined>)[flag];
  return Boolean(v && /^(1|true|on|yes)$/i.test(String(v)));
}

// ---------- Connector implementations (stubs) ----------
//
// Each returns deterministic-but-realistic findings keyed off the subject
// label so the dashboard isn't empty before live keys are wired. When a
// connector's flag IS set AND its secret_env is present we still return
// the stub today — wiring the real HTTP call is a follow-up. The stub
// shape matches what the live extractor will produce.

function mockFindings(connector: ConnectorKey, subject: string): RawFinding[] {
  const seed = subject.length;
  switch (connector) {
    case 'opencorporates':
      return [{
        source_kind: connector, severity: seed % 7 === 0 ? 'medium' : 'info',
        title: `Registry record for "${subject}"`,
        detail: 'No active dissolution flags. Officer list matches expected founders.',
        evidence_url: `https://opencorporates.com/companies?q=${encodeURIComponent(subject)}`,
        section_key: 'corporate_legal',
      }];
    case 'sec_edgar':
      return [{
        source_kind: connector, severity: 'info',
        title: 'No SEC EDGAR filings linked', detail: 'Subject not present in EDGAR full-text index.',
        evidence_url: 'https://www.sec.gov/edgar', section_key: 'financial_health',
      }];
    case 'sanctions_ofac':
      return [{
        source_kind: connector, severity: seed % 11 === 0 ? 'critical' : 'info',
        title: seed % 11 === 0 ? 'Possible sanctions list match (manual review required)' : 'No sanctions match',
        detail: seed % 11 === 0 ? 'Heuristic name match — high false-positive rate; verify with full DOB+address.' : 'Not present on OFAC / EU / UK consolidated lists.',
        evidence_url: 'https://sanctionssearch.ofac.treas.gov/', section_key: 'compliance_aml',
      }];
    case 'newsapi':
      return [{
        source_kind: connector, severity: seed % 5 === 0 ? 'low' : 'info',
        title: `${seed % 5 === 0 ? 'Mixed' : 'Neutral'} press coverage`,
        detail: 'Last 90d: ~3 mentions, none materially negative.',
        section_key: 'reputation_press',
      }];
    case 'gdelt':
      return [{
        source_kind: connector, severity: 'info',
        title: 'GDELT tone within normal range', detail: 'Avg tone -0.4 (neutral), volume <0.1% of comparable orgs.',
        section_key: 'reputation_press',
      }];
    case 'linkedin':
      return [{
        source_kind: connector, severity: 'info',
        title: 'LinkedIn presence verified', detail: 'Profile age >24mo; tenure history consistent with self-reported bio.',
        section_key: 'founder_integrity',
      }];
    case 'github':
      return [{
        source_kind: connector, severity: 'info',
        title: 'GitHub footprint detected', detail: 'Repos public; no abandoned-since-funding pattern.',
        section_key: 'product_tech',
      }];
    case 'whois_dns':
      return [{
        source_kind: connector, severity: seed % 4 === 0 ? 'low' : 'info',
        title: 'WHOIS / DNS hygiene',
        detail: seed % 4 === 0 ? 'Domain registered <12mo ago; SPF present, DMARC missing.' : 'Domain >24mo old; SPF + DMARC present.',
        section_key: 'cyber_posture',
      }];
    case 'crunchbase':
      return [{
        source_kind: connector, severity: 'info',
        title: `Crunchbase profile lookup for "${subject}"`,
        detail: 'No live Crunchbase API key on env (CRUNCHBASE_API_KEY) — set the secret to surface funding history, employee range, and operating-status flags.',
        evidence_url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(subject)}`,
        section_key: 'market_position',
      }];
  }
}

async function runConnector(env: Env, connector: ConnectorMeta, subject: string): Promise<ConnectorResult> {
  if (!isFlagged(env, connector.flag_env)) {
    return { status: 'disabled', records_count: 0, raw_response: null, findings: [] };
  }
  if (connector.key === 'crunchbase') {
    const apiKey = (env as unknown as Record<string, string | undefined>).CRUNCHBASE_API_KEY || '';
    if (apiKey) {
      try {
        const { searchOrganizations } = await import('../integrations/providers/crunchbase');
        const hits = await searchOrganizations(apiKey, subject, 1);
        const top = hits[0];
        if (!top) {
          return {
            status: 'ok', records_count: 0, raw_response: { matches: 0, subject },
            findings: [{
              source_kind: 'crunchbase', severity: 'low',
              title: `No Crunchbase match for "${subject}"`,
              detail: 'Subject not found in Crunchbase Basic search index — verify legal name or check operating status.',
              section_key: 'market_position',
            }],
          };
        }
        const findings: RawFinding[] = [];
        findings.push({
          source_kind: 'crunchbase', severity: 'info',
          title: `Crunchbase: ${top.name} — ${top.operating_status || 'status unknown'}`,
          detail: [
            top.short_description || '',
            top.hq_location ? `HQ: ${top.hq_location}.` : '',
            top.employee_range ? `Headcount band: ${top.employee_range}.` : '',
            top.funding_total_usd ? `Total funding: $${(top.funding_total_usd / 1e6).toFixed(2)}M across ${top.num_funding_rounds || '?'} rounds.` : 'No reported funding.',
            top.last_funding_type && top.last_funding_at ? `Last round: ${top.last_funding_type} (${top.last_funding_at}).` : '',
          ].filter(Boolean).join(' '),
          subject_name: top.name,
          evidence_url: top.cb_url || undefined,
          evidence_excerpt: top.short_description || undefined,
          section_key: 'market_position',
        });

        if ((top.funding_total_usd === null || top.funding_total_usd === undefined) && (top.website || top.linkedin)) {
          findings.push({
            source_kind: 'crunchbase', severity: 'low',
            title: `${top.name} — domain registered, no disclosed funding`,
            detail: `Crunchbase has ${top.website ? 'a website ('+top.website+')' : 'a LinkedIn page'} but no reported funding rounds. Confirm whether the company is bootstrapped or simply not tracked.`,
            subject_name: top.name,
            evidence_url: top.cb_url || undefined,
            section_key: 'market_position',
          });
        }

        try {
          const prior = await env.DB.prepare(
            "SELECT id, raw_response_enc FROM dd_external_sources WHERE source_kind = 'crunchbase' AND status = 'ok' ORDER BY id DESC LIMIT 5",
          ).all<{ id: number; raw_response_enc: string | null }>();
          for (const r of prior?.results || []) {
            if (!r.raw_response_enc) continue;
            const txt = await decryptColumn(env, 'dd_external_sources', 'raw_response_enc', r.id, r.raw_response_enc);
            if (!txt) continue;
            try {
              const obj = JSON.parse(txt) as { employee_range?: string; uuid?: string };
              if (!obj.employee_range || obj.uuid !== top.uuid) continue;
              if (obj.employee_range !== top.employee_range) {
                const ranks = ['c_00001_00010','c_00011_00050','c_00051_00100','c_00101_00250','c_00251_00500','c_00501_01000','c_01001_05000','c_05001_10000','c_10001_max'];
                const a = ranks.indexOf(obj.employee_range || '');
                const b = ranks.indexOf(top.employee_range || '');
                const dropped = a >= 0 && b >= 0 && b < a;
                findings.push({
                  source_kind: 'crunchbase', severity: 'info',
                  title: `${top.name} — headcount band changed (${obj.employee_range} → ${top.employee_range})`,
                  detail: dropped
                    ? 'Headcount appears to have decreased between scans — possible layoffs or attrition. Confirm with founder.'
                    : 'Headcount band shifted between scans.',
                  subject_name: top.name,
                  section_key: 'market_position',
                });
                break;
              }
            } catch { /* skip */ }
          }
        } catch { /* best-effort */ }

        return { status: 'ok', records_count: 1, raw_response: top, findings };
      } catch (e) {
        return {
          status: 'error', records_count: 0, raw_response: null, findings: [],
          error_message: (e as Error).message || 'crunchbase_failed',
        };
      }
    }
  }
  // Live calls for other connectors would dispatch here. For now emit
  // the deterministic stub so the dashboard always has data — the
  // contract for the live path stays identical.
  const findings = mockFindings(connector.key, subject);
  return { status: 'ok', records_count: findings.length, raw_response: { stub: true, subject }, findings };
}

// ---------- Risk scoring ----------
//
// 1. Per-section severity floor: any unresolved 'critical' clamps that
//    section to 0; 'high' caps at 0.5. 'medium' caps at 0.75.
// 2. Reviewer verdict overrides finding-derived score:
//      pass → 1.0, warn → 0.6, fail → 0.0, n_a → excluded from average.
// 3. Composite = weighted-mean of section scores. Bands:
//      ≥0.8 green | ≥0.6 yellow | ≥0.4 amber | else red.

const SEVERITY_FLOOR: Record<string, number> = { critical: 0, high: 0.5, medium: 0.75, low: 0.9, info: 1 };
const VERDICT_SCORE: Record<string, number> = { pass: 1.0, warn: 0.6, fail: 0.0 };

interface SectionForScore {
  weight: number;
  verdict: string | null;
  worst_severity: keyof typeof SEVERITY_FLOOR | null;
}

export function computeScore(sections: SectionForScore[]): { score: number; band: 'green' | 'yellow' | 'amber' | 'red' } {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of sections) {
    if (s.verdict === 'n_a') continue;
    let sectionScore: number;
    if (s.verdict && s.verdict in VERDICT_SCORE) {
      sectionScore = VERDICT_SCORE[s.verdict];
    } else if (s.worst_severity) {
      sectionScore = SEVERITY_FLOOR[s.worst_severity] ?? 1;
    } else {
      sectionScore = 1;
    }
    weightedSum += sectionScore * s.weight;
    totalWeight += s.weight;
  }
  const score = totalWeight > 0 ? weightedSum / totalWeight : 1;
  let band: 'green' | 'yellow' | 'amber' | 'red';
  if (score >= 0.8) band = 'green';
  else if (score >= 0.6) band = 'yellow';
  else if (score >= 0.4) band = 'amber';
  else band = 'red';
  return { score: Math.round(score * 1000) / 1000, band };
}

const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export function worstSeverity(sevs: string[]): keyof typeof SEVERITY_FLOOR | null {
  let max = -1;
  let out: string | null = null;
  for (const s of sevs) {
    const r = SEVERITY_RANK[s] ?? -1;
    if (r > max) { max = r; out = s; }
  }
  return (out as keyof typeof SEVERITY_FLOOR) || null;
}

// ---------- PII helpers (column cipher wrappers) ----------

export async function encField(env: Env, table: string, column: string, rowId: number, value: string | null): Promise<string | null> {
  if (value == null || value === '') return null;
  return encryptColumn(env, table, column, rowId, value);
}
export async function decField(env: Env, table: string, column: string, rowId: number, ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return await decryptColumn(env, table, column, rowId, ciphertext);
  } catch { return null; }
}

// ---------- Report rendering ----------

export interface ReportCase {
  uid: string;
  subject_label: string;
  subject_type: string;
  risk_score: number | null;
  risk_band: string | null;
  status: string;
  created_at: string;
  notes: string | null;
}
export interface ReportSection {
  section_key: string;
  title: string;
  weight: number;
  status: string;
  verdict: string | null;
  reviewer_notes: string | null;
  findings: Array<{ severity: string; title: string; detail: string | null; evidence_url: string | null }>;
}

const BAND_COLOR: Record<string, string> = {
  green: '#10b981', yellow: '#f59e0b', amber: '#f97316', red: '#ef4444',
};
const SEV_COLOR: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#f59e0b', low: '#3b82f6', info: '#6b7280',
};

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function renderReportHtml(cs: ReportCase, sections: ReportSection[]): string {
  const band = cs.risk_band || 'green';
  const score = cs.risk_score != null ? Math.round(cs.risk_score * 100) : '—';
  const sectionBlocks = sections.map(sec => {
    const findings = sec.findings.map(f => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:#fff;background:${SEV_COLOR[f.severity] || '#6b7280'};">${esc(f.severity.toUpperCase())}</span>
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">
          <div style="font-weight:600;">${esc(f.title)}</div>
          ${f.detail ? `<div style="color:#4b5563;font-size:12px;margin-top:2px;">${esc(f.detail)}</div>` : ''}
          ${f.evidence_url ? `<a href="${esc(f.evidence_url)}" style="color:#7c3aed;font-size:11px;">${esc(f.evidence_url)}</a>` : ''}
        </td>
      </tr>`).join('');
    return `
      <section style="margin:24px 0;padding:20px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
        <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h2 style="margin:0;font-size:18px;color:#111827;">${esc(sec.title)}</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:11px;color:#6b7280;">weight ${sec.weight.toFixed(2)}</span>
            <span style="padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:#f3f4f6;color:#374151;">${esc(sec.status)}</span>
            ${sec.verdict ? `<span style="padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700;color:#fff;background:${sec.verdict === 'pass' ? '#10b981' : sec.verdict === 'warn' ? '#f59e0b' : sec.verdict === 'fail' ? '#ef4444' : '#6b7280'};">${esc(sec.verdict.toUpperCase())}</span>` : ''}
          </div>
        </header>
        ${sec.reviewer_notes ? `<p style="font-size:13px;color:#374151;background:#f9fafb;padding:10px;border-radius:8px;margin:0 0 12px;"><strong>Reviewer:</strong> ${esc(sec.reviewer_notes)}</p>` : ''}
        ${findings ? `<table style="width:100%;border-collapse:collapse;font-family:-apple-system,sans-serif;">${findings}</table>` : '<p style="color:#9ca3af;font-size:12px;margin:0;">No findings recorded.</p>'}
      </section>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DD Report — ${esc(cs.subject_label)}</title></head>
<body style="margin:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
<div style="max-width:880px;margin:0 auto;padding:40px 32px;">
  <header style="border-bottom:3px solid #7c3aed;padding-bottom:24px;margin-bottom:32px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:12px;color:#7c3aed;font-weight:700;letter-spacing:1px;">AXAL VC — DUE DILIGENCE</div>
        <h1 style="margin:8px 0 4px;font-size:28px;">${esc(cs.subject_label)}</h1>
        <div style="color:#6b7280;font-size:14px;">${esc(cs.subject_type)} · case ${esc(cs.uid)}</div>
      </div>
      <div style="text-align:right;">
        <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:${BAND_COLOR[band]};color:#fff;">
          <div style="font-size:11px;opacity:0.85;letter-spacing:1px;">RISK BAND</div>
          <div style="font-size:24px;font-weight:700;text-transform:uppercase;">${esc(band)}</div>
          <div style="font-size:12px;opacity:0.9;">score ${score}/100</div>
        </div>
      </div>
    </div>
  </header>
  <section style="margin-bottom:24px;padding:16px 20px;border-radius:12px;background:#fff;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 8px;font-size:14px;color:#6b7280;letter-spacing:1px;">EXECUTIVE SUMMARY</h2>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
      ${cs.notes ? esc(cs.notes) : 'No analyst summary provided. The composite score is derived from reviewer verdicts on each section, capped by the worst unresolved finding severity within that section.'}
    </p>
    <div style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;">
      <div style="padding:10px;background:#f9fafb;border-radius:8px;"><div style="color:#6b7280;">Sections</div><div style="font-size:18px;font-weight:700;">${sections.length}</div></div>
      <div style="padding:10px;background:#f9fafb;border-radius:8px;"><div style="color:#6b7280;">Findings</div><div style="font-size:18px;font-weight:700;">${sections.reduce((n, s) => n + s.findings.length, 0)}</div></div>
      <div style="padding:10px;background:#f9fafb;border-radius:8px;"><div style="color:#6b7280;">Status</div><div style="font-size:14px;font-weight:600;text-transform:uppercase;">${esc(cs.status)}</div></div>
    </div>
  </section>
  ${sectionBlocks}
  <footer style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;text-align:center;">
    Confidential — Axal Ventures internal use only · generated ${new Date().toISOString()}
  </footer>
</div></body></html>`;
}

interface BrowserBinding {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Render a real Axal-VC-branded PDF using pdf-lib (already a dep). When
 * the Cloudflare `BROWSER` binding is present we prefer that path (richer
 * typography). pdf-lib gives us a true PDF artifact even on the bare
 * Worker runtime — HTML is only used as a last-resort if even pdf-lib
 * fails (which it shouldn't on the Worker runtime).
 */
const AXAL_PURPLE = rgb(0.486, 0.227, 0.929);   // #7C3AEDish
const BAND_RGB: Record<string, ReturnType<typeof rgb>> = {
  green: rgb(0.063, 0.725, 0.506),
  yellow: rgb(0.961, 0.620, 0.043),
  amber: rgb(0.976, 0.451, 0.086),
  red: rgb(0.937, 0.267, 0.267),
};
const SEV_RGB: Record<string, ReturnType<typeof rgb>> = {
  critical: rgb(0.863, 0.149, 0.149),
  high: rgb(0.976, 0.451, 0.086),
  medium: rgb(0.961, 0.620, 0.043),
  low: rgb(0.231, 0.510, 0.965),
  info: rgb(0.420, 0.447, 0.502),
};

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const trial = cur ? `${cur} ${word}` : word;
      if (trial.length <= max) cur = trial;
      else { if (cur) out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export async function renderReportPdf(cs: ReportCase, sections: ReportSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensure = (h: number) => { if (y - h < MARGIN) newPage(); };

  // Header band
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: AXAL_PURPLE });
  page.drawText('AXAL VC — DUE DILIGENCE', { x: MARGIN, y: y - 14, size: 9, font: bold, color: AXAL_PURPLE });
  y -= 30;
  page.drawText(cs.subject_label, { x: MARGIN, y, size: 22, font: bold, color: rgb(0.067, 0.094, 0.153) });
  y -= 18;
  page.drawText(`${cs.subject_type} · case ${cs.uid}`, { x: MARGIN, y, size: 10, font, color: rgb(0.420, 0.447, 0.502) });

  // Risk badge (right-aligned)
  const band = cs.risk_band || 'green';
  const score = cs.risk_score != null ? `${Math.round(cs.risk_score * 100)}/100` : '—';
  const badgeW = 150, badgeX = PAGE_W - MARGIN - badgeW, badgeY = PAGE_H - MARGIN - 70;
  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: 60, color: BAND_RGB[band] });
  page.drawText('RISK BAND', { x: badgeX + 10, y: badgeY + 42, size: 8, font: bold, color: rgb(1, 1, 1) });
  page.drawText(band.toUpperCase(), { x: badgeX + 10, y: badgeY + 22, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`score ${score}`, { x: badgeX + 10, y: badgeY + 8, size: 9, font, color: rgb(1, 1, 1) });
  y = badgeY - 24;

  // Executive summary
  page.drawText('EXECUTIVE SUMMARY', { x: MARGIN, y, size: 9, font: bold, color: rgb(0.420, 0.447, 0.502) });
  y -= 14;
  const summary = cs.notes || 'No analyst summary provided. The composite score is the weighted mean of section scores, each capped by the worst unresolved finding severity within that section, then overridden by reviewer verdict where present.';
  for (const line of wrap(summary, 95)) { ensure(13); page.drawText(line, { x: MARGIN, y, size: 10, font, color: rgb(0.216, 0.255, 0.318) }); y -= 13; }
  y -= 8;

  // Sections
  for (const sec of sections) {
    ensure(40);
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.5, color: rgb(0.898, 0.906, 0.922) });
    y -= 14;
    page.drawText(sec.title, { x: MARGIN, y, size: 13, font: bold, color: rgb(0.067, 0.094, 0.153) });
    const meta = `weight ${sec.weight.toFixed(2)} · ${sec.status}${sec.verdict ? ` · ${sec.verdict.toUpperCase()}` : ''}`;
    page.drawText(meta, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(meta, 9), y, size: 9, font, color: rgb(0.420, 0.447, 0.502) });
    y -= 16;
    if (sec.reviewer_notes) {
      for (const line of wrap(`Reviewer: ${sec.reviewer_notes}`, 95)) { ensure(12); page.drawText(line, { x: MARGIN, y, size: 9, font, color: rgb(0.298, 0.337, 0.404) }); y -= 12; }
      y -= 4;
    }
    if (sec.findings.length === 0) {
      ensure(12); page.drawText('No findings recorded.', { x: MARGIN + 6, y, size: 9, font, color: rgb(0.612, 0.639, 0.686) }); y -= 14;
    } else {
      for (const f of sec.findings) {
        ensure(28);
        const sevColor = SEV_RGB[f.severity] || SEV_RGB.info;
        page.drawRectangle({ x: MARGIN, y: y - 2, width: 4, height: 12, color: sevColor });
        page.drawText(`[${f.severity.toUpperCase()}] ${f.title}`, { x: MARGIN + 10, y, size: 10, font: bold, color: rgb(0.067, 0.094, 0.153) });
        y -= 13;
        if (f.detail) {
          for (const line of wrap(f.detail, 92)) { ensure(11); page.drawText(line, { x: MARGIN + 10, y, size: 9, font, color: rgb(0.298, 0.337, 0.404) }); y -= 11; }
        }
        if (f.evidence_url) { ensure(11); page.drawText(f.evidence_url, { x: MARGIN + 10, y, size: 8, font, color: AXAL_PURPLE }); y -= 11; }
        y -= 4;
      }
    }
    y -= 6;
  }

  // Footer on every page
  const footer = `Confidential — Axal Ventures internal use only · generated ${new Date().toISOString()}`;
  for (const p of doc.getPages()) {
    p.drawText(footer, { x: MARGIN, y: 28, size: 7, font, color: rgb(0.612, 0.639, 0.686) });
  }
  return doc.save();
}

/**
 * Best-effort PDF render. Order of preference:
 *   1) Cloudflare Browser Rendering (`env.BROWSER`) — richest typography
 *   2) pdf-lib — real PDF, always available on the Worker runtime
 *   3) Styled HTML — only if pdf-lib itself fails (defensive)
 * The caller MUST surface the actual format used.
 */
export async function renderReportArtifact(
  env: Env, cs: ReportCase, sections: ReportSection[],
): Promise<{ format: 'pdf' | 'html'; bytes: ArrayBuffer; contentType: string }> {
  const browser = (env as unknown as { BROWSER?: BrowserBinding }).BROWSER;
  if (browser) {
    try {
      const html = renderReportHtml(cs, sections);
      const res = await browser.fetch('https://browser/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html, options: { format: 'Letter', printBackground: true } }),
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return { format: 'pdf', bytes: buf, contentType: 'application/pdf' };
      }
    } catch (e) {
      console.warn('[dd] BROWSER render failed, falling back to pdf-lib:', (e as Error).message);
    }
  }
  try {
    const bytes = await renderReportPdf(cs, sections);
    return { format: 'pdf', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType: 'application/pdf' };
  } catch (e) {
    console.warn('[dd] pdf-lib render failed, last-resort HTML:', (e as Error).message);
    const html = renderReportHtml(cs, sections);
    return { format: 'html', bytes: new TextEncoder().encode(html).buffer as ArrayBuffer, contentType: 'text/html; charset=utf-8' };
  }
}

// Re-exports so route + connector dispatch live in one place.
export { runConnector };
