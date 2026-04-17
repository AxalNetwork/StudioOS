/**
 * Limited Partnership Agreement (LPA) generator.
 * Produces a clean, mock-grade LPA body using the fund's terms.
 * Falls back to a deterministic template if the AI call fails so a fund
 * always has SOME LPA on file.
 */
import type { Env } from '../src/types';

export interface LPAContext {
  fund_name: string;
  vintage_year?: number | null;
  fund_size_cents: number;
  carried_interest: number;          // 0.20 = 20%
  management_fee: number;            // 0.02 = 2%
  jurisdiction?: string;
}

function fmtUsd(cents: number): string {
  const v = cents / 100;
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${v.toLocaleString()}`;
}

function deterministicTemplate(ctx: LPAContext): string {
  return `LIMITED PARTNERSHIP AGREEMENT — ${ctx.fund_name.toUpperCase()}

This Limited Partnership Agreement ("Agreement") is entered into as of the date of execution by and between Axal VC, LLC, as General Partner ("GP"), and the undersigned Limited Partner ("LP").

1. FUND
   Name: ${ctx.fund_name}
   Vintage: ${ctx.vintage_year ?? 'N/A'}
   Target Fund Size: ${fmtUsd(ctx.fund_size_cents)}
   Jurisdiction: ${ctx.jurisdiction ?? 'Delaware, USA'}

2. ECONOMIC TERMS
   Management Fee: ${(ctx.management_fee * 100).toFixed(2)}% of committed capital, annually.
   Carried Interest: ${(ctx.carried_interest * 100).toFixed(2)}% of profits, paid after return of contributed capital and any agreed preferred return.
   Distribution Waterfall: (i) return of capital to LPs, (ii) preferred return (if any), (iii) GP catch-up, (iv) carried interest split.

3. CAPITAL CONTRIBUTIONS
   LPs commit a stated amount, callable by the GP via written capital calls upon at least 10 business days' notice. Defaults are governed by Section 7.

4. TERM
   The Fund shall continue for ten (10) years from the Final Closing Date, extendable for up to two one-year periods at the GP's discretion.

5. GOVERNANCE
   The GP has full discretion over investment decisions, subject to the Limited Partner Advisory Committee (LPAC) for conflicts and amendments to economic terms.

6. REPORTING
   Quarterly and annual reports are delivered through the Axal LP Portal. Audited financials are provided annually.

7. DEFAULT
   Failure to fund a capital call within 15 business days subjects the LP to a default penalty up to 50% of the unfunded commitment, at the GP's discretion.

8. CONFIDENTIALITY
   All Fund information is confidential and may not be disclosed without GP consent, except as required by law.

9. MISCELLANEOUS
   This Agreement is governed by the laws of the jurisdiction listed above. Each party's signature evidences acceptance of the foregoing.

___________________________
General Partner — Axal VC, LLC

___________________________
Limited Partner`;
}

export async function aiGenerateLPA(env: Env, ctx: LPAContext): Promise<string> {
  const fallback = deterministicTemplate(ctx);
  const prompt = `Polish this LPA into a clean, professional, English legal document. Keep all numbers exactly. Return the body only.\n\n${fallback}`;
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a venture-fund paralegal. Output a well-structured LPA body (no markdown fences, no preamble).' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
    });
    const text = (resp?.response ?? '').trim();
    if (text.length > 200) return text;
  } catch (e) {
    console.error('aiGenerateLPA failed, using deterministic fallback', e);
  }
  return fallback;
}
