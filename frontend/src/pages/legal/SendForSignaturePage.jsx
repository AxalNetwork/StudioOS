import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Send, Check, ArrowLeft, AlertTriangle, Loader2, Shield } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

/**
 * Send for Signature — /legal/send. The half of the e-sign de-admin that was
 * never finished.
 *
 * `POST /api/legal/esign/send` dropped `requireAdmin` in task #156 and has
 * taken plain `requireAuth` ever since. The UI did not follow: the only screen
 * that called it was the "Create envelope" wizard inside AdminPage.jsx, whose
 * template picker sits behind `GET /admin/contracts/templates/legal` —
 * admin-only. So a founder could receive and sign a document and had no way to
 * originate one.
 *
 * The picker here is `GET /legal/esign/templates`, which returns only what the
 * caller's role may actually send. The server does not trust it: POST /send
 * re-checks with `mayOriginate`, because a picker is a convenience and a guard
 * is a guard.
 *
 * Three steps, from the canvas: pick a template, review and fill, send.
 *
 * WHAT THIS PAGE DOES NOT OFFER, and why it says so out loud. The canvas gives
 * founders SAFE and Term Sheet. Neither has a wired template —
 * services/legalTemplates.ts imports nine bodies and those are not among them —
 * so offering either would produce an envelope the platform cannot render. The
 * Co-founder Agreement is absent for the opposite reason: it has its own
 * drafting flow, which is better than a template, and this page links to it.
 *
 * One recipient per envelope, because that is what the route accepts. The
 * admin wizard fakes multi-recipient by sending N envelopes; saying "one" is
 * more honest than implying a group signature that does not exist.
 */

const STEPS = ['Pick a template', 'Review & fill', 'Send'];

function Stepper({ step }) {
  return (
    <ol className="flex items-center gap-2 mb-8 text-sm">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const now = step === n;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-violet-600 text-white'
                  : now
                    ? 'border-2 border-violet-600 text-violet-700 dark:text-violet-300'
                    : 'border border-gray-300 text-gray-400 dark:border-gray-700'
              }`}
            >
              {done ? <Check size={13} /> : n}
            </span>
            <span className={now ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}>
              {label}
            </span>
            {n < STEPS.length && <span className="mx-1 text-gray-300 dark:text-gray-700">/</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
      {hint && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 '
  + 'focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export default function SendForSignaturePage() {
  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(null);

  useEffect(() => {
    api.esignTemplates()
      .then((r) => setTemplates(Array.isArray(r?.items) ? r.items : []))
      .catch((e) => { reportError(e); setLoadError(e?.message || 'Could not load templates'); });
  }, []);

  const chosen = useMemo(
    () => (templates || []).find((t) => t.doc_type === docType) || null,
    [templates, docType],
  );

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.esignSend({
        document_type: docType,
        recipient_email: email.trim().toLowerCase(),
        recipient_name: name.trim(),
        provider: 'native',
      });
      setSent(r);
      setStep(3);
    } catch (e) {
      reportError(e);
      setErr(e?.message || 'Could not send the envelope');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={15} className="inline mr-1.5 -mt-0.5" />
          {loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
        <Send className="w-6 h-6 text-violet-600" /> Send for signature
      </h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-6">
        One recipient per envelope. They receive a link, sign in the browser, and both of you
        get the executed copy.
      </p>

      <Stepper step={step} />

      {step === 1 && (
        <div className="space-y-3">
          {templates === null && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-10 justify-center">
              <Loader2 size={15} className="animate-spin" /> Loading templates…
            </div>
          )}

          {templates?.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                No templates are available to your role yet.
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Documents you have been asked to sign still appear in your account.
              </p>
            </div>
          )}

          {(templates || []).map((t) => (
            <button
              key={t.doc_type}
              type="button"
              onClick={() => { setDocType(t.doc_type); setStep(2); }}
              className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-400 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-start gap-3">
                <FileText size={16} className="mt-0.5 text-violet-600 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{t.name}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {t.tag}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t.when}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{t.meta}</p>
                </div>
              </div>
            </button>
          ))}

          {templates?.length > 0 && (
            <p className="pt-2 text-xs text-gray-500 dark:text-gray-400">
              Setting equity between founders?{' '}
              <Link to="/spinout-lab/cofounder-agreement" className="text-violet-600 hover:underline dark:text-violet-400">
                The Co-founder Agreement has its own drafting flow
              </Link>{' '}
              — it collects the split, vesting and IP terms before it drafts anything.
            </p>
          )}
        </div>
      )}

      {step === 2 && chosen && (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="font-semibold text-gray-900 dark:text-gray-100">{chosen.name}</div>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{chosen.when}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{chosen.meta}</p>
          </div>

          <Field label="Recipient email" hint="They must be able to receive mail at this address; nothing is sent anywhere else.">
            <input
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </Field>

          <Field label="Recipient name" hint="Optional. Used in the covering email and on the signature block.">
            <input
              type="text"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Ellis"
            />
          </Field>

          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {err}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setStep(1); setErr(''); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              disabled={!emailOk || busy}
              onClick={send}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send for signature
            </button>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Shield size={13} className="mt-0.5 shrink-0" />
            Once sent, the document body is fixed and hashed. Editing it means voiding this
            envelope and sending a new one.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
            <Check size={16} /> Sent to {email}
          </div>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
            They will get a link to sign in the browser. You can follow its status from your
            account, and you will be emailed when it is executed.
          </p>
          {sent?.envelope_uuid && (
            <p className="mt-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
              Envelope {sent.envelope_uuid}
            </p>
          )}
          <button
            type="button"
            onClick={() => { setStep(1); setDocType(''); setEmail(''); setName(''); setSent(null); }}
            className="mt-4 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          >
            Send another
          </button>
        </div>
      )}
    </div>
  );
}
