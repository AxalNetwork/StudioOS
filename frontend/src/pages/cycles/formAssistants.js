/**
 * D6862 (#6862) — the panel a form draws below its fields when its page passes
 * no `renderAssistant` of its own, by cycle, module and form key. Each panel
 * is its own chunk, loaded only when its form opens. `FormLightbox.jsx` reads
 * this; `CycleRoute.jsx` (a frozen hub, D5615) is not edited to add one.
 *
 * Record a decision (Validate › Verdict, form `decision`): the E-numbered
 * evidence table, the coverage sentence and Eadwyn's read of the evidence
 * (`VerdictEvidencePanel.jsx`, D6021 V17/V18).
 */
import { lazy } from 'react';

const VerdictEvidencePanel = lazy(() => import('./VerdictEvidencePanel.jsx'));

const PANELS = new Map([
  ['validate/verdict/decision', VerdictEvidencePanel],
]);

/** The panel component for this form, or null. */
export function formAssistant(cycle, slug, formKey) {
  return PANELS.get(`${String(cycle ?? '').toLowerCase()}/${slug}/${formKey}`) ?? null;
}
