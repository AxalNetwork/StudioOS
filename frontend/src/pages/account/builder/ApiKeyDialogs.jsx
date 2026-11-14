/**
 * D1317 (#2480) — the API keys page's dialogs (APIK2, APIK3, APIK6, APIK7, and
 * the name-and-limit edit on D841's PATCH). None has an address of its own, so
 * a secret is never in a URL, a history entry or a reload.
 *
 * THE SECRET. `RevealDialog` is the only component that draws one, from the
 * `secret` prop its parent was handed by a 201 (create or rotate). After Copy
 * the field masks to the key's prefix and cannot be unmasked. The parent drops
 * the secret on Done, on close and on unmount. Nothing here logs it, reports it
 * or puts it in storage, and the field is excluded from capture
 * (`data-private`, `ph-no-capture`).
 */
import { useEffect, useRef, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { BTN, INPUT } from '../AccountCenter';
import {
  EXPIRY_OPTIONS, NAME_MAX, WORDS, blankForm, createBody, createErrors, limitFrom, previewOf, refusalWords, summaryOf, usd,
} from './apiKeysModel';

const LABEL = 'text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const HELP = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const ERR = 'm-0 text-[12px] font-semibold text-red-700 dark:text-red-300';
const NOTE_WARN = 'm-0 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const NOTE_BAD = 'm-0 rounded-axal-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const MONO = 'font-mono tabular-nums';

function Footer({ children }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

/** APIK2: create a key from what the read offered. `initial` prefills a replacement (APIK8). */
export function CreateDialog({ read, initial = null, api, onCreated, onClose, now = new Date() }) {
  const [form, setForm] = useState(() => ({ ...blankForm(), ...(initial || {}) }));
  const [shown, setShown] = useState({});
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, id) => setForm((f) => {
    const has = f[k].includes(String(id));
    return { ...f, [k]: has ? f[k].filter((x) => x !== String(id)) : [...f[k], String(id)] };
  });
  const submit = async () => {
    const errs = createErrors(form, read);
    setShown(errs);
    if (Object.keys(errs).length || busy) return;
    setBusy(true); setRefusal('');
    try {
      const res = await api.create(createBody(form, read));
      onCreated(res);
    } catch (e) {
      setRefusal(refusalWords(e, { fallback: 'The key was not created. Try again.' }));
      setBusy(false);
    }
  };
  return (
    <Lightbox label={WORDS.dialogTitle} title={WORDS.dialogTitle} onClose={onClose} width={640} phone="full" testId="apik-create"
      footer={<Footer><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button><button type="button" className={BTN.primary} onClick={submit} disabled={busy} data-testid="apik-create-submit">{busy ? 'Creating…' : 'Create key'}</button></Footer>}>
      <div className="flex flex-col gap-4">
        {refusal && <p role="alert" className={NOTE_BAD} data-testid="apik-create-refusal">{refusal}</p>}
        <div className="flex flex-col gap-1">
          <label htmlFor="apik-name" className={LABEL}>Name</label>
          <input id="apik-name" className={INPUT} maxLength={NAME_MAX} value={form.name} placeholder="Deploy bot" autoComplete="off" onChange={(e) => set('name', e.target.value)} data-testid="apik-name" />
          <p className={HELP}>{WORDS.nameHelp}</p>
          {shown.name && <p className={ERR}>{shown.name}</p>}
        </div>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={`${LABEL} mb-1`}>Companies</legend>
          {(read?.companies_available ?? []).map((c) => (
            <label key={c.id} className="flex min-h-[32px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="checkbox" checked={form.companies.includes(String(c.id))} onChange={() => toggle('companies', c.id)} data-testid={`apik-company-${c.id}`} />
              {c.name || `Company ${c.id}`}
            </label>
          ))}
          <p className={HELP}>{WORDS.companiesHelp}</p>
          {shown.companies && <p className={ERR} data-testid="apik-err-companies">{shown.companies}</p>}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={`${LABEL} mb-1`}>Permissions</legend>
          {(read?.scopes_available ?? []).map((s) => (
            <label key={s.name} className="flex min-h-[32px] items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="checkbox" className="mt-1" checked={form.scopes.includes(s.name)} onChange={() => toggle('scopes', s.name)} data-testid={`apik-scope-${s.name}`} />
              <span className="flex flex-col">
                <span>{s.label}{s.write && <span className="ml-1.5 rounded-axal-pill border border-amber-300 px-1.5 text-[10.5px] font-bold text-amber-900 dark:border-amber-800 dark:text-amber-200">Write</span>}</span>
                {s.write && <span className={HELP}>{WORDS.writeLine}</span>}
              </span>
            </label>
          ))}
          <p className={HELP}>{WORDS.cannot}</p>
          {shown.scopes && <p className={ERR} data-testid="apik-err-scopes">{shown.scopes}</p>}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL} id="apik-expiry-label">Expires</span>
          <div role="radiogroup" aria-labelledby="apik-expiry-label" className="flex flex-wrap gap-1">
            {EXPIRY_OPTIONS.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={form.expiry === o.id} onClick={() => set('expiry', o.id)} data-testid={`apik-expiry-${o.id}`}
                className={`min-h-[36px] rounded-axal-sm px-3 text-[12.5px] font-semibold ${form.expiry === o.id ? 'bg-axal-violet text-white' : 'border border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`}>{o.label}</button>
            ))}
          </div>
          {form.expiry === 'never' && <p className={NOTE_WARN} data-testid="apik-never">{WORDS.never}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="apik-limit" className={LABEL}>{WORDS.limitLabel}</label>
          <div className="flex items-center gap-1.5"><span className={`${MONO} text-[13px] text-axal-muted dark:text-gray-400`}>$</span>
            <input id="apik-limit" inputMode="decimal" className={`${INPUT} ${MONO} max-w-[160px]`} value={form.limit} placeholder="20.00" autoComplete="off" onChange={(e) => set('limit', e.target.value)} data-testid="apik-limit" /></div>
          <p className={HELP}>{WORDS.limitHelp}</p>
          {shown.limit && <p className={ERR}>{shown.limit}</p>}
        </div>
        <p className="m-0 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="apik-summary">{summaryOf(form, read, now)}</p>
      </div>
    </Lightbox>
  );
}

/**
 * APIK3 and APIK6's second crop: the one place a secret is drawn. Done waits
 * for the tick; closing early asks first. After Copy the field shows the key's
 * prefix only, and there is no way back to the secret.
 */
export function RevealDialog({ title, okLine, oldLine = null, secret, keyView, onDone, clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null }) {
  const [masked, setMasked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState(false);
  const [asking, setAsking] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const field = useRef(null);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await clipboard.writeText(secret);
      setMasked(true); setCopied(true); setCopyFailed(false);
    } catch {
      setCopyFailed(true);
      field.current?.select?.();
    }
  };
  const close = () => { if (stored) onDone(); else setAsking(true); };
  return (
    <Lightbox label={title} title={title} onClose={close} onEscape={close} width={640} phone="full" initialFocus={field} testId="apik-reveal"
      footer={<Footer><button type="button" className={BTN.primary} disabled={!stored} onClick={onDone} data-testid="apik-reveal-done">Done</button></Footer>}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">✓ {okLine}</p>
        {oldLine && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="apik-reveal-old">{oldLine}</p>}
        <p className={NOTE_WARN}>{WORDS.revealWarn}</p>
        <div className="flex items-center gap-2">
          <input ref={field} readOnly aria-label="API key, shown once" autoComplete="off" spellCheck={false} data-private="true"
            className={`${INPUT} ${MONO} ph-no-capture flex-1 select-all`} value={masked ? previewOf(keyView) : secret} data-testid="apik-secret" />
          <button type="button" className={BTN.ghost} onClick={copy} disabled={masked} data-testid="apik-copy">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
        {masked && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="apik-copied-line">{WORDS.copiedLine}</p>}
        {copyFailed && <p className={ERR}>The key could not be copied. It is selected: copy it with your keyboard.</p>}
        <label className="flex min-h-[32px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} data-testid="apik-stored" />
          {WORDS.stored}
        </label>
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Use it as <code className={MONO}>Authorization: Bearer axk_…</code> on <code className={MONO}>https://axal.vc/mcp</code>.</p>
      </div>
      {asking && (
        <Lightbox label="Close without storing" title="Close without storing the key?" onClose={() => setAsking(false)} width={420} phone="sheet" testId="apik-close-early"
          footer={<Footer><button type="button" className={BTN.primary} onClick={() => setAsking(false)} data-testid="apik-go-back">Go back</button><button type="button" className={BTN.dangerSolid} onClick={onDone} data-testid="apik-close-anyway">Close</button></Footer>}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{WORDS.closeEarly}</p>
        </Lightbox>
      )}
    </Lightbox>
  );
}

/** APIK6's first crop: confirm, then the 201 goes to the reveal. */
export function RotateDialog({ keyView, api, onRotated, onClose }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const go = async () => {
    if (busy) return;
    setBusy(true); setRefusal('');
    try { onRotated(await api.rotate(keyView.uid)); } catch (e) { setRefusal(refusalWords(e, { name: keyView.name })); setBusy(false); }
  };
  const title = `Rotate ${keyView.name}?`;
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={520} phone="sheet" testId="apik-rotate"
      footer={<Footer><button type="button" className={BTN.ghost} onClick={onClose}>Keep</button><button type="button" className={BTN.primary} onClick={go} disabled={busy} data-testid="apik-rotate-go">{busy ? 'Rotating…' : 'Rotate'}</button></Footer>}>
      <div className="flex flex-col gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        {refusal && <p role="alert" className={NOTE_BAD} data-testid="apik-rotate-refusal">{refusal}</p>}
        {WORDS.rotateLines.map((l) => <p key={l} className="m-0">{l}</p>)}
      </div>
    </Lightbox>
  );
}

/** APIK7: the typed name enables Revoke; the row shows Revoked from the response, never before it. */
export function RevokeDialog({ keyView, api, onRevoked, onClose }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const match = typed.trim() === String(keyView.name).trim();
  const go = async () => {
    if (!match || busy) return;
    setBusy(true); setRefusal('');
    try { const r = await api.revoke(keyView.uid); onRevoked(r?.key ?? null); } catch (e) { setRefusal(refusalWords(e, { name: keyView.name })); setBusy(false); }
  };
  const title = `Revoke ${keyView.name}?`;
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={520} phone="sheet" testId="apik-revoke"
      footer={<Footer><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button><button type="button" className={BTN.dangerSolid} onClick={go} disabled={!match || busy} data-testid="apik-revoke-go">{busy ? 'Revoking…' : 'Revoke'}</button></Footer>}>
      <div className="flex flex-col gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        {refusal && <p role="alert" className={NOTE_BAD} data-testid="apik-revoke-refusal">{refusal}</p>}
        {WORDS.revokeLines.map((l) => <p key={l} className="m-0">{l}</p>)}
        <label htmlFor="apik-revoke-name" className={`${LABEL} mt-1`}>{WORDS.revokeConfirm}</label>
        <input id="apik-revoke-name" className={INPUT} value={typed} placeholder={keyView.name} autoComplete="off" onChange={(e) => setTyped(e.target.value)} data-testid="apik-revoke-name" />
      </div>
    </Lightbox>
  );
}

/** A live key's name and monthly limit (D841's PATCH; owner question 4's recommendation). Companies and permissions need a new key. */
export function EditDialog({ keyView, api, onSaved, onClose }) {
  const [name, setName] = useState(keyView.name ?? '');
  const [limit, setLimit] = useState(typeof keyView.monthly_limit_microusd === 'number' ? (keyView.monthly_limit_microusd / 1_000_000).toFixed(2) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    const n = name.trim();
    const l = limitFrom(limit);
    if (!n || n.length > NAME_MAX) { setError('Give the key a name of 1 to 60 characters.'); return; }
    if (!l.ok) { setError('Write an amount in dollars, such as 20.00, or leave it empty.'); return; }
    const body = {};
    if (n !== keyView.name) body.name = n;
    if (l.micro !== (keyView.monthly_limit_microusd ?? null)) body.monthly_limit_microusd = l.micro;
    if (!Object.keys(body).length) { onClose(); return; }
    setBusy(true); setError('');
    try { const r = await api.update(keyView.uid, body); onSaved(r?.key ?? null); } catch (e) { setError(refusalWords(e, { name: keyView.name })); setBusy(false); }
  };
  const title = `Edit ${keyView.name}`;
  const was = usd(keyView.monthly_limit_microusd);
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={520} phone="sheet" testId="apik-edit"
      footer={<Footer><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button><button type="button" className={BTN.primary} onClick={go} disabled={busy} data-testid="apik-edit-save">{busy ? 'Saving…' : 'Save'}</button></Footer>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className={NOTE_BAD} data-testid="apik-edit-error">{error}</p>}
        <div className="flex flex-col gap-1">
          <label htmlFor="apik-edit-name" className={LABEL}>Name</label>
          <input id="apik-edit-name" className={INPUT} maxLength={NAME_MAX} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} data-testid="apik-edit-name" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="apik-edit-limit" className={LABEL}>{WORDS.limitLabel}</label>
          <input id="apik-edit-limit" inputMode="decimal" className={`${INPUT} ${MONO} max-w-[160px]`} value={limit} placeholder="20.00" autoComplete="off" onChange={(e) => setLimit(e.target.value)} data-testid="apik-edit-limit" />
          <p className={HELP}>{was ? `Now ${was} a month. Empty removes the key’s own limit.` : 'No limit of its own now.'} {WORDS.limitHelp}</p>
        </div>
        <p className={HELP}>{WORDS.editLine}</p>
      </div>
    </Lightbox>
  );
}
