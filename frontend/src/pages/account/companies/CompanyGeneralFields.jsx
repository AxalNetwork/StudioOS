import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CompanyMark, INK, MUTED, PCard } from './portfolioUi.jsx';
import {
  CURRENCY_NONE, FIELD_HELP, FIELD_HINT, LABELS, LINKEDIN_HINT, PREVIEW_NEVER, PREVIEW_TITLE, PREVIEW_UNSAVED,
  currencyLabel, currencyMatches, descriptionCount, normalisedHint, openableUrl,
} from './generalFormModel';

/**
 * D4966 (#5312, boards CS-01, CS-02, CS-06, CS-09, CS-12) — the parts of
 * Company settings › General the v2 canvas adds, kept out of the form file:
 *
 *  · `CurrencyCombobox` (CS-06): the ISO list searched by code or by name, with
 *    "Not recorded" always the first choice and never a guessed default. It is
 *    the WAI-ARIA combobox pattern — `role="combobox"` on the input, a
 *    `listbox` of `option`s, `aria-activedescendant` for the keyboard — because
 *    a 160-entry `<select>` cannot be searched.
 *  · `UrlField` (CS-09): the address with Open, the normalisation shown before
 *    it is saved, and LinkedIn's own hint.
 *  · `FieldFrame` (CS-02, CS-03): the label, hint, help and error of one field,
 *    with the violet edge a changed field carries and `aria-invalid` and
 *    `aria-describedby` wired to the ids the error and the help actually have.
 *  · `ProblemSummary` (CS-03 C): every problem at the top, each a link to its
 *    own field, announced once.
 *  · `PublicPreview` (CS-01, CS-02): the public fields ONLY, marked when what
 *    it draws includes unsaved changes.
 *
 * Nothing here reads or writes: every value and every answer comes from the
 * form. A field with no value says so; nothing is filled with a placeholder the
 * company did not write.
 */

const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[13.5px] text-axal-ink disabled:cursor-not-allowed disabled:bg-axal-ground dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:disabled:bg-gray-800';
const DIRTY_EDGE = 'rounded-md ring-2 ring-axal-violet/60';
const ERROR_TEXT = 'text-[12px] text-red-700 dark:text-red-300';

/** The label, hint, help and error around one control. `dirty` draws the canvas's violet edge. */
export function FieldFrame({ field, htmlFor, dirty, error, children, span }) {
  const helpId = `general-${field}-help`;
  const errId = `general-${field}-error`;
  return (
    <div className={span ? 'sm:col-span-2' : ''} data-testid={`general-field-${field}`} data-dirty={dirty ? 'yes' : 'no'}>
      <label htmlFor={htmlFor} className="flex flex-col gap-1">
        <span className={`text-[12px] font-semibold ${INK}`}>
          {LABELS[field]}{field === 'company_name' ? ' · required' : ''}
          {FIELD_HINT[field] ? <span className={`ml-1.5 font-normal ${MUTED}`}>{FIELD_HINT[field]}</span> : null}
        </span>
        <span className={dirty ? DIRTY_EDGE : undefined}>{children({ helpId, errId })}</span>
      </label>
      {FIELD_HELP[field] ? <p className={`m-0 mt-1 ${MUTED}`} id={helpId}>{FIELD_HELP[field]}</p> : null}
      {error ? <p className={`m-0 mt-1 ${ERROR_TEXT}`} id={errId} role="alert" data-testid={`general-${field}-error`}>{error}</p> : null}
    </div>
  );
}

/** CS-03 C: every problem at the top, each linking to its own field. */
export function ProblemSummary({ problems }) {
  if (!problems?.length) return null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40"
      role="alert" aria-live="assertive" data-testid="general-problem-summary">
      <p className={`m-0 text-[13px] font-semibold ${ERROR_TEXT}`}>
        Fix {problems.length} field{problems.length === 1 ? '' : 's'} before saving.
      </p>
      <ul className="m-0 mt-1.5 list-disc pl-5">
        {problems.map((p) => (
          <li key={p.field} className={`${ERROR_TEXT} text-[12.5px]`}>
            <a href={`#general-${p.field}`} className="underline" data-testid={`general-problem-link-${p.field}`}
              onClick={(e) => {
                e.preventDefault();
                const node = typeof document !== 'undefined' ? document.getElementById(`general-${p.field}`) : null;
                if (node?.focus) node.focus();
              }}>{LABELS[p.field] || p.field}</a>
            {' — '}{p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** CS-09: a web or LinkedIn address, with Open, the normalisation hint and LinkedIn's own. */
export function UrlField({ field, value, onChange, disabled, dirty, error }) {
  const id = `general-${field}`;
  const open = openableUrl(field, value);
  const hint = normalisedHint(field, value);
  return (
    <FieldFrame field={field} htmlFor={id} dirty={dirty} error={error}>
      {({ helpId, errId }) => (
        <>
          <input id={id} type="url" inputMode="url" autoComplete="url" className={INPUT} value={value} disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={[error ? errId : null, `${id}-tail`, FIELD_HELP[field] ? helpId : null].filter(Boolean).join(' ') || undefined}
            placeholder={field === 'website' ? 'https://example.com' : 'https://www.linkedin.com/company/…'}
            onChange={(e) => onChange(e.target.value)} />
          <span id={`${id}-tail`} className="mt-1 flex flex-wrap items-center gap-2">
            {open ? (
              <a href={open} target="_blank" rel="noopener noreferrer" className={`${MUTED} underline`} data-testid={`general-${field}-open`}>Open ↗</a>
            ) : null}
            {hint ? <span className={MUTED} data-testid={`general-${field}-normalised`}>{hint}</span> : null}
            {field === 'linkedin_url' && !open ? <span className={MUTED} data-testid="general-linkedin-hint">{LINKEDIN_HINT}</span> : null}
          </span>
        </>
      )}
    </FieldFrame>
  );
}

/** CS-10: the description with its count, marked near and over the limit. */
export function DescriptionField({ value, onChange, disabled, dirty, error, max }) {
  const id = 'general-description';
  const count = descriptionCount(value, max);
  return (
    <FieldFrame field="description" htmlFor={id} dirty={dirty} error={error} span>
      {({ helpId, errId }) => (
        <>
          <textarea id={id} className={`${INPUT} resize-none`} rows={3} value={value} disabled={disabled}
            aria-invalid={count.over || error ? 'true' : undefined}
            aria-describedby={[error ? errId : null, `${id}-count`, helpId].filter(Boolean).join(' ')}
            onChange={(e) => onChange(e.target.value)} />
          <span id={`${id}-count`} data-testid="general-description-count"
            className={`${count.over ? ERROR_TEXT : MUTED} text-[11.5px] tabular-nums`}>{count.text}{count.over ? ' · over the limit' : count.near ? ' · near the limit' : ''}</span>
        </>
      )}
    </FieldFrame>
  );
}

/**
 * CS-06: the default currency, searched by code or by name.
 *
 * "Not recorded" is the first option and is what an unrecorded currency reads
 * as; nothing is preselected. The input shows the chosen code's own label while
 * the list is closed, and the member's query while it is open, so typing never
 * destroys the current choice until one is picked.
 */
export function CurrencyCombobox({ value, stored, onChange, disabled, dirty, error }) {
  const id = 'general-default_currency';
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const box = useRef(null);
  const options = useMemo(() => ['', ...currencyMatches(query, { stored })], [query, stored]);
  useEffect(() => { setAt(0); }, [query]);
  const choose = (code) => { onChange(code); setOpen(false); setQuery(''); };
  const label = (code) => (code === '' ? CURRENCY_NONE : currencyLabel(code));
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(options.length - 1, i + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setAt((i) => Math.max(0, i - 1)); return; }
    if (e.key === 'Enter' && open) { e.preventDefault(); choose(options[at] ?? ''); return; }
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); setQuery(''); }
  };
  return (
    <FieldFrame field="default_currency" htmlFor={id} dirty={dirty} error={error}>
      {({ helpId, errId }) => (
        <span className="relative block" ref={box}>
          <input
            id={id} className={INPUT} disabled={disabled} role="combobox" autoComplete="off"
            aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && options[at] !== undefined ? `${listId}-${options[at] || 'none'}` : undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={[error ? errId : null, helpId].filter(Boolean).join(' ')}
            value={open ? query : label(value)}
            placeholder={CURRENCY_NONE}
            onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            onBlur={() => { setOpen(false); setQuery(''); }}
            data-testid="general-default-currency" />
          {open ? (
            <ul id={listId} role="listbox" aria-label={LABELS.default_currency}
              className="absolute left-0 right-0 z-10 m-0 mt-1 max-h-56 list-none overflow-auto rounded-md border border-axal-hairline bg-white p-1 dark:border-gray-700 dark:bg-gray-950"
              data-testid="general-default-currency-list">
              {options.map((code, i) => (
                <li key={code || 'none'} id={`${listId}-${code || 'none'}`} role="option" aria-selected={code === value}
                  className={`cursor-pointer rounded px-2 py-1 text-[13px] ${INK} ${i === at ? 'bg-axal-violet/10' : ''}`}
                  data-testid={`general-default-currency-${code || 'none'}`}
                  onMouseDown={(e) => { e.preventDefault(); choose(code); }}>{label(code)}</li>
              ))}
              {options.length === 1 ? <li className={`px-2 py-1 text-[12.5px] ${MUTED}`} data-testid="general-default-currency-empty">No currency matches that.</li> : null}
            </ul>
          ) : null}
        </span>
      )}
    </FieldFrame>
  );
}

/**
 * CS-01 and CS-02: the preview, built from `previewOf`, which is the Worker's
 * `PUBLIC_FIELDS` and nothing else. The private four and the default currency
 * are not passed here at all, and a test holds this file to that.
 */
export function PublicPreview({ preview, collapsible = false }) {
  const [open, setOpen] = useState(true);
  const body = (
    <>
      {preview.unsaved ? (
        <p className="m-0 mb-2 rounded-md bg-axal-violet/10 px-2 py-1 text-[12px] font-semibold text-axal-violet-deep dark:text-violet-200"
          data-testid="company-general-preview-unsaved">{PREVIEW_UNSAVED}</p>
      ) : null}
      <span className="flex items-center gap-2">
        <CompanyMark name={preview.name || ''} size={28} logoUrl={preview.logo} />
        <span className={`text-[13.5px] font-semibold ${INK}`}>{preview.name || 'Untitled company'}</span>
      </span>
      <p className={`m-0 mt-1 ${MUTED}`} data-testid="company-general-preview-meta">
        {[preview.stage, preview.regions.join(', ') || null].filter(Boolean).join(' · ') || 'Stage and regions are not recorded.'}
      </p>
      {preview.description
        ? <p className={`m-0 mt-2 text-[12.5px] ${INK}`} data-testid="company-general-preview-description">{preview.description}</p>
        : <p className={`m-0 mt-2 ${MUTED}`} data-testid="company-general-preview-no-description">No description is recorded.</p>}
      <span className="mt-2 flex flex-wrap gap-3">
        {preview.website ? <a href={preview.website} target="_blank" rel="noopener noreferrer" className={`${MUTED} underline`} data-testid="company-general-preview-website">{preview.website.replace(/^https?:\/\//, '')} ↗</a> : null}
        {preview.linkedin ? <a href={preview.linkedin} target="_blank" rel="noopener noreferrer" className={`${MUTED} underline`} data-testid="company-general-preview-linkedin">LinkedIn ↗</a> : null}
      </span>
    </>
  );
  return (
    <PCard title={PREVIEW_TITLE} testId="company-general-preview">
      {collapsible ? (
        <>
          <button type="button" className={`mb-2 ${MUTED} underline`} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="company-general-preview-toggle">
            {open ? 'Hide preview' : 'Show preview'}
          </button>
          {open ? body : null}
        </>
      ) : body}
      <p className={`m-0 mt-3 ${MUTED}`} data-testid="company-general-preview-scope">
        Only your public fields appear here. {PREVIEW_NEVER.length} more — revenue, employees, products, goals and the default currency — stay private to your company.
      </p>
    </PCard>
  );
}
