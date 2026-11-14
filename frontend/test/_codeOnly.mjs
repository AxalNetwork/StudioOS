/**
 * `codeOnly(src)` — source with the explanatory prose removed.
 *
 * Tests here routinely ban a word to prove a surface does not claim something:
 * "watermarked", "View recap", "unified", a 403. And the file under test
 * almost always MENTIONS that word in a comment explaining why it is absent —
 * which is exactly the comment you want to keep. Six assertions in this suite
 * failed against correct code for that reason before this existed.
 *
 * Three comment shapes are removed, and each is one a string literal cannot
 * produce: a block comment that STARTS a line at column 0, a line that is
 * nothing but a `//` comment, and a comment wrapped in BRACES — `{/* … *\/}`,
 * whitespace permitted on either side. Between them they cover doc headers,
 * standalone explanations, JSX comments, and the empty-catch comment
 * (`catch { /* … *\/ }`), which is where this prose lives.
 *
 * THE BRACES SURVIVE — the replacement is `{}`, not nothing. Removing them too
 * turns `catch { /* … *\/ }` into a bare `catch`, and
 * `spinout_lab_scoring_milestones.test.mjs`, which reads a `try`/`catch` shape
 * out of the source, failed against correct code on exactly that. A prose
 * stripper may delete prose; it may not restructure the code around it.
 *
 * WHY THE BRACE SHAPE IS SAFE WHERE A BARE ONE IS NOT, because that distinction
 * is the whole reason this file is careful. An inline `/*` inside a string or a
 * className opens a comment that runs to the next close marker far below; a
 * naive stripper doing that once ate half of SpinoutLabScoringPage.jsx and
 * reported `useState` — used nineteen times in it — as unused. **That caution
 * stands and is not weakened here.** What makes the brace shape different is
 * that BOTH delimiters must appear — `{` `/*` … `*\/` `}` — and no className,
 * string or template literal in this tree produces either pair; the match is
 * body is written so it cannot CONTAIN a close marker, so the match can never
 * run past the first `*\/` to pair with a later `}`. A lazy `[\s\S]*?` body
 * backtracks when the next character is not `}` and joins two comments into one
 * match, swallowing the live code between them — `{/* a *\/ x /* b *\/}` is the
 * whole hazard in one line. **Measured: it over-matches nowhere in this tree
 * today**, so the explicit body is defence rather than a repair, and the test
 * that pins it uses that fixture rather than claiming a defect it did not find.
 * So a word in a
 * TRAILING bare comment still reads as present, and a ban on it would still
 * fail. That remains the safe direction: a missed ban is a weaker test, a
 * mangled file is a false accusation.
 *
 * The brace rule was `codeOnlyJsx`'s alone until it had cost FIVE assertion
 * failures against correct code through the 159 files that import `codeOnly`
 * instead: login's `login-google-unavailable` testid, the SQLite CHECK error
 * text, migration 240's comment naming `held_unpaid`, and a comment in
 * `pages/advisor/practice/EarningsZone.jsx`. A rule that is right for six
 * callers and right for the other 153 belongs in the one function. The
 * whitespace tolerance is the other half: 109 `{ /*` sites in `frontend/src`
 * are padded and the strict pair missed every one of them.
 *
 * `scripts/check-inline-project-pickers.mjs` carries its own copy, for the same
 * reason `check-regulated-wording.mjs` does — a guard that `test:guards` runs
 * should not import out of the test tree. Keep the two in step.
 */
/**
 * The brace-comment shape, exported so a test can assert the property the
 * pattern is written for rather than restating it and drifting.
 */
export const BRACE_COMMENT = /\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g;

export function codeOnly(src) {
  return String(src)
    .replace(/^\/\*[\s\S]*?\*\//gm, '')
    .replace(new RegExp(BRACE_COMMENT.source, 'g'), '{}')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/^\s*\*[^\n]*$/gm, '');
}

/**
 * `codeOnlyJsx(src)` — kept as `codeOnly`'s name for its six existing callers.
 *
 * It was the function that stripped `{/* … *\/}` while `codeOnly` did not. That
 * split is gone: the rule is in `codeOnly` now, for the reason its docblock
 * gives, so the two are the same function and this name is the alias. Call
 * `codeOnly` in new tests.
 */
export const codeOnlyJsx = codeOnly;
