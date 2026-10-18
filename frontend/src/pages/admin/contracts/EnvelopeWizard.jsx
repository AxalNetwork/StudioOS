import React, { useEffect, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { SidePanel, ReadState, useRead, button, input, pdfBlob, Pagination } from './parts';

const steps = ['Template', 'Recipient', 'Fields', 'Deal', 'Provider', 'Preview and send'];
const PAGE_LABELS = { letter: 'Letter', a4: 'A4' };
const COVER_LABELS = { dark: 'Dark cover', light: 'Light cover' };

/** The preview and send body. D711: `page_size` and `cover` are the paper every copy prints on. */
export function envelopeBody({ template, name, email, fields, deal, provider, pageSize = 'letter', cover = 'dark' }) {
  return { template_slug: template?.slug, template_version: template?.version,
    recipient_name: name, recipient_email: email, fields, deal_id: deal?.id ?? null, provider, page_size: pageSize, cover };
}

export default function EnvelopeWizard({ onClose, onTemplates, onSent }) {
  const templates = useRead(() => contractsApi.published());
  const providers = useRead(() => contractsApi.providers());
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientOffset, setRecipientOffset] = useState(0);
  const recipients = useRead(() => contractsApi.recipients({ q: recipientQuery, limit: 25, offset: recipientOffset }), [recipientQuery, recipientOffset]);
  const [dealQuery, setDealQuery] = useState('');
  const [dealOffset, setDealOffset] = useState(0);
  const deals = useRead(() => contractsApi.deals({ q: dealQuery, limit: 25, offset: dealOffset }), [dealQuery, dealOffset]);
  const [fields, setFields] = useState({});
  const [deal, setDeal] = useState(null);
  const [provider, setProvider] = useState('native');
  const [pageSize, setPageSize] = useState('letter');
  const [cover, setCover] = useState('dark');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const body = envelopeBody({ template, name, email, fields, deal, provider, pageSize, cover });
  const serialized = JSON.stringify(body);
  useEffect(() => { setPreview(null); setError(''); }, [serialized]);
  useEffect(() => {
    if (!preview) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(pdfBlob(preview.pdf_base64)); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  function validate() {
    if (!template) return 'No published template. Publish one under Templates first.';
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return 'Enter the recipient’s name and a valid email.';
    const missing = template.fields.filter(f => f.required && !fields[f.key]?.trim());
    if (missing.length) return `A required field is missing: ${missing.map(f => f.label).join(', ')}.`;
    if (provider === 'docusign' && !providers.data?.docusign?.available) return `DocuSign not available. ${providers.data?.docusign?.reason || 'Signing providers could not be read.'}`;
    return '';
  }
  async function prepare() {
    const message = validate(); if (message) { setError(message); return; }
    setBusy(true); setError('');
    try { setPreview(await contractsApi.preview(body)); }
    catch (e) { reportError('contracts:preview', e); setError(e.code === 'published_version_changed' ? 'The published version changed. Choose the template again; nothing was sent.'
      : e.code === 'required_fields_missing' ? `Not recorded: ${(e.data?.fields || []).join(', ') || 'a required recipient field'}. The recipient record must supply this value; nothing was sent.`
        : 'The preview could not be prepared. Nothing was sent. Try again.'); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      const result = await contractsApi.send({ ...body, preview_sha256: preview.body_sha256 });
      setOutcome(result); onSent(result);
    } catch (e) {
      reportError('contracts:send', e);
      setError(e.code === 'send_unconfirmed' || !e.status || e.status >= 500
        ? 'The send could not be confirmed. Check Agreements before retrying.'
        : e.status === 412 || e.status === 402 ? 'DocuSign not available. Connect it or choose Native.'
          : e.code === 'preview_changed' || e.code === 'published_version_changed' ? 'The document changed. Preview it again before sending.'
            : 'The send failed. Nothing was sent. Try again.');
      setPreview(null);
    } finally { setBusy(false); }
  }
  return <SidePanel title="New envelope" onClose={onClose}>
    <nav aria-label="Envelope steps" className="flex flex-wrap gap-2">{steps.map((label, i) => <button key={label} type="button" className={button} aria-current={step === i ? 'step' : undefined} disabled={busy || !!outcome} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</nav>
    <ReadState read={templates} what="Published templates">
      {!templates.loading && !templates.error && !templates.data?.items?.length && <div><b>No published template.</b><p>Publish a template under Templates first.</p><button type="button" className={button} onClick={onTemplates}>Open Templates</button></div>}
      {step === 0 && templates.data?.items?.length > 0 && <div className="space-y-2">{templates.data.items.map(t => <button key={t.slug} type="button" className={`${button} block w-full text-left ${template?.slug === t.slug ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`} onClick={() => { setTemplate(t); setFields({}); }}>{t.title} · v{t.version}</button>)}</div>}
    </ReadState>
    {step === 1 && <div className="space-y-3"><label>Find by name or email<input className={input} value={recipientQuery} onChange={e => { setRecipientQuery(e.target.value); setRecipientOffset(0); }} /></label>
      <ReadState read={recipients} what="Recipients">{recipients.data && <><div>{recipients.data.items.map(r => <button type="button" className={`${button} block w-full text-left`} key={r.id} onClick={() => { setName(r.name || ''); setEmail(r.email); }}>{r.name} · {r.email}</button>)}</div><Pagination data={recipients.data} offset={recipientOffset} onPage={setRecipientOffset} /></>}</ReadState>
      <p>Or a new email, with a name</p><label>Recipient name<input required maxLength={200} className={input} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Recipient email<input required type="email" maxLength={254} className={input} value={email} onChange={e => setEmail(e.target.value)} /></label></div>}
    {step === 2 && <div className="space-y-3">{!template ? <p>Choose a published template first.</p> : template.fields.map(f => f.required ? <label key={f.key} className="block">{f.label} · required<input required className={input} maxLength={1000} value={fields[f.key] || ''} onChange={e => setFields(current => ({ ...current, [f.key]: e.target.value }))} /></label> : <p key={f.key}>{f.label}: filled from the recipient or effective date.</p>)}</div>}
    {step === 3 && <div className="space-y-3"><label>Find a deal<input className={input} value={dealQuery} onChange={e => { setDealQuery(e.target.value); setDealOffset(0); }} /></label>
      <button type="button" className={button} onClick={() => setDeal(null)}>No linked deal</button><p>{deal ? `${deal.project_name} · ${deal.uid}` : 'Deal linking is optional.'}</p>
      <ReadState read={deals} what="Deals">{deals.data && <><div>{deals.data.items.map(d => <button type="button" className={`${button} block w-full text-left`} key={d.id} onClick={() => setDeal(d)}>{d.project_name} · {d.uid}</button>)}</div><Pagination data={deals.data} offset={dealOffset} onPage={setDealOffset} /></>}</ReadState></div>}
    {step === 4 && <ReadState read={providers} what="Signing providers"><div className="space-y-2"><button type="button" className={button} aria-pressed={provider === 'native'} onClick={() => setProvider('native')}>Native · signed in the app</button>
      <button type="button" className={button} aria-pressed={provider === 'docusign'} disabled={!providers.data?.docusign?.available} onClick={() => setProvider('docusign')}>DocuSign · Studio plan</button>
      {!providers.data?.docusign?.available && <p>DocuSign not available. {providers.data?.docusign?.reason}</p>}
      <p>Paper</p><div className="flex flex-wrap gap-2">{Object.entries(PAGE_LABELS).map(([key, label]) => <button key={key} type="button" className={button} aria-pressed={pageSize === key} onClick={() => setPageSize(key)}>{label}</button>)}</div>
      <div className="flex flex-wrap gap-2">{Object.entries(COVER_LABELS).map(([key, label]) => <button key={key} type="button" className={button} aria-pressed={cover === key} onClick={() => setCover(key)}>{label}</button>)}</div></div></ReadState>}
    {step === 5 && <div className="space-y-3"><p>{template?.title} · v{template?.version} · {name} · {email} · {provider} · {PAGE_LABELS[pageSize]} · {COVER_LABELS[cover]}</p>
      <button type="button" className={button} disabled={busy || !!outcome} onClick={prepare}>{busy ? 'Working…' : 'Preview PDF'}</button>
      {previewUrl && <iframe title="Envelope preview" src={previewUrl} className="h-96 w-full border border-axal-hairline" />}
      <button type="button" className={`${button} bg-violet-600 text-white`} disabled={!preview || busy || !!outcome} onClick={send}>Send</button></div>}
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {outcome && <p role="status">{outcome.already_pending ? 'An envelope is already awaiting this recipient; no duplicate was sent.' : outcome.email_sent ? 'Envelope sent.' : 'The envelope was created, but its invitation was not sent. Open it in Agreements and try Resend.'}</p>}
    {!outcome && <div className="flex justify-between"><button type="button" className={button} disabled={step === 0 || busy} onClick={() => setStep(n => n - 1)}>Back</button><button type="button" className={button} disabled={step === 5 || busy} onClick={() => setStep(n => n + 1)}>Continue</button></div>}
  </SidePanel>;
}
