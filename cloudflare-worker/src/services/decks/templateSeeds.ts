/**
 * D1535 (#3782) — HQ's Gallery templates, as #3876 seeds them: each one a
 * `deck_template/1` object (H14) that passes `templateProblems`, scores at
 * least 80 on `deckRubric` once applied, and carries `provenance.reviewed_by`
 * for the designer or owner review. #3876's 24 are composed in
 * `templateLibrary.ts` from the issue's house rules and its TPL-01..24 prompts;
 * `deck_template_library_3876.test.ts` holds them to the issue's tests.
 */
import { LIBRARY } from './templateLibrary';

export const HQ_TEMPLATES: readonly unknown[] = LIBRARY;
