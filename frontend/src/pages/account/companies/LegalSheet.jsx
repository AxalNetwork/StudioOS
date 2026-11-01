import React, { useState } from 'react';
import { Sheet } from '../../../ui';
import { reportError } from '../../../lib/log';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD } from '../../team/teamUi.jsx';
import * as portfolio from './portfolioAdapter.js';
import { LEGAL_FORMS, addressLine, maskedTaxId } from './companiesModel';
import { MUTED } from './portfolioUi.jsx';

/**
 * D1413 (#3696, PF8a) — "Edit legal facts", opened from Company settings ›
 * Legal. An editor's only (the Worker's rule, D1415: an Owner, Admin or
 * Founder, the primary admin, or an Axal VC admin); a member reads the facts
 * and is told who may change them.
 *
 *   `PUT /api/company/:uid/legal`     legal name, entity type, jurisdiction,
 *                                     registration number, incorporation
 *                                     date and the registered agent (D1593)
 *   `PUT /api/company/:uid/tax-id`    only when Replace was used; the number
 *                                     is shown masked and never echoed back
 *                                     in a refusal
 *   `POST|PATCH …/locations`          the one open mailing address (D1593)
 *
 * A refusal is the Worker's own sentence ("Enter the incorporation date as a
 * real date, YYYY-MM-DD."). No Ask on Account (owner answer Q8).
 */

const LABEL = 'text-[12.5px] font-bold text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12.5px] text-axal-destructive dark:text-red-300';

const TAX_WORDS = { tax_id_invalid: 'That doesn’t look like a tax ID for the kind you chose.', tax_id_kind_invalid: 'Choose whether the tax ID is an EIN, a VAT number or another kind.' };

function Row({ label, children, id, required = false }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className={LABEL}>{label}{required ? <><span aria-hidden="true" className="text-axal-destructive"> *</span><span className="sr-only"> required</span></> : null}</span>
      {children}
    </label>
  );
}

export default function LegalSheet({ uid, companyName, legal, onClose, onSaved }) {
  const mail = legal?.mailing_address?.available ? legal.mailing_address.value : null;
  const tax = legal?.tax_id?.available ? legal.tax_id.value : null;
  const [f, setF] = useState({
    legal_name: legal?.legal_name || '', legal_form: legal?.legal_form || '', jurisdiction: legal?.jurisdiction || '',
    registration_number: legal?.registration_number || '', incorporation_date: legal?.incorporation_date || '',
    registered_agent_name: legal?.registered_agent_name || '',
    mail_line1: mail?.line1 || '', mail_city: mail?.city || '', mail_postal: mail?.postal_code || '', mail_country: mail?.country || '',
  });
  const [replacing, setReplacing] = useState(!tax?.recorded);
  const [taxKind, setTaxKind] = useState(tax?.kind || 'ein');
  const [taxValue, setTaxValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (busy) return;
    setBusy(true); setRefusal('');
    const fields = {};
    for (const k of ['legal_name', 'legal_form', 'jurisdiction', 'registration_number', 'incorporation_date', 'registered_agent_name']) {
      const was = legal?.[k] || '';
      if (f[k].trim() !== was) fields[k] = f[k].trim() || null;
    }
    try {
      if (Object.keys(fields).length) {
        const out = await portfolio.saveLegal(uid, fields);
        if (!out.available) { setRefusal(out.refused ? out.reason : 'The legal facts could not be saved. Try again.'); return; }
      }
      if (replacing && taxValue.trim()) {
        const out = await portfolio.saveTaxId(uid, taxKind, taxValue.trim());
        if (!out.available) { setRefusal(TAX_WORDS[out.code] || (out.refused ? out.reason : 'The tax ID could not be saved. Try again.')); return; }
      }
      const mailing = { line1: f.mail_line1.trim() || null, city: f.mail_city.trim() || null, postal_code: f.mail_postal.trim() || null, country: f.mail_country.trim().toUpperCase() || null };
      const changedMail = mail
        ? ['line1', 'city', 'postal_code', 'country'].some((k) => (mail[k] || null) !== mailing[k])
        : !!(mailing.line1 || mailing.city);
      if (changedMail && mailing.country) {
        const out = mail ? await portfolio.editLocation(uid, mail.uid, mailing) : await portfolio.addLocation(uid, { kind: 'mailing', ...mailing });
        if (!out.available) { setRefusal(out.refused ? out.reason : 'The mailing address could not be saved. Try again.'); return; }
      } else if (changedMail) {
        setRefusal('Enter the mailing address’s country as a two-letter code, for example GB.'); return;
      }
      onSaved();
    } catch (e) {
      reportError('portfolio:legal', e);
      setRefusal('The legal facts could not be saved. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Edit legal facts" sub={`${companyName} · Company settings › Legal`} width={520} onClose={() => { if (!busy) onClose(); }} testId="legal-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy} data-testid="legal-sheet-save">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <Row label="Legal name" id="lg-name"><input id="lg-name" className={FIELD} value={f.legal_name} onChange={set('legal_name')} data-testid="legal-name" /></Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Entity type" id="lg-form">
            <select id="lg-form" className={FIELD} value={f.legal_form} onChange={set('legal_form')} data-testid="legal-form">
              <option value="">Not recorded</option>
              {LEGAL_FORMS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}
            </select>
          </Row>
          <Row label="Jurisdiction" id="lg-jur">
            <input id="lg-jur" className={FIELD} value={f.jurisdiction} onChange={set('jurisdiction')} placeholder="US-DE or GB" data-testid="legal-jurisdiction" />
          </Row>
          <Row label="Registration number" id="lg-reg"><input id="lg-reg" className={FIELD} value={f.registration_number} onChange={set('registration_number')} /></Row>
          <Row label="Incorporation date" id="lg-date"><input id="lg-date" type="date" className={FIELD} value={f.incorporation_date} onChange={set('incorporation_date')} data-testid="legal-date" /></Row>
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Tax ID</span>
          {!replacing ? (
            <span className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-axal-ink dark:text-gray-100" data-testid="legal-tax-masked">{maskedTaxId(tax?.last4)}</span>
              <button type="button" className={BTN_TEXT} onClick={() => setReplacing(true)} data-testid="legal-tax-replace">Replace</button>
            </span>
          ) : (
            <span className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
              <select aria-label="Tax ID kind" className={FIELD} value={taxKind} onChange={(e) => setTaxKind(e.target.value)}>
                <option value="ein">EIN</option><option value="vat">VAT</option><option value="other">Other</option>
              </select>
              <input aria-label="Tax ID" className={FIELD} value={taxValue} onChange={(e) => setTaxValue(e.target.value)} autoComplete="off" data-testid="legal-tax-input" />
            </span>
          )}
        </div>
        <Row label="Registered agent" id="lg-agent">
          <input id="lg-agent" className={FIELD} value={f.registered_agent_name} onChange={set('registered_agent_name')} placeholder="The agent who receives legal mail" data-testid="legal-agent" />
        </Row>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>Mailing address</legend>
          <span className={MUTED}>Where other mail goes, if not the registered address.{mail ? ` Now: ${addressLine(mail)}.` : ''}</span>
          <input aria-label="Street" className={FIELD} value={f.mail_line1} onChange={set('mail_line1')} placeholder="Street" data-testid="legal-mail-line1" />
          <div className="grid gap-2 sm:grid-cols-[1fr_110px_80px]">
            <input aria-label="City" className={FIELD} value={f.mail_city} onChange={set('mail_city')} placeholder="City" />
            <input aria-label="Postcode" className={FIELD} value={f.mail_postal} onChange={set('mail_postal')} placeholder="Postcode" />
            <input aria-label="Country code" className={FIELD} value={f.mail_country} maxLength={2} onChange={set('mail_country')} placeholder="GB" />
          </div>
        </fieldset>
        <p className={`m-0 ${MUTED}`}>Saving changes the company’s record here. Filed documents do not change.</p>
        {refusal ? <p role="alert" className={ERR} data-testid="legal-sheet-refusal">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}
