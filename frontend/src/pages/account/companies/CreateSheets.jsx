import React, { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../../ui';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD } from '../../team/teamUi.jsx';
import * as portfolio from './portfolioAdapter.js';
import { LEGAL_FORMS, nameClash, slugCheckLine, slugFrom, slugPrefix } from './companiesModel';
import { INK, MUTED } from './portfolioUi.jsx';

/**
 * D1413 (#3696, PF4a, PF4b, the PF7 lock) — New company and New project, two
 * Sheets opened from Portfolio's "New ▾", a card's "+ Add project" and the
 * company page's "New project". They replace D1138's New company dialog.
 *
 * NEW COMPANY (560). Only the name is required (owner answer Q2); every other
 * field is optional and reads "Not recorded" until it is filled.
 *   1. `POST /api/company/create` with the name, the address (slug) and the
 *      five legal fields (D1415 part 2). You become its primary admin and it
 *      becomes active on this device (the switcher's `create`).
 *   2. Then, when filled: the tax ID (`PUT …/tax-id`), the registered address
 *      (`POST …/locations`, kind registered) and each officer (`POST
 *      …/officers`). One that fails is said with the company kept; nothing is
 *      undone by deleting.
 * NEW PROJECT (520). `POST /api/projects` with `company_id` (null for a
 * standalone project, D1415 part 2) and the address. Free includes one active
 * project: the Worker's 402 opens the plans (`request` does) and the sheet
 * says why.
 *
 * The address line under each slug field is D1591's answer while you type
 * ("✓ Available", or the taken line with a suggestion); it never names who
 * holds a slug. No Ask on Account (owner answer Q8).
 */

const LABEL = 'text-[12.5px] font-bold text-axal-ink dark:text-gray-100';
const HELP = 'text-[12px] text-axal-muted dark:text-gray-400';
const ERR = 'm-0 text-[12.5px] text-axal-destructive dark:text-red-300';

function Field({ label, required = false, help, children, id }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className={LABEL}>{label}{required ? <><span aria-hidden="true" className="text-axal-destructive"> *</span><span className="sr-only"> required</span></> : null}</span>
      {children}
      {help ? <span className={HELP}>{help}</span> : null}
    </label>
  );
}

/** A slug field with its prefix and D1591's live answer. */
function SlugField({ kind, value, onChange, company = null, prefix, testId }) {
  const [line, setLine] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    const slug = value.trim();
    if (!slug) { setLine(null); return undefined; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const out = await portfolio.slugCheck({ kind, slug, company: company || undefined });
      if (n !== seq.current) return;
      setLine(out.available ? slugCheckLine(out.value) : { ok: false, text: 'The address could not be checked. It is checked again when you create.' });
    }, 350);
    return () => clearTimeout(t);
  }, [kind, value, company]);
  return (
    <Field label="Address" id={`${testId}-input`} help={line ? <span className={line.ok ? 'text-emerald-700 dark:text-emerald-300' : ''} data-testid={`${testId}-check`}>{line.text}</span> : 'Lower-case letters, digits and hyphens.'}>
      <span className="flex items-center gap-0 overflow-hidden rounded-[9px] border border-axal-hairline dark:border-gray-700">
        <span className="whitespace-nowrap bg-axal-ground px-2.5 py-2 font-mono text-[12px] text-axal-muted dark:bg-gray-800 dark:text-gray-400">{prefix}</span>
        <input id={`${testId}-input`} value={value} maxLength={50} onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-10 min-w-0 flex-1 bg-white px-2 font-mono text-[13px] text-axal-ink focus:outline-none dark:bg-gray-900 dark:text-gray-100" data-testid={testId} />
      </span>
    </Field>
  );
}

const JURISDICTIONS = [
  ['', 'Not recorded'], ['US-DE', 'Delaware, United States'], ['US-WY', 'Wyoming, United States'], ['GB', 'United Kingdom'],
  ['DE', 'Germany'], ['FR', 'France'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['EE', 'Estonia'],
  ['SG', 'Singapore'], ['CA', 'Canada'], ['AU', 'Australia'],
];

/** PF4a: New company. `create(name, extra)` is the switcher's, so the new company becomes active. */
export function NewCompanySheet({ create, companies = [], onClose, onDone }) {
  const [f, setF] = useState({ name: '', legal_name: '', legal_form: '', jurisdiction: '', registration_number: '', incorporation_date: '', tax_kind: 'ein', tax_id: '', line1: '', city: '', postal_code: '', country: '', slug: '' });
  const [officers, setOfficers] = useState([]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const name = f.name.trim();
  const clash = nameClash(name, companies);
  const slug = slugTouched ? f.slug : slugFrom(name);
  const ready = name.length > 0 && name.length <= 200 && !clash && !busy;
  const go = async () => {
    if (!ready) return;
    setBusy(true); setRefusal('');
    const extra = {};
    for (const k of ['legal_name', 'legal_form', 'jurisdiction', 'registration_number', 'incorporation_date']) if (f[k].trim()) extra[k] = f[k].trim();
    if (slug) extra.slug = slug;
    let created;
    try { created = await create(name, extra); } catch (e) {
      reportError('portfolio:create-company', e);
      setRefusal(e?.message || 'The company could not be created. Try again.');
      setBusy(false); return;
    }
    // The follow-up writes: each said if it fails, the company kept.
    const uid = created?.uid;
    const failed = [];
    if (uid && f.tax_id.trim()) { const out = await portfolio.saveTaxId(uid, f.tax_kind, f.tax_id.trim()); if (!out.available) failed.push(`The tax ID was not saved: ${out.refused ? out.reason : 'it could not be sent'}`); }
    if (uid && (f.line1.trim() || f.city.trim()) && f.country.trim()) {
      const out = await portfolio.addLocation(uid, { kind: 'registered', line1: f.line1.trim() || null, city: f.city.trim() || null, postal_code: f.postal_code.trim() || null, country: f.country.trim().toUpperCase() });
      if (!out.available) failed.push(`The registered address was not saved: ${out.refused ? out.reason : 'it could not be sent'}`);
    }
    for (const o of officers) {
      if (!uid || !o.name.trim()) continue;
      const out = await portfolio.addOfficer(uid, { name: o.name.trim(), title: o.title.trim() || null, office: o.office });
      if (!out.available) failed.push(`${o.name.trim()} was not added: ${out.refused ? out.reason : 'it could not be sent'}`);
    }
    setBusy(false);
    onDone(created, failed);
  };
  return (
    <Sheet title="New company" sub="A legal entity · only the name is required" width={560} onClose={() => { if (!busy) onClose(); }} testId="new-company-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={go} disabled={!ready} data-testid="new-company-confirm">{busy ? 'Creating…' : 'Create company'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <p className={`m-0 ${MUTED}`}>You become its primary admin. It becomes your active company on this device. Anything left blank reads “Not recorded” until you add it.</p>
        <Field label="Name" required id="nc-name" help={`${name.length} / 200 characters`}>
          <input id="nc-name" className={FIELD} value={f.name} maxLength={200} onChange={set('name')} data-testid="new-company-name" />
        </Field>
        {clash ? <p role="alert" className={ERR} data-testid="new-company-clash">You already have a company called {clash}.</p> : null}
        <Field label="Legal name" id="nc-legal" help="As it appears on the certificate of incorporation.">
          <input id="nc-legal" className={FIELD} value={f.legal_name} onChange={set('legal_name')} data-testid="new-company-legal-name" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entity type" id="nc-form">
            <select id="nc-form" className={FIELD} value={f.legal_form} onChange={set('legal_form')} data-testid="new-company-form">
              <option value="">Not recorded</option>
              {LEGAL_FORMS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}
            </select>
          </Field>
          <Field label="Jurisdiction" id="nc-jur">
            <select id="nc-jur" className={FIELD} value={f.jurisdiction} onChange={set('jurisdiction')} data-testid="new-company-jurisdiction">
              {JURISDICTIONS.map(([k, w]) => <option key={k || 'none'} value={k}>{w}</option>)}
            </select>
          </Field>
          <Field label="Registration number" id="nc-reg">
            <input id="nc-reg" className={FIELD} value={f.registration_number} onChange={set('registration_number')} placeholder="e.g. HRB 123456" />
          </Field>
          <Field label="Incorporation date" id="nc-date" help="Leave blank while the company is in formation.">
            <input id="nc-date" type="date" className={FIELD} value={f.incorporation_date} onChange={set('incorporation_date')} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <Field label="Tax ID kind" id="nc-taxk">
            <select id="nc-taxk" className={FIELD} value={f.tax_kind} onChange={set('tax_kind')}>
              <option value="ein">EIN</option><option value="vat">VAT</option><option value="other">Other</option>
            </select>
          </Field>
          <Field label="Tax ID" id="nc-tax">
            <input id="nc-tax" className={FIELD} value={f.tax_id} onChange={set('tax_id')} autoComplete="off" data-testid="new-company-tax-id" />
          </Field>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>Registered address</legend>
          <input aria-label="Street" className={FIELD} value={f.line1} onChange={set('line1')} placeholder="Street" />
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_90px]">
            <input aria-label="City" className={FIELD} value={f.city} onChange={set('city')} placeholder="City" />
            <input aria-label="Postcode" className={FIELD} value={f.postal_code} onChange={set('postal_code')} placeholder="Postcode" />
            <input aria-label="Country code" className={FIELD} value={f.country} maxLength={2} onChange={set('country')} placeholder="DE" />
          </div>
          <span className={HELP}>The country as a two-letter code.</span>
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>Officers and directors</legend>
          {officers.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto]" data-testid={`new-company-officer-${i}`}>
              <input aria-label="Name" className={FIELD} value={o.name} onChange={(e) => setOfficers((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
              <input aria-label="Title" className={FIELD} value={o.title} onChange={(e) => setOfficers((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Title, e.g. CEO" />
              <select aria-label="Office" className={FIELD} value={o.office} onChange={(e) => setOfficers((l) => l.map((x, j) => (j === i ? { ...x, office: e.target.value } : x)))}>
                <option value="officer">Officer</option><option value="director">Director</option>
              </select>
              <button type="button" className={BTN_TEXT} aria-label={`Remove ${o.name || 'this person'}`} onClick={() => setOfficers((l) => l.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => setOfficers((l) => [...l, { name: '', title: '', office: 'officer' }])} data-testid="new-company-add-officer">+ Add a person</button>
        </fieldset>
        <SlugField kind="company" value={slug} onChange={(v) => { setSlugTouched(true); setF((x) => ({ ...x, slug: v })); }} prefix={slugPrefix({ kind: 'company' })} testId="new-company-slug" />
        {refusal ? <p role="alert" className={ERR} data-testid="new-company-refusal">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}

/** PF4b: New project, standalone or inside one of your companies. */
export function NewProjectSheet({ companies = [], company = null, onClose, onDone }) {
  const [name, setName] = useState('');
  const [pick, setPick] = useState(company?.uid || '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugValue, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [locked, setLocked] = useState(false);
  const chosen = (companies || []).find((c) => c.uid === pick) || null;
  const slug = slugTouched ? slugValue : slugFrom(name);
  const ready = name.trim().length > 0 && !busy;
  const go = async () => {
    if (!ready) return;
    setBusy(true); setRefusal(''); setLocked(false);
    try {
      const body = { name: name.trim(), company_id: chosen ? Number(chosen.id) : null };
      if (slug) body.slug = slug;
      const created = await api.createProject(body);
      setBusy(false);
      onDone(created, chosen);
    } catch (e) {
      reportError('portfolio:create-project', e);
      setBusy(false);
      if (e?.status === 402) { setLocked(true); return; }
      setRefusal(e?.message || 'The project could not be created. Try again.');
    }
  };
  return (
    <Sheet title="New project" sub="Start before you incorporate, or inside a company" width={520} onClose={() => { if (!busy) onClose(); }} testId="new-project-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={go} disabled={!ready} data-testid="new-project-confirm">{busy ? 'Creating…' : 'Create project'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <Field label="Name" required id="np-name">
          <input id="np-name" className={FIELD} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="new-project-name" />
        </Field>
        <SlugField kind="project" value={slug} company={chosen?.uid || null} onChange={(v) => { setSlugTouched(true); setSlug(v); }}
          prefix={slugPrefix({ kind: 'project', companyUid: chosen?.slug || chosen?.uid || null })} testId="new-project-slug" />
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={LABEL}>Company (optional)</legend>
          <div role="radiogroup" aria-label="Company" className="flex flex-col gap-1.5" data-testid="new-project-company">
            {[{ uid: '', company_name: 'No company · standalone project' }, ...(companies || [])].map((c) => (
              <label key={c.uid || 'none'} className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-axal-md border px-3 py-2 ${pick === c.uid ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}
                data-testid={`new-project-company-${c.uid || 'none'}`}>
                <input type="radio" name="np-company" checked={pick === c.uid} onChange={() => setPick(c.uid)} className="accent-violet-600" data-testid={`new-project-pick-${c.uid || 'none'}`} />
                <span className={`text-[13.5px] font-semibold ${INK}`}>{c.company_name}</span>
              </label>
            ))}
          </div>
          <span className={HELP}>A project inside a company is managed under that company’s authority.</span>
        </fieldset>
        {locked ? <p role="alert" className={ERR} data-testid="new-project-locked">Your plan includes one active project. The plans are open; pick one to add another.</p> : null}
        {refusal ? <p role="alert" className={ERR} data-testid="new-project-refusal">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}
