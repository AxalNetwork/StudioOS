/**
 * D1571 (#3818, deck v2 D10) — a deck's language: right to left, and the
 * capacity of each script. Pure: no React, no network.
 *
 * The language lives in the theme (`theme.lang`, a BCP 47 tag the Worker's
 * `sanitizeTheme` keeps, with an optional `dir`), so it travels with the
 * version as the aspect does. No language is English, left to right, and a
 * deck that never chose one saves as it did.
 *
 *   scriptOf / dirOf   the Worker's `designSystem.scriptOf` / `dirOf`, mirrored
 *                      (a test holds the two equal): Arabic and Hebrew read
 *                      right to left; Chinese, Japanese and Korean are CJK,
 *                      whose capacity is per character (`deckReflow.SCRIPT_EM`).
 *   langAttrs          `{ lang, dir }` for every surface that draws a card:
 *                      The Grid, the cards strip, Present, print and the
 *                      exports. Text aligns to the start (`text-start`), so it
 *                      mirrors with `dir`; nothing is hard-coded to the left.
 *   withLanguage       ⋯ › Theme's language control: the theme with `lang`
 *                      (and no stale `dir`), or without it for English.
 */
export const LANGUAGES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
  { id: 'ar', label: 'العربية' },
  { id: 'he', label: 'עברית' },
  { id: 'fa', label: 'فارسی' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]);

const SCRIPT_OF = Object.freeze({ ar: 'arabic', fa: 'arabic', ur: 'arabic', he: 'hebrew', yi: 'hebrew', zh: 'cjk', ja: 'cjk', ko: 'cjk' });
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export function scriptOf(lang) {
  const base = typeof lang === 'string' ? lang.toLowerCase().split('-')[0] : '';
  return SCRIPT_OF[base] ?? 'latin';
}

export function dirOf(lang, dir = null) {
  if (dir === 'rtl' || dir === 'ltr') return dir;
  const sc = scriptOf(lang);
  return sc === 'arabic' || sc === 'hebrew' ? 'rtl' : 'ltr';
}

/** The theme's language, or 'en' when it names none. */
export const langOf = (theme) => (typeof theme?.lang === 'string' && LANG.test(theme.lang) ? theme.lang : 'en');

/** The attributes a card's face carries: its language and its direction. */
export function langAttrs(theme) {
  const lang = langOf(theme);
  return { lang, dir: dirOf(lang, theme?.dir) };
}

/** The script a deck's capacity is measured in. */
export const scriptOfTheme = (theme) => scriptOf(theme?.lang);

/**
 * The theme with the language set: English drops the key (and any `dir`) so a
 * deck that only tried a language saves as it did; another sets `lang` and
 * leaves `dir` to follow it. An untouched brand theme stays null.
 */
export function withLanguage(theme, lang) {
  const { lang: _l, dir: _d, ...rest } = theme || {};
  if (!lang || lang === 'en' || !LANG.test(lang)) {
    if (!theme) return null;
    return rest.kind === 'brand' && !rest.background && Object.keys(rest).every((k) => k === 'kind' || k === 'background') ? null : rest;
  }
  return { kind: 'brand', background: null, ...rest, lang };
}

/** The Theme sheet's line for the language: its name, its direction and the script it is measured in. */
export function languageLine(theme) {
  const lang = langOf(theme);
  const name = LANGUAGES.find((l) => l.id === lang.split('-')[0])?.label ?? lang;
  const dir = dirOf(lang, theme?.dir) === 'rtl' ? 'right to left' : 'left to right';
  const cjk = scriptOf(lang) === 'cjk' ? ' · each area holds about half as many characters' : '';
  return `${name} · ${dir}${cjk}`;
}
