import { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { errorSentence } from '../account/notionModel';

/**
 * D1087 (#2952, #2405 part 3) — "Import this interview": the Accept of an
 * interview page from Notion, on Customer research's From Notion.
 *
 * Nothing is stored until the founder records that the interviewee consented,
 * how and when (D656, D667). Without the tick the button stays off; the Worker
 * refuses it anyway with `consent_not_given`. The interviewee is a label, and
 * optionally a role and a company: never an email address or a phone number,
 * which the Worker refuses. The notes are read from Notion as of now; a page
 * that changed since it was proposed is refused until it is synced again.
 */
export const CONSENT_METHODS = Object.freeze([['verbal', 'Said yes, out loud'], ['written', 'In writing'], ['in_app', 'In the app'], ['pre_agreed', 'Agreed beforehand']]);
export const CHANNEL_WORDS = Object.freeze([['manual', 'Typed notes'], ['in_person', 'In person'], ['video', 'Video call'], ['phone', 'Phone call'], ['text', 'Text chat']]);
export const NO_CONSENT_NOTE = 'Without the interviewee’s consent, nothing from this page is stored.';

const today = () => new Date().toISOString().slice(0, 10);

/** The Accept body the Worker takes, from the dialog's answers; null while consent is not given. */
export function importBody(f) {
  if (!f.consented || !f.method || !f.consentOn || !f.label.trim() || !f.date) return null;
  const interviewee = { label: f.label.trim() };
  if (f.role.trim()) interviewee.role = f.role.trim();
  if (f.company.trim()) interviewee.company = f.company.trim();
  return {
    interviewee,
    occurred_at: f.date,
    channel: f.channel || 'manual',
    consent: { status: 'given', method: f.method, recorded_at: `${f.consentOn}T12:00:00.000Z` },
  };
}

export default function NotionInterviewImport({ proposal, onClose, onAccept }) {
  const [f, setF] = useState({ label: proposal?.title || '', role: '', company: '', date: '', channel: 'manual', consented: false, method: '', consentOn: today() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const body = importBody(f);
  const go = async () => {
    if (!body) return;
    setBusy(true); setError(null);
    try { await onAccept(body); } catch (e) { setError(errorSentence(e, 'The interview could not be imported. Try again.')); setBusy(false); }
  };
  return (
    <Lightbox label="Import this interview" title="Import this interview" sub={`“${proposal?.title || 'This page'}” from Notion`} onClose={() => { if (!busy) onClose(); }} width={520} testId="notion-interview-import" phone="sheet"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!f.consented && <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400" data-testid="notion-interview-no-consent">{NO_CONSENT_NOTE}</span>}
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={!body || busy} data-testid="notion-interview-confirm">{busy ? 'Importing…' : 'Import interview'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">The page’s notes become this interview’s transcript in Customer research. Nothing reaches another module until you structure it and accept a placement.</p>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>The interviewee</legend>
          <label className="flex flex-col gap-1"><span className={LABEL}>Label</span><input className={INPUT} value={f.label} onChange={set('label')} maxLength={80} data-testid="notion-interview-label" /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className={LABEL}>Role (optional)</span><input className={INPUT} value={f.role} onChange={set('role')} maxLength={80} /></label>
            <label className="flex flex-col gap-1"><span className={LABEL}>Company (optional)</span><input className={INPUT} value={f.company} onChange={set('company')} maxLength={120} /></label>
          </div>
          <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">A label, a role and a company only. An email address or a phone number is not stored.</p>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className={LABEL}>When it took place</span><input type="date" className={INPUT} value={f.date} onChange={set('date')} max={today()} data-testid="notion-interview-date" /></label>
          <label className="flex flex-col gap-1"><span className={LABEL}>How it took place</span>
            <select className={INPUT} value={f.channel} onChange={set('channel')} data-testid="notion-interview-channel">{CHANNEL_WORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="notion-interview-consent">
          <legend className={`${LABEL} px-1`}>Consent</legend>
          <label className="flex items-start gap-2"><input type="checkbox" checked={f.consented} onChange={set('consented')} data-testid="notion-interview-consented" className="mt-0.5" />
            <span>The interviewee agreed to this interview being recorded and processed by StudioOS.</span></label>
          {f.consented && <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1"><span className={LABEL}>How they agreed</span>
              <select className={INPUT} value={f.method} onChange={set('method')} data-testid="notion-interview-method"><option value="">Choose…</option>{CONSENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className={LABEL}>When they agreed</span><input type="date" className={INPUT} value={f.consentOn} onChange={set('consentOn')} max={today()} data-testid="notion-interview-consent-on" /></label>
          </div>}
        </fieldset>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-interview-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

const LABEL = 'text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const INPUT = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
