// Shared word-count guidance for pitch copy that lives in both the
// Project edit modal (Problem Statement / Solution textareas) and the
// Axal VC Spin-Out deck (Slide_Problem / Slide_Solution).
//
// Word ranges are intentionally hard-coded here so the editor warning
// and the deck render decision can never drift.

export const PITCH_COPY_CONFIG = {
  problem: { min: 25, idealMin: 35, idealMax: 60, max: 75 },
  solution: { min: 25, idealMin: 35, idealMax: 50, max: 70 },
};

export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

// Returns { wordCount, status, label, tone, progressPercent }
//   status:  'empty' | 'too_short' | 'good' | 'acceptable' | 'too_long'
//   tone:    'neutral' | 'amber' | 'green' | 'red'
//   progressPercent: 0..100 — fills toward the ideal range, not toward max.
export function getPitchCopyLengthStatus(text, fieldType) {
  const cfg = PITCH_COPY_CONFIG[fieldType];
  if (!cfg) {
    return { wordCount: 0, status: 'empty', label: '', tone: 'neutral', progressPercent: 0 };
  }
  const wordCount = countWords(text);

  if (wordCount === 0) {
    return {
      wordCount,
      status: 'empty',
      tone: 'neutral',
      label: `Aim for ${cfg.idealMin}–${cfg.idealMax} words`,
      progressPercent: 0,
    };
  }
  if (wordCount < cfg.min) {
    return {
      wordCount,
      status: 'too_short',
      tone: 'amber',
      label: `Too short — aim for ${cfg.idealMin}–${cfg.idealMax} words`,
      progressPercent: Math.max(8, Math.round((wordCount / cfg.idealMin) * 70)),
    };
  }
  if (wordCount < cfg.idealMin) {
    const span = cfg.idealMin - cfg.min || 1;
    return {
      wordCount,
      status: 'too_short',
      tone: 'amber',
      label: `Almost there — aim for ${cfg.idealMin}–${cfg.idealMax} words`,
      progressPercent: 70 + Math.round(((wordCount - cfg.min) / span) * 25),
    };
  }
  if (wordCount <= cfg.idealMax) {
    return {
      wordCount,
      status: 'good',
      tone: 'green',
      label: 'Good length',
      progressPercent: 100,
    };
  }
  if (wordCount <= cfg.max) {
    return {
      wordCount,
      status: 'acceptable',
      tone: 'amber',
      label: `Acceptable — keep under ${cfg.max} words`,
      progressPercent: 100,
    };
  }
  return {
    wordCount,
    status: 'too_long',
    tone: 'red',
    label: `Too long — trim to under ${cfg.max} words`,
    progressPercent: 100,
  };
}

// Used by the deck to keep the slide headline from blowing past the
// header band when a founder pastes a wall of text. Returns the text
// unchanged when within the max-words boundary.
export function trimPitchCopyToMax(text, fieldType) {
  const cfg = PITCH_COPY_CONFIG[fieldType];
  if (!cfg || !text || typeof text !== 'string') return text || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= cfg.max) return text;
  return words.slice(0, cfg.max).join(' ') + '…';
}
