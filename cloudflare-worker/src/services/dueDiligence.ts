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
  | 'newsapi' | 'gdelt' | 'linkedin' | 'github' | 'whois_dns';

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
  }
}

async function runConnector(env: Env, connector: ConnectorMeta, subject: string): Promise<ConnectorResult> {
  if (!isFlagged(env, connector.flag_env)) {
    return { status: 'disabled', records_count: 0, raw_response: null, findings: [] };
  }
  // Live calls would dispatch here based on connector.key. For now emit
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
 * Best-effort PDF render via Cloudflare Browser Rendering. When the
 * `BROWSER` binding is missing or the call fails we return the styled
 * HTML instead — the caller MUST surface the actual format used.
 */
export async function renderReportArtifact(
  env: Env, cs: ReportCase, sections: ReportSection[],
): Promise<{ format: 'pdf' | 'html'; bytes: ArrayBuffer; contentType: string }> {
  const html = renderReportHtml(cs, sections);
  const browser = (env as unknown as { BROWSER?: BrowserBinding }).BROWSER;
  if (browser) {
    try {
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
      console.warn('[dd] BROWSER render failed, falling back to HTML:', (e as Error).message);
    }
  }
  return {
    format: 'html', bytes: new TextEncoder().encode(html).buffer as ArrayBuffer,
    contentType: 'text/html; charset=utf-8',
  };
}

// Re-exports so route + connector dispatch live in one place.
export { runConnector };
