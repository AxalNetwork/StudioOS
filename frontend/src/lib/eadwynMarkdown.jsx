/**
 * D9286 (#9286) — Eadwyn's text, rendered as Markdown that can never be HTML,
 * and the body of an Explain press, in a module a Node test can import.
 *
 * WHY A SEPARATE MODULE. `PersonalAdvisor.jsx` reaches `lib/advisor/router.js`,
 * which a Node test cannot import (see `components/advisor/eadwynPhone.jsx`). The two things this
 * issue changes live here so a test can render the one and call the other.
 *
 * SAFE BY ORDER. `renderMarkdown` (`lib/articleMarkdown.js`) HTML-escapes the
 * whole text before it adds a single tag, and the only tags it adds are its own
 * (p, strong, em, code, ul/ol/li, h1-6, blockquote, pre, a, img with http(s) or
 * root-relative URLs only). A `<script>` the model writes reaches the page as
 * the text `&lt;script&gt;`. No raw HTML is ever passed through.
 */
import React from 'react';
import { renderMarkdown } from './articleMarkdown.js';

// Block spacing and list markers for the few tags renderMarkdown emits; the
// bubble's own colours carry through (no colour is set here but the link's).
const MD_CLASS = [
  'whitespace-normal break-words',
  '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:my-1 [&_ol]:my-1',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:overflow-x-auto',
  '[&_a]:underline [&_a]:text-violet-700 dark:[&_a]:text-violet-300',
].join(' ');

/** Eadwyn's (assistant or tutor) text as escaped Markdown. */
export function EadwynMarkdown({ text, className = '' }) {
  const html = renderMarkdown(String(text ?? ''));
  return <div className={`${MD_CLASS} ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The JSON body of an Explain press. When the press is on the active question
 * (the topic is its prompt or its id), it names the question, its answer type
 * and its options, so the Worker can hold the model to those choices (D9286).
 * A typed "explain X" about something else stays a free-form topic.
 */
export function explainRequestBody(topic, question, conversationId) {
  const body = { topic, conversation_id: conversationId };
  if (question?.id && (topic === question.prompt || topic === question.id)) {
    body.question_id = question.id;
    body.question_type = question.input_kind || null;
    body.options = Array.isArray(question.options) ? question.options.map(String) : [];
  }
  return body;
}
