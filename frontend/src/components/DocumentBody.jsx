/**
 * Shared renderer for document/template bodies (legal agreements, resolutions,
 * etc.). These bodies are authored as PLAIN TEXT where line breaks and blank
 * lines carry the structure — CAPS section headers, `1.1`/`2.2` numbering,
 * `-` bullets, and `______` fill-in blanks. They are NOT Markdown: a Markdown
 * renderer collapses single newlines into spaces and would mangle the
 * underscores/dashes the templates rely on.
 *
 * Every place a document is shown (the admin template editor's live preview,
 * the user-facing template preview, and the e-signature page) renders through
 * this one component so the preview always matches the finished document and
 * the surfaces can't drift apart. Tokens (`{{merge_field}}`), underscores, and
 * dashes are shown literally — never reinterpreted.
 *
 * `className` lets each call site keep its own font/size/colour so existing
 * surfaces are unchanged in appearance; whitespace preservation is guaranteed
 * here via `whitespace-pre-wrap`.
 */
export default function DocumentBody({ text, className = '', emptyText = null }) {
  const value = text == null ? '' : String(text);

  if (!value.trim()) {
    return emptyText != null
      ? <div className="text-gray-400 text-sm">{emptyText}</div>
      : null;
  }

  return <pre className={`whitespace-pre-wrap ${className}`}>{value}</pre>;
}
