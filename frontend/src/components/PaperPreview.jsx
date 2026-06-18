import React from 'react';
import DocumentBody from './DocumentBody';
import {
  normalizeLegalBody,
  stripTrailingSignatureBlock,
  buildPreamble,
  buildExecutionBlock,
  classifyDocument,
  axalEntityKeyForDoc,
  AXAL_ENTITIES,
  AXAL_LEGAL_EMAIL,
} from '../lib/legalDocFormat';

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

function SignatureParty({ party }) {
  return (
    <div className="mb-5">
      <div className="font-bold text-[11pt] text-gray-900 dark:text-gray-100">{party.heading}</div>
      <div className="mt-1 text-[10.5pt] leading-6 text-gray-800 dark:text-gray-200 font-mono whitespace-pre">
        {party.by}
        {'\n'}{party.name}
        {'\n'}{party.title}
        {'\n'}{party.date}
      </div>
    </div>
  );
}

/**
 * Paper-style preview of a legal document. Renders the four static components
 * the worker bakes into the exported PDF (header with CONFIDENTIAL, centered
 * uppercase title, standardized preamble, footer) around the
 * Markdown-normalized clause body and the dual execution block — so the live
 * preview always matches the finished PDF and the e-signed document.
 */
export default function PaperPreview({
  title,
  body,
  resolveTokens = true,
  version = 1,
  docType = '',
  category = null,
  counterpartyName = '',
  effectiveDate = '',
}) {
  const slug = docType || title || '';
  const kind = classifyDocument(slug);
  const entityKey = axalEntityKeyForDoc(slug, category);
  const entityName = AXAL_ENTITIES[entityKey].name;

  const resolvedBody = resolveTokens ? resolveWithBrackets(body) : body;
  const cleanBody = normalizeLegalBody(stripTrailingSignatureBlock(resolvedBody || ''));

  const preamble = kind === 'agreement'
    ? buildPreamble({
        documentTitle: title || 'Agreement',
        effectiveDate,
        axalEntityKey: entityKey,
        axalEntityName: entityName,
        counterpartyName: counterpartyName || null,
      })
    : null;

  const execution = kind !== 'policy'
    ? buildExecutionBlock({ kind, axalEntityName: entityName, counterpartyName: counterpartyName || null })
    : null;

  return (
    <div className="flex justify-center py-6">
      <div className="bg-white shadow-lg w-[8.5in] max-w-full min-h-[11in] p-[0.75in] text-gray-900 font-serif dark:bg-gray-900 dark:text-gray-100">
        {/* Header strip: brand left, CONFIDENTIAL right */}
        <div className="flex items-center justify-between border-b border-gray-300 pb-3 mb-6 dark:border-gray-700">
          <div className="text-violet-700 font-bold text-sm tracking-wider uppercase">AXAL VC</div>
          <div className="text-rose-700 font-bold text-[11px] tracking-widest uppercase">Confidential</div>
        </div>

        {/* Title — centered, bold, uppercase */}
        {title && (
          <div className="text-center text-lg font-bold mb-4 font-sans uppercase tracking-wide">
            {title}
          </div>
        )}
        <div className="border-b border-gray-200 mb-5 dark:border-gray-700" />

        {/* Preamble (agreements only) */}
        {preamble && (
          <p className="text-[12pt] leading-relaxed text-gray-900 dark:text-gray-100 mb-5">{preamble}</p>
        )}

        {/* Body — Markdown-normalized clauses (whitespace preserved) */}
        <DocumentBody
          text={cleanBody}
          className="text-[12pt] leading-relaxed text-gray-900 dark:text-gray-100"
          emptyText="Nothing to preview yet."
        />

        {/* Execution block */}
        {execution && (
          <div className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
            <div className="text-violet-700 font-bold text-[10px] tracking-widest uppercase font-sans mb-1">Execution</div>
            <p className="text-[9.5pt] italic text-gray-500 mb-4 font-sans">{execution.recital}</p>
            {execution.parties.map((p) => (
              <SignatureParty key={p.role} party={p} />
            ))}
          </div>
        )}

        {/* Footer: "<Title> — v<N>" / "Page 1 of 1" + audit sub-line */}
        <div className="mt-10 pt-3 border-t border-gray-300 font-sans dark:border-gray-700">
          <div className="text-[9pt] text-gray-500 flex justify-between items-center">
            <div className="truncate max-w-[70%]">{(title || 'Document')} — v{version}</div>
            <div>Page 1 of 1</div>
          </div>
          <div className="text-[7.5pt] text-gray-400 flex justify-between items-center mt-0.5">
            <div className="truncate max-w-[60%] font-mono">SHA-256: 0000000000000000000000000000000000000000…</div>
            <div>{AXAL_LEGAL_EMAIL} · PREVIEW-NOT-YET-SENT</div>
          </div>
        </div>
      </div>
    </div>
  );
}
