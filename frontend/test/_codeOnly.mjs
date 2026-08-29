/**
 * `codeOnly(src)` — source with the explanatory prose removed.
 *
 * Tests here routinely ban a word to prove a surface does not claim something:
 * "watermarked", "View recap", "unified", a 403. And the file under test
 * almost always MENTIONS that word in a comment explaining why it is absent —
 * which is exactly the comment you want to keep. Six assertions in this suite
 * failed against correct code for that reason before this existed.
 *
 * Only the two comment shapes a string literal cannot produce are removed: a
 * block comment that STARTS a line at column 0, and a line that is nothing but
 * a `//` comment. Between them they cover doc headers and standalone
 * explanations, which is where this prose lives.
 *
 * Inline comment markers are deliberately left alone. A `/*` inside a string
 * or a className opens a comment that runs to the next close marker far below;
 * a naive stripper doing that once ate half of SpinoutLabScoringPage.jsx and
 * reported `useState` — used nineteen times in it — as unused. So a word in a
 * TRAILING comment still reads as present here, and a ban on it would still
 * fail. That is the safe direction: a missed ban is a weaker test, a mangled
 * file is a false accusation.
 */
export function codeOnly(src) {
  return String(src)
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
}
