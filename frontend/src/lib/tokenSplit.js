/**
 * What `token_split_bps` means, once, for every surface that names it (D4671).
 *
 * The column is the LICENSEE's share of the price members pay for AI tokens, in
 * basis points; the Licensors take the rest. That is the sentence the signed
 * Subsidiary Licence Agreement carries (clause 4.3, `{{licence.token_split}}`),
 * so it is the meaning the other surfaces follow. HQ's console used to say
 * "to HQ" — the opposite recipient for the same number, which an asymmetric
 * split (3501 to the Licensee, 6499 to HQ) turned into a wrong figure on a
 * screen. `test/token_split_meaning_d4671.test.mjs` fails if a surface names the
 * other recipient again.
 */
export const TOKEN_SPLIT_HQ_LABEL = 'Token split to the Licensee';
export const TOKEN_SPLIT_HQ_INPUT = 'Token split to the Licensee (basis points)';
export const TOKEN_SPLIT_HISTORY_LABEL = 'Token split to the Licensee (bps)';
/** The branch's own page: the Licensee is the reader. */
export const TOKEN_SPLIT_OWN_LABEL = 'Your share of AI token revenue';
export const TOKEN_SPLIT_OWN_DETAIL = 'your AI token share';
