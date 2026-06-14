import React from 'react';
import { Mail } from 'lucide-react';
import DocumentBody from './DocumentBody';

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Turn `{{dotted.path}}` tokens into bracketed labels (e.g.
 * `{{company.legal_name}}` -> `[COMPANY LEGAL NAME]`). Pure client-side
 * string replacement — no schema import, no network call.
 */
export function resolveWithBrackets(body) {
  return (body || '').replace(MERGE_TOKEN, (_, path) => {
    return '[' + path.replace(/[._]+/g, ' ').trim().toUpperCase() + ']';
  });
}

/**
 * Paper-style preview of a legal document. White card, realistic margins,
 * violet header strip, and a footer with SHA-256 placeholder + page count.
 * Renders the body through `DocumentBody` so whitespace-pre-wrap semantics
 * are preserved (no markdown, underscores & dashes shown literally).
 */
export default function PaperPreview({ title, body, resolveTokens = true }) {
  const displayedBody = resolveTokens ? resolveWithBrackets(body) : body;

  return (
    <div className="flex justify-center py-6">
      <div className="bg-white shadow-lg w-[8.5in] max-w-full min-h-[11in] p-[0.75in] text-gray-900 font-serif">
        {/* Header strip */}
        <div className="flex items-center justify-between border-b border-gray-300 pb-3 mb-6">
          <div className="text-violet-700 font-bold text-sm tracking-wider uppercase">AXAL VC</div>
          <Mail size={16} className="text-gray-400" />
        </div>

        {/* Title */}
        {title && (
          <div className="text-center text-lg font-bold mb-8 font-sans">
            {title}
          </div>
        )}

        {/* Body — kept in DocumentBody so <pre> whitespace is preserved */}
        <DocumentBody
          text={displayedBody}
          className="text-[12pt] leading-relaxed text-gray-900"
          emptyText="Nothing to preview yet."
        />

        {/* Footer */}
        <div className="mt-10 pt-3 border-t border-gray-300 text-[9pt] text-gray-400 flex justify-between items-center font-sans">
          <div className="truncate max-w-[70%] font-mono">
            SHA-256: 0000000000000000000000000000000000000000000000000000000000000000
          </div>
          <div>Page 1 of 1</div>
        </div>
      </div>
    </div>
  );
}
