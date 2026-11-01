/**
 * #3935 (D1478 task 1): the "Draw a cover" press, as plain functions the
 * component and its test share. The event editor (EV2) and the course builder
 * (LE8) both use it.
 *
 * Two steps, never one: **Price it** shows the one quote (the draw plus its
 * three checks, and the model that will draw), and only then **Draw** runs.
 * A drawn cover fills the form's cover field through `onDrawn(url, alt)`; the
 * member's own Save writes it. A refusal is kept in the route's own words.
 */
import { money } from '../lib/fillSheet';

export const COVER_INITIAL = Object.freeze({ prompt: '', quoting: false, drawing: false, quote: null, drawn: null, error: null });

/** The quote as one line: the model, the whole figure, and its two parts. Null parts read as not recorded, never $0. */
export function coverQuoteLine(q) {
  if (!q) return null;
  const total = money(q.hold_microusd);
  const draw = money(q.draw_microusd);
  const checks = money(q.checks_microusd);
  const model = q.model_label || 'the image model';
  if (total == null) return `${model} · price not available`;
  return `${model} · ${total} (draw ${draw ?? 'not recorded'}, checks ${checks ?? 'not recorded'})`;
}

const errorOf = (e) => ({ code: e?.code || e?.data?.code || null, message: e?.message || 'The cover could not be drawn.' });

/** The press's actions over a `set(fn)` state updater and the two client calls. */
export function makeCoverActions({ quote, draw, set, onDrawn }) {
  let current = COVER_INITIAL;
  const update = (fn) => set((s) => { current = fn(s); return current; });
  return {
    setPrompt: (prompt) => update((s) => ({ ...s, prompt, quote: null, error: null })),
    async price(prompt) {
      update((s) => ({ ...s, quoting: true, error: null, quote: null }));
      try {
        const q = await quote(prompt);
        update((s) => ({ ...s, quoting: false, quote: q }));
        return q;
      } catch (e) {
        update((s) => ({ ...s, quoting: false, error: errorOf(e) }));
        return null;
      }
    },
    async run(prompt) {
      update((s) => ({ ...s, drawing: true, error: null }));
      try {
        const r = await draw(prompt);
        update((s) => ({ ...s, drawing: false, drawn: r, quote: null }));
        if (r?.url) onDrawn?.(r.url, r.alt ?? null);
        return r;
      } catch (e) {
        update((s) => ({ ...s, drawing: false, error: errorOf(e) }));
        return null;
      }
    },
  };
}
