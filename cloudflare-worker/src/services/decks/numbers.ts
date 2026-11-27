/**
 * D1588 (#3835): the first number a text names, moved here from `newDeck.ts`
 * unchanged so a module that must not reach the deck sources (an MCP tool,
 * D752's member-privacy guard) can refuse a typed figure by the same rule.
 * `newDeck.ts` re-exports both names, so every earlier import still works.
 *
 * Pure: no imports.
 */
const NUMBER_WORDS = [
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands',
  'million', 'millions', 'billion', 'billions', 'trillion', 'dozen', 'dozens', 'half', 'double', 'doubled',
  'triple', 'tripled', 'twice', 'percent',
];
/**
 * D1506: digits in every script (`\\p{Nd}`: ٣٠٠, ３, ३) and the full-width
 * signs always count. Number words count in English, and in the language a
 * text is written in when the caller names it (`LANGUAGES` in assist.ts):
 * mixed into English they would refuse "due diligence" (Italian *due*) or an
 * "elf" (German *elf*). Latin scripts match as whole words; the others by
 * their unit words, which are not everyday syllables. "One" is left alone in
 * every language, as in English.
 */
export const NUMBER_WORDS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  French: ['deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'onze', 'douze', 'quinze', 'vingt', 'trente', 'quarante',
    'cinquante', 'soixante', 'cent', 'cents', 'mille', 'millions?', 'milliards?', 'douzaine', 'moitié', 'double', 'triple', 'pour cent'],
  German: ['zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'zwanzig', 'dreißig', 'hundert',
    'tausend', 'millionen?', 'milliarden?', 'dutzend', 'hälfte', 'doppelt', 'prozent'],
  Spanish: ['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'veinte', 'treinta', 'cien', 'ciento', 'mil',
    'millones', 'millón', 'mitad', 'doble', 'por ciento'],
  Portuguese: ['dois', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'vinte', 'trinta', 'cem', 'mil',
    'milhões', 'milhão', 'bilhões', 'metade', 'dobro', 'por cento'],
  Italian: ['due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'venti', 'trenta', 'cento', 'mille', 'milioni',
    'miliardi', 'metà', 'doppio', 'per cento'],
  Dutch: ['twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien', 'twintig', 'honderd', 'duizend', 'miljoen', 'miljard',
    'helft', 'dubbel', 'procent'],
  Japanese: ['十', '百', '千', '万', '億', '兆'],
  'Chinese (Simplified)': ['十', '百', '千', '万', '亿', '兆'],
  Korean: ['퍼센트'],
  Arabic: ['مليون', 'مليار', 'ألف', 'آلاف', 'بالمئة'],
  Hindi: ['लाख', 'करोड़', 'हज़ार', 'प्रतिशत'],
};
const LATIN = new Set(['French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch']);
const wordsRe = (words: readonly string[]) => `(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`;
const BASE = `\\p{Nd}|[%$€£¥％＄￥￡]|${wordsRe(NUMBER_WORDS)}`;
const NUMBER_RE = new RegExp(BASE, 'iu');
const LANGUAGE_RE: Record<string, RegExp> = Object.fromEntries(Object.entries(NUMBER_WORDS_BY_LANGUAGE).map(([lang, words]) => [
  lang, new RegExp(`${BASE}|${LATIN.has(lang) ? wordsRe(words) : words.join('|')}`, 'iu'),
]));

/**
 * The first number a text names, or null. Digits, currency and percent signs,
 * and number words from two upward ("one" is left alone: "one ledger" is not
 * a figure). Strict on purpose: words dropped for naming a number cost a
 * sentence; a figure nobody recorded costs the deck its trust.
 */
export function numberIn(text: unknown, language?: string | null): string | null {
  if (typeof text !== 'string') return null;
  const m = ((language && LANGUAGE_RE[language]) || NUMBER_RE).exec(text);
  return m ? m[0] : null;
}
