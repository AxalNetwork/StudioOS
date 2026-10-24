/**
 * D902 (#2681) — WHAT A PITCH DECK LINK INCLUDES.
 *
 * The share dialog's "What is included" (PD18) is stored on the link as
 * `include_json` (migration 540), and the share read sends the version's cards
 * through `shareSlides()` before anything leaves the Worker. The owner's
 * question 3 (#2434) is not answered, so this is answer A, as the canvas
 * draws it:
 *
 *   figures   on    the figure fields (`metric_grid`), with their chips;
 *   sources   on    the Sources appendix cards (`appendix: true`);
 *   notes     off   speaker notes (a card's `notes`; part 4 adds them);
 *   bands     off   the scorecard and product-market fit bands.
 *
 * NEVER, WHATEVER THE LINK SAYS:
 *   · an internal score: the readiness fields (`vr_*`);
 *   · a bank balance, an account or a counterparty: a field whose key names
 *     one (`BANK_KEY`);
 *   · a quote without its consent recorded (`consent: true` on the field).
 *     No editor records consent yet, so today no quote goes out on a link.
 *
 * A link made before 540 has no `include_json` and gets the default. A field
 * this removes is gone from the card, not blanked: the viewer shows what is
 * there and says nothing about what is not.
 */

export type ShareInclude = { figures: boolean; sources: boolean; notes: boolean; bands: boolean };

export const DEFAULT_SHARE_INCLUDE: Readonly<ShareInclude> = Object.freeze({ figures: true, sources: true, notes: false, bands: false });
export const SHARE_INCLUDE_KEYS = ['figures', 'sources', 'notes', 'bands'] as const;

/** A readiness field: the venture's internal score. Never on a link. */
const INTERNAL_SCORE_KEY = /^vr_/;
/** A field that names a bank balance, an account or a counterparty. Never on a link. */
const BANK_KEY = /(^|_)(bank|balance|balances|account|accounts|iban|routing|counterparty|counterparties)(_|$)/;
/** A scorecard or product-market fit band: only when the link includes bands. */
const BAND_KEY = /^(scorecard|pmf|band)_|_band$/;

/** The stored `include_json`, or the default for a link that has none or one that cannot be read. */
export function parseShareInclude(raw: unknown): ShareInclude {
  if (raw == null || raw === '') return { ...DEFAULT_SHARE_INCLUDE };
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return { ...DEFAULT_SHARE_INCLUDE }; }
  }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SHARE_INCLUDE };
  for (const k of SHARE_INCLUDE_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

/**
 * The writer's check of a body's `include`: an object of the four booleans,
 * any of them left out taking the default. Null when it is not one, so the
 * writer can refuse it.
 */
export function shareIncludeFromBody(v: unknown): ShareInclude | null {
  if (v === undefined) return { ...DEFAULT_SHARE_INCLUDE };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(SHARE_INCLUDE_KEYS as readonly string[]).includes(k) || typeof o[k] !== 'boolean') return null;
  }
  return parseShareInclude(o);
}

function fieldKept(f: any, inc: ShareInclude): boolean {
  if (!f || typeof f !== 'object') return false;
  const key = String(f.key || '').toLowerCase();
  if (INTERNAL_SCORE_KEY.test(key) || BANK_KEY.test(key)) return false;
  if (f.kind === 'quote' && f.consent !== true) return false;
  if (BAND_KEY.test(key) && !inc.bands) return false;
  if (f.kind === 'metric_grid' && !inc.figures) return false;
  return true;
}

/** One version's cards as a link may send them. */
export function shareSlides(slides: unknown, include: ShareInclude): any[] {
  if (!Array.isArray(slides)) return [];
  return slides
    .filter((s) => s && typeof s === 'object' && (include.sources || !(s as any).appendix))
    .map((s: any) => {
      const out: any = { ...s };
      if (!include.notes) delete out.notes;
      if (Array.isArray(s.fields)) {
        out.fields = s.fields.filter((f: any) => fieldKept(f, include)).map((f: any) => {
          if (include.notes || !f || typeof f !== 'object' || !('notes' in f)) return f;
          const { notes: _n, ...rest } = f;
          return rest;
        });
      }
      return out;
    });
}

/** The Spin-Out fields baked onto a shared deck, with the same two "never" rules. */
export function shareSpinoutFields(fields: Record<string, string> | null): Record<string, string> | null {
  if (!fields) return fields;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.toLowerCase();
    if (!INTERNAL_SCORE_KEY.test(key) && !BANK_KEY.test(key)) out[k] = v;
  }
  return out;
}
