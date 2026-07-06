// Task #3 — Pure helpers for the assessment authoring editors (no JSX).
//
// The worker stores mechanic-specific payloads as JSON columns:
//   - items.options  — the renderable payload (shapes mirror
//     frontend/src/components/play/mechanics.jsx + assessmentScoring.ts)
//   - items.config   — per-mechanic tunables (timer_ms / total / pick_n)
//   - items.measures — { values?: string[]; skills?: string[] } classifying
//     which dimensions the item touches (drives axis coverage analytics)
//   - items.loads    — item-level magnitude hints (unused by the base engine;
//     the *scored* loads live per-option as `option.loads = { dim: number }`)
//   - badges.criteria / archetypes.centroid — free-form JSON.
//
// We keep scalars in structured fields, give authors a measures picker over the
// known dimensions, and expose the option/config/criteria/centroid blobs as
// validated JSON textareas seeded from per-mechanic starter templates.
import { VALUE_SPECTRUMS, SKILL_AXES, SKILL_AXIS_ORDER, valueLabel, skillLabel } from '../../../lib/assessmentMeta';

// Dimension palette for the measures picker + a copy-key reference next to the
// option JSON. Value spectrums are bipolar (−2..+2); skills are 0..5.
export const VALUE_KEYS = Object.keys(VALUE_SPECTRUMS);
export const SKILL_KEYS = [...SKILL_AXIS_ORDER];
export const DIMENSION_KEYS = { values: VALUE_KEYS, skills: SKILL_KEYS };

// The six canonical track keys (mirror the worker's ASSESSMENT_TRACKS — stable
// identifiers; the seeded games use slug == track). Used to suggest tracks when
// authoring a new game. Authors may still type a custom track string.
export const ASSESSMENT_TRACKS = [
  'founder_origin_v1',
  'operators_path_v1',
  'thesis_lab_v1',
  'partner_playbook_v1',
  'advisor_compass_v1',
  'coachs_lens_v1',
];

// The six item mechanics (assessment_items.mechanic).
export const MECHANICS_LIST = ['dilemma', 'card_sort', 'sjt', 'speed', 'allocation', 'reflection'];
// Badge kinds (assessment_badges.kind).
export const BADGE_KINDS = ['archetype', 'milestone', 'event'];
// Game lifecycle statuses.
export const GAME_STATUSES = ['draft', 'published', 'archived'];

export function dimensionLabel(kind, slug) {
  return kind === 'values' ? valueLabel(slug) : skillLabel(slug);
}

export { VALUE_SPECTRUMS, SKILL_AXES };

// Parse a JSON textarea. Empty string → null (the column is cleared). Returns a
// discriminated result so editors can block save + show the parse error inline.
export function parseJsonField(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid JSON' };
  }
}

// Pretty-print a stored value back into a textarea. null/undefined → ''.
export function stringifyField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

// Per-mechanic starter `options` payloads. Shapes mirror mechanics.jsx so a
// freshly-authored item renders + scores immediately. `loads` stubs mark where
// per-option dimension weights go (keys from DIMENSION_KEYS).
export const MECHANIC_OPTION_TEMPLATES = {
  dilemma: {
    options: [
      { key: 'a', label: 'First choice', loads: {} },
      { key: 'b', label: 'Second choice', loads: {} },
    ],
  },
  sjt: {
    options: [
      { key: 'a', label: 'Best response', loads: {} },
      { key: 'b', label: 'Plausible response', loads: {} },
      { key: 'c', label: 'Weak response', loads: {} },
    ],
  },
  speed: {
    options: [
      { key: 'a', label: 'Snap choice A', loads: {} },
      { key: 'b', label: 'Snap choice B', loads: {} },
    ],
  },
  card_sort: {
    cards: [
      { key: 'c1', label: 'Card one', loads: {} },
      { key: 'c2', label: 'Card two', loads: {} },
      { key: 'c3', label: 'Card three', loads: {} },
    ],
    pick_n: 2,
  },
  allocation: {
    buckets: [
      { key: 'x', label: 'Bucket X', loads: {} },
      { key: 'y', label: 'Bucket Y', loads: {} },
    ],
  },
  reflection: {
    fields: [{ kind: 'text', label: 'Your biggest takeaway' }],
  },
};

// Per-mechanic `config` tunables read by the renderers.
export const MECHANIC_CONFIG_TEMPLATES = {
  dilemma: {},
  sjt: {},
  speed: { timer_ms: 6000 },
  card_sort: { pick_n: 2 },
  allocation: { total: 100 },
  reflection: {},
};

// A complete starter payload set for a new item of `mechanic`.
export function starterItemPayload(mechanic) {
  return {
    options: MECHANIC_OPTION_TEMPLATES[mechanic] ?? {},
    config: MECHANIC_CONFIG_TEMPLATES[mechanic] ?? {},
    measures: { values: [], skills: [] },
    loads: {},
  };
}

// Normalise a measures blob into the { values:[], skills:[] } shape the picker
// edits, tolerating null / partial / legacy payloads.
export function normaliseMeasures(measures) {
  const m = measures && typeof measures === 'object' ? measures : {};
  return {
    values: Array.isArray(m.values) ? m.values : [],
    skills: Array.isArray(m.skills) ? m.skills : [],
  };
}
