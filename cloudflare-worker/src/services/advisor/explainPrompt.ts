/**
 * D9286 (#9286) — what Explain tells the model about the question it explains.
 *
 * Explain used to send the model the topic alone, so the model guessed the
 * choices: a question that offers Daily, Weekly and Off was explained with a
 * **Custom** frequency it does not have. The press now names the question, and
 * this builds the part of the system prompt that pins the model to that
 * question's own choices and to the page that holds its field.
 *
 * The bank is the authority. The client sends the options it shows, but a
 * request body is not trusted to say what a question offers: an option the
 * bank does not list is dropped, and with none sent the bank's own are used.
 */

/** The bank question's fields this reads (a `Question` satisfies it). */
export interface ExplainQuestion {
  id: string;
  input_kind: string;
  options?: string[];
  page_target?: string;
}

const MAX_OPTIONS = 40;
const MAX_OPTION_CHARS = 120;

/** One option as it may appear in a prompt line: one line, bounded. */
function clean(o: unknown): string {
  return String(o ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION_CHARS);
}

/**
 * The options the model may describe: the bank's, narrowed to those the client
 * sent when it sent any the bank lists. Never one the bank does not list.
 */
export function explainOptions(bankOptions: readonly string[] | undefined, sent: unknown): string[] {
  const bank = (bankOptions || []).map(clean).filter(Boolean).slice(0, MAX_OPTIONS);
  if (!Array.isArray(sent) || sent.length === 0) return bank;
  const asked = new Set(sent.map(clean).filter(Boolean));
  const both = bank.filter((o) => asked.has(o));
  return both.length ? both : bank;
}

/** A page path the prompt may link: root-relative, one segment run, no scheme. */
function pagePath(p: string | undefined): string | null {
  const s = String(p || '').trim();
  return /^\/(?!\/)[A-Za-z0-9/_\-.?=&#%]*$/.test(s) ? s : null;
}

/**
 * The system-prompt section for an Explain press on `q`. It lists exactly the
 * options the model may describe and forbids any other; a question with no
 * fixed choices says so, so the model cannot invent some.
 */
export function explainQuestionContext(q: ExplainQuestion, sentOptions?: unknown): string {
  const options = explainOptions(q.options, sentOptions);
  const lines = [`The member pressed Explain on question "${clean(q.id)}" (answer type: ${clean(q.input_kind)}).`];
  if (options.length) {
    lines.push('Its choices are exactly these, and only these:');
    for (const o of options) lines.push(`- ${o}`);
    lines.push('Describe only these choices. Never mention, suggest or invent a choice that is not in this list.');
  } else {
    lines.push('This question has no fixed choices. Do not offer or invent any.');
  }
  const page = pagePath(q.page_target);
  if (page) lines.push(`The field this question fills is on the page ${page}. End with a Markdown link to it: [Open the page](${page}).`);
  lines.push('Write in short Markdown: **bold** and "- " bullets are fine. Never write HTML.');
  return lines.join('\n');
}
