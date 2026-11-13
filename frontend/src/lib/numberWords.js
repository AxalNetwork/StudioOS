/**
 * A small number as the word the brief's prose spells it with.
 *
 * WHY THIS EXISTS RATHER THAN THE HEADING BEING TYPED. The arsenal section is
 * headed *"Nineteen working tools. Count them."* — an invitation to check, so
 * the count had better be the count. `TOOL_COUNT` is `LAB_TOOLS.length`
 * (`spinoutLabArsenal.js`), which is what the Lab's own intro renders and what
 * `spinout_lab_intro.test.mjs` already pins against `App.jsx`'s routes. Typing
 * "Nineteen" into the brief would make the twentieth tool a silent lie on the
 * one page a founder prints and forwards. Same for the three tracks and the
 * four weeks.
 *
 * Lowercase, because most of the brief's uses are mid-sentence ("four evidence
 * gates", "nineteen tools"); the one heading that starts with it capitalises
 * at the call site. Out of range returns the digits, which is a worse sentence
 * but never a wrong number.
 *
 * Its own module since D581: the brief and the arsenal both spell counts out
 * (the arsenal says the deck's slide count), and neither imports the other.
 */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
  'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven',
  'twenty-eight', 'twenty-nine', 'thirty',
];

export function numberWord(n) {
  if (!Number.isInteger(n) || n < 0 || n >= NUMBER_WORDS.length) return String(n);
  return NUMBER_WORDS[n];
}

/** The same word with its first letter capitalised, for a sentence opening. */
export function numberWordCap(n) {
  const w = numberWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
