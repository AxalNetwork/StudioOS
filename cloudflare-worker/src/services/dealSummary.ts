/**
 * #6629 (D6629) — the deal summary an investor downloads from the deal page, as data and as a PDF.
 *
 * It holds only what the deal page already shows this investor, read by the same rules:
 *
 *   key strip   Round, Instrument, Committed (the round's confirmed total, all investors), Minimum, Closes,
 *               from the deal row through `serializeDeal`, as `GET /api/deals/:id` serves a member
 *   terms       Valuation cap, Carry, Management fee
 *   your stage  `stageRead` (deal_context.ts), the same stage and next action as `GET /api/deals/:id/stage`
 *   scorecard   each scope's band and confidence word, only while the founder shares the scorecard with
 *               investors (`investorsMaySee`); never a value or an input
 *   evidence    `investorEvidenceView`, the investor evidence read by its own audience, NDA and sharing rules:
 *               only items the founder shared, a figure only where it was shared after the NDA
 *
 * Never another investor's name or amount, never a firm's notes (no note is read here), never evidence outside
 * the caller's access. A block whose read fails says it could not be read, and the others still print; a figure
 * the deal does not hold says Not recorded and why, never 0. The route (`routes/deal_summary.ts`) gates the
 * download and records it; nothing in this file writes.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Env } from '../types';
import { winAnsiSafe } from './legalDocFormat';
import { formatMinorOrCount } from '../../../frontend/src/lib/money.js';
import { serializeDeal } from '../routes/deals';
import { stageRead } from '../routes/deal_context';
import { investorView, investorsMaySee, latestReviews } from './ventureScoring/access';
import { storedScorecard } from './ventureScoring/store';
import { investorEvidenceView } from './raiseEvidence';

export type SummaryRow = { label: string; value: string; note?: string | null };
export type SummaryBlock = { key: string; title: string; state: 'recorded' | 'not_recorded' | 'unreadable'; reason?: string; rows?: SummaryRow[]; lines?: string[] };
export type DealSummary = { dealId: number; venture: string; sector: string | null; preparedOn: string; forLine: string; blocks: SummaryBlock[] };

export const SUMMARY_REASONS = Object.freeze({
  noStage: 'No current invitation or progress fact is recorded.',
  scoresLocked: 'The founder has not shared the scorecard with investors.',
  noScores: 'No scope of the scorecard is stored yet.',
  noEvidenceAudience: 'The founder has not shared evidence with you on this deal.',
  noEvidence: 'No evidence is shared with you on this deal yet.',
  partialEvidence: 'Some shared evidence could not be checked against its source just now, so it is left out.',
  confidential: 'Prepared for the named reader only. It is a copy as of the date above and does not update.',
});
const unreadable = (key: string, title: string, what: string): SummaryBlock =>
  ({ key, title, state: 'unreadable', reason: `${what} could not be read when this summary was made. That is not a claim that none is recorded.` });

export class DealSummaryError extends Error {}

const blank = (v: unknown) => v == null || v === '';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Oct 2026" from a stored date, or null when it is not one. */
export function dayOf(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** A deal amount in the deal's currency (major units, as the deal page draws it), or null. */
function dealMoney(v: unknown, currency: string): string | null {
  if (blank(v) || !Number.isFinite(Number(v)) || !/^[A-Z]{3}$/.test(currency)) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(Number(v)); } catch { return null; }
}

/** The key strip, as the deal page's (DE04): a figure the deal does not hold is Not recorded with why; one it cannot read, Unreadable. */
export function keyStrip(deal: any): SummaryRow[] {
  const cur = String(deal?.currency || 'USD');
  const askRaw = !blank(deal?.target_raise) ? deal.target_raise : deal?.amount;
  const cell = (label: string, raw: unknown, shown: string | null, why: string, note: string | null = null): SummaryRow =>
    blank(raw) ? { label, value: 'Not recorded', note: why }
      : shown == null ? { label, value: 'Unreadable', note: `The ${label.toLowerCase()} on this deal could not be read.` }
        : { label, value: shown, note };
  return [
    cell('Round', askRaw, dealMoney(askRaw, cur), 'No round size is recorded on this deal.'),
    cell('Instrument', deal?.instrument, blank(deal?.instrument) ? null : String(deal.instrument), 'No instrument is recorded on this deal.'),
    cell('Committed', deal?.capital_committed, dealMoney(deal?.capital_committed, cur), 'No committed total is recorded on this deal.', 'Confirmed, all investors'),
    cell('Minimum', deal?.minimum_check, dealMoney(deal?.minimum_check, cur), 'No minimum check is recorded on this deal.'),
    cell('Closes', deal?.closing_deadline, dayOf(deal?.closing_deadline), 'No closing date is recorded on this deal.'),
  ];
}

/** The terms at a glance (DL1); the strip's figures are not repeated. */
export function termsRows(deal: any): SummaryRow[] {
  const cur = String(deal?.currency || 'USD');
  const pct = (v: unknown) => (blank(v) ? null : `${v}%`);
  return ([
    ['Valuation cap', dealMoney(deal?.valuation_cap, cur)],
    ['Carry', pct(deal?.carry_pct)],
    ['Management fee', pct(deal?.management_fee_pct)],
  ] as const).map(([label, value]) => (value == null ? { label, value: 'Not recorded', note: `No ${label.toLowerCase()} is recorded on this deal.` } : { label, value }));
}

const SCOPE_STATE: Record<string, string> = {
  not_enough: 'Not enough recorded',
  not_expected: 'Not expected at this stage',
  not_read: 'Not scored yet',
};

/** An evidence item's figure, as the investor evidence read gives it: a value only where it was shared, else why not. */
export function evidenceFigure(row: any): string {
  if (row?.value_reason) return `Value withheld: ${row.value_reason}`;
  const n = Number(row?.value_num);
  if (row?.value_num == null || !Number.isFinite(n)) return 'Not recorded';
  const code = row?.currency ? String(row.currency).toUpperCase() : 'USD';
  const unit = row?.value_unit;
  const group = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === 'cents') return formatMinorOrCount(n, code, { locale: 'en-US', trimWhole: true }) ?? 'Unreadable';
  if (unit === 'money') return `${code === 'USD' ? '$' : `${code} `}${group(n)}`;
  if (unit === 'percent') return `${group(n)}%`;
  if (unit === 'months') return `${group(n)} months`;
  return unit ? `${group(n)} ${unit}` : group(n);
}

/** The deal row, as `GET /api/deals/:id` reads it for a member (staff-only fields dropped by `serializeDeal`). */
async function dealRow(env: Env, dealId: number) {
  const row = await env.DB.prepare(`SELECT d.*, (SELECT COALESCE(SUM(cm.amount), 0) FROM commitments cm WHERE cm.deal_id = d.id AND cm.status = 'confirmed') AS capital_committed,
      p.name AS project_name, p.sector AS project_sector FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.deleted_at IS NULL`).bind(dealId).first<any>();
  return row ? serializeDeal(row, 'member') : null;
}

/** "for Name, Firm": the signed-in investor and the firm the deal is read for. Never an email (no email reaches paper). */
export async function stampFor(env: Env, user: { id: number; name?: string | null }, company: number | null): Promise<string> {
  const name = String(user?.name ?? '').trim() || 'the account holder';
  if (company == null) return `for ${name}`;
  const firm = await env.DB.prepare(`SELECT NULLIF(trim(cp.company_name), '') AS name FROM user_company_links l JOIN company_profiles cp ON cp.id = l.company_id
    WHERE l.user_id = ? AND l.company_id = ?`).bind(user.id, company).first<{ name: string | null }>();
  return `for ${name}, ${firm?.name ?? 'firm name not recorded'}`;
}

/**
 * Everything the PDF says, for the investor `x` (`deal_context`'s `context`: the user, the firm, the deal they may
 * open). The key strip is required: without the deal row nothing is made. Every other block stands alone.
 */
export async function buildDealSummary(env: Env, x: { user: any; company: number | null; id: number; deal: any }, opts: { preparedOn: string }): Promise<DealSummary> {
  const deal = await dealRow(env, x.id);
  if (!deal) throw new DealSummaryError('deal_missing');
  const projectId = Number(x.deal.project_id);
  const block = async (key: string, title: string, what: string, read: () => Promise<SummaryBlock>) => {
    try { return await read(); } catch { return unreadable(key, title, what); }
  };
  const blocks: SummaryBlock[] = [
    { key: 'strip', title: 'Key figures', state: 'recorded', rows: keyStrip(deal) },
    { key: 'terms', title: 'Terms', state: 'recorded', rows: termsRows(deal) },
  ];
  blocks.push(await block('stage', 'Your stage', 'Your stage on this deal', async () => {
    const s = await stageRead(env.DB, x);
    if (s.my_stage == null) return { key: 'stage', title: 'Your stage', state: 'not_recorded', reason: s.reason || SUMMARY_REASONS.noStage };
    const rows: SummaryRow[] = [{ label: 'Stage', value: String(s.my_stage) }];
    if (s.next_action?.label) rows.push({ label: 'Next', value: String(s.next_action.label) });
    if (s.ic?.state === 'not_used') rows.push({ label: 'IC', value: 'Not recorded', note: s.ic.reason });
    return { key: 'stage', title: 'Your stage', state: 'recorded', rows };
  }));
  blocks.push(await block('scorecard', 'Scorecard', 'The scorecard', async () => {
    if (!(await investorsMaySee(env, projectId)).on) return { key: 'scorecard', title: 'Scorecard', state: 'not_recorded', reason: SUMMARY_REASONS.scoresLocked };
    const stored = await storedScorecard(env, projectId);
    if (!stored.length) return { key: 'scorecard', title: 'Scorecard', state: 'not_recorded', reason: SUMMARY_REASONS.noScores };
    // Bands only: the masked view's fields (state, band, confidence word), whatever the NDA would otherwise open.
    const view = investorView(stored, await latestReviews(env, projectId, stored), false);
    return { key: 'scorecard', title: 'Scorecard', state: 'recorded', rows: view.map((s) => ({
      label: s.label,
      value: s.state === 'scored' && s.band ? String(s.band) : SCOPE_STATE[String(s.state)] ?? 'Not recorded',
      note: s.state === 'scored' && s.confidence_word ? `Confidence: ${s.confidence_word}` : null,
    })) };
  }));
  blocks.push(await block('evidence', 'Evidence shared with you', 'The shared evidence', async () => {
    const v: any = await investorEvidenceView(env, projectId, x.user.id);
    if (!v) return { key: 'evidence', title: 'Evidence shared with you', state: 'not_recorded', reason: SUMMARY_REASONS.noEvidenceAudience };
    if (v.items?.state !== 'recorded') return unreadable('evidence', 'Evidence shared with you', 'The shared evidence');
    const rows: SummaryRow[] = (v.items.rows as any[]).map((r) => ({
      label: String(r.area || 'Evidence'),
      value: evidenceFigure(r),
      note: [r.summary, dayOf(r.observed_on) ? `Observed ${dayOf(r.observed_on)}` : null, r.stale ? 'Older than its source allows; check before relying on it' : null].filter(Boolean).join(' · ') || null,
    }));
    if (!rows.length) return { key: 'evidence', title: 'Evidence shared with you', state: 'not_recorded', reason: SUMMARY_REASONS.noEvidence };
    return { key: 'evidence', title: 'Evidence shared with you', state: 'recorded', rows, lines: v.partial ? [SUMMARY_REASONS.partialEvidence] : [] };
  }));
  return {
    dealId: x.id,
    venture: String(deal.project_name || 'This venture'),
    sector: blank(deal.project_sector) ? null : String(deal.project_sector),
    preparedOn: opts.preparedOn,
    forLine: await stampFor(env, x.user, x.company),
    blocks,
  };
}

/** `axal-deal-summary-<deal>-<day>.pdf`, ASCII only. */
export const summaryFilename = (dealId: number, preparedOn: string) =>
  `axal-deal-summary-${dealId}-${/^\d{4}-\d{2}-\d{2}$/.test(preparedOn) ? preparedOn : 'undated'}.pdf`;

/** The PDF: Letter, Helvetica, the reader's stamp at the top and on every page's foot. */
export async function renderDealSummaryPdf(s: DealSummary): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const prepared = dayOf(s.preparedOn) ?? s.preparedOn;
  doc.setTitle(winAnsiSafe(`Deal summary: ${s.venture}`));
  doc.setSubject(winAnsiSafe(`Prepared ${prepared} ${s.forLine}`));
  doc.setProducer('Axal VC');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54, FOOT = 48;
  const ink = rgb(0.1, 0.1, 0.15), muted = rgb(0.4, 0.4, 0.45), rule = rgb(0.85, 0.85, 0.88);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const room = (need: number) => { if (y - need < FOOT + 12) { page = doc.addPage([W, H]); y = H - M; } };
  const wrap = (text: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = []; let cur = '';
    for (const word of winAnsiSafe(text).split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= width || !cur) cur = next; else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const para = (text: string, f: PDFFont, size: number, color = ink, x = M, width = W - 2 * M) => {
    for (const l of wrap(text, f, size, width)) { room(size + 4); page.drawText(l, { x, y, size, font: f, color }); y -= size + 4; }
  };

  para(`Deal summary: ${s.venture}`, bold, 18);
  if (s.sector) para(s.sector, font, 10, muted);
  y -= 4;
  para(`Prepared ${prepared} ${s.forLine}.`, bold, 10);
  para(SUMMARY_REASONS.confidential, font, 9, muted);
  for (const b of s.blocks) {
    y -= 10; room(40);
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: rule });
    para(b.title, bold, 12);
    if (b.state !== 'recorded') { para(b.state === 'unreadable' ? `Unreadable. ${b.reason ?? ''}` : `Not recorded. ${b.reason ?? ''}`, font, 10, muted); continue; }
    for (const r of b.rows ?? []) {
      const labelW = 150;
      const value = wrap(r.value, bold, 10, W - 2 * M - labelW);
      room(14 * value.length);
      page.drawText(winAnsiSafe(r.label).slice(0, 40), { x: M, y, size: 10, font, color: muted });
      for (const [i, l] of value.entries()) page.drawText(l, { x: M + labelW, y: y - i * 14, size: 10, font: bold, color: ink });
      y -= 14 * value.length;
      if (r.note) para(r.note, font, 9, muted, M + labelW, W - 2 * M - labelW);
    }
    for (const l of b.lines ?? []) para(l, font, 9, muted);
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(winAnsiSafe(`Deal summary ${s.forLine} · ${prepared}`).slice(0, 110), { x: M, y: 30, size: 8, font, color: muted });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8), y: 30, size: 8, font, color: muted });
  });
  return doc.save();
}
