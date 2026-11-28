/**
 * D9275 (#9275) — what a line typed in Studio's Eadwyn composer is.
 *
 * `intentOf(text, { question, pendingEvidence })` answers one of four words:
 *
 *  - `explain` — "explain churn", "what is a SAFE": the tutor opens on the topic.
 *  - `tool`    — the seven slash prefixes (`/tool`, `/find`, `/open`, `/book`,
 *                `/schedule`, `/draft`, `/start`), an action verb ("find …",
 *                "show …"), or anything typed with no question active: it goes
 *                to `api.advisor.toolAuto`, as it did before.
 *  - `command` — any other text that starts with `/` once trimmed. It is never
 *                an answer and never evidence: nothing is sent, the text stays
 *                in the box, and the interview (the question, the answered
 *                ring, the transcript's answer line, `pendingEvidence`) is not
 *                touched. #9276 gives it a command list and #9278 a picker.
 *  - `answer`  — everything else while a question is active, a slash inside
 *                prose ("and/or", a URL mid-sentence) included. If the last
 *                answer came back `needs_evidence`, `submit()` files it as that
 *                evidence; a command never reaches that branch.
 *
 * Empty or blank text answers `null`: there is nothing to send.
 *
 * Pure: no React, no network. `routeComposerSend` is the dispatcher
 * `PersonalAdvisor`'s `handleSend` calls with its own handlers.
 */

/** The one line a command this build does not know yet shows. */
export const COMMAND_NOT_READY = 'Nothing was sent. Commands are coming to Eadwyn.';

const EXPLAIN = /^\s*(?:explain|what is|what's|tell me about|help me with|huh\??)\s+(.{2,})$/i;
const TOOL_SLASH = /^\/(?:tool|find|open|book|schedule|draft|start)\b/i;
const TOOL_VERB = /^(?:find|show|search|book|schedule|draft|open|start|deep[- ]link)\b/i;

/** The tutor topic of an `explain` line, or null. */
export function explainTopic(text) {
  const m = String(text ?? '').trim().match(EXPLAIN);
  return m ? m[1] : null;
}

/**
 * @param {string} text the composer's text, untrimmed
 * @param {{ question?: object|null, pendingEvidence?: object|null }} [ctx]
 *   `question` is the active interview question; `pendingEvidence` is read by
 *   `submit()` only, so it never changes what a line is — a command is a
 *   command whether or not evidence is pending.
 * @returns {'explain'|'tool'|'command'|'answer'|null}
 */
export function intentOf(text, ctx = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (explainTopic(raw)) return 'explain';
  if (raw.startsWith('/')) return TOOL_SLASH.test(raw) ? 'tool' : 'command';
  if (!ctx.question || TOOL_VERB.test(raw)) return 'tool';
  return 'answer';
}

/**
 * Classify `text` and call the matching handler with the trimmed text (the
 * tutor topic for `explain`). Returns the intent, or null when blank.
 *
 * @param {string} text
 * @param {{ question?: object|null, pendingEvidence?: object|null }} ctx
 * @param {{ explain: Function, tool: Function, command: Function, answer: Function }} handlers
 */
export function routeComposerSend(text, ctx, handlers) {
  const raw = String(text ?? '').trim();
  const intent = intentOf(raw, ctx);
  if (intent === 'explain') handlers.explain(explainTopic(raw));
  else if (intent === 'tool') handlers.tool(raw);
  else if (intent === 'command') handlers.command(raw);
  else if (intent === 'answer') handlers.answer(raw);
  return intent;
}
