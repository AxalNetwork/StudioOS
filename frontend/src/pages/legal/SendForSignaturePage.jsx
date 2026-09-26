import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FileText, Send, Check, ArrowLeft, AlertTriangle, Loader2, Shield, Download, BellRing, Ban, ArrowRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Pill, SectionLabel, Unrecorded, Unreadable, WorkerRail } from '../../ui';

/**
 * Send for Signature — /legal/send, and /legal/send?envelope=<id> (D411).
 *
 * Built from the Send for Signature canvas (design/canvases/backlog/). Two
 * surfaces on one route:
 *
 *   COMPOSE — three steps. Pick a template (`GET /legal/esign/templates`, which
 *   lists only what the caller's role may send, and what the canvas offers that
 *   it may not, each with the Worker's reason). Review & fill: the preview is
 *   the template's own text from `GET /legal/esign/templates/:doc_type`, with
 *   the sender's values dropped into it as they type — the body the envelope
 *   will hash, not a mock-up of it. Send: final terms, the one signer, and the
 *   send. POST /send refuses while any `{{field}}` is blank, so the Continue
 *   button's rule is the server's rule, not a courtesy.
 *
 *   STATUS — `?envelope=<id>`, the page ContractsPage and the completion notices
 *   link to. Lifecycle, signers, the sender's Remind and Void, the executed PDF,
 *   and the audit trail, all from `GET /legal/esign/:id`, whose read scope
 *   (sender, subject, recipient) decides who may see it. Remind and Void show
 *   only when that response says `can_manage` — the sender — and their routes
 *   enforce the same rule.
 *
 * WHAT THE CANVAS DRAWS AND THIS PAGE DOES NOT, each stated on screen with a
 * reason the Worker supplies (`absent` / `not_offered`), never a reason written
 * here: pre-filling from a deal record, quote or match; pre-send checks;
 * ordered signers and the sender's own signature; filing to a data room; signer
 * IP addresses (an open owner decision); and the templates with no wired body.
 * "Copy signing link" became Remind: the link is the recipient's credential and
 * a sender never holds it (D410).
 *
 * THE ROLE SWITCH IS NOT HERE. The canvas toggles Founder / Partner / Advisor to
 * show each role's templates; a signed-in person has one role, and the Worker
 * decides it from the session — GET /templates is scoped by it. An admin sees
 * the union.
 */

const STEPS = [
  { label: 'Pick a template', idle: 'Choose a document' },
  { label: 'Review & fill', idle: 'Terms and recipient' },
  { label: 'Send', idle: 'Final review' },
];

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 '
  + 'focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function StepRail({ step, notes }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 mb-6 text-sm" data-testid="send-step-rail">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = step > n;
        const now = step === n;
        return (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : now
                    ? 'bg-violet-600 text-white'
                    : 'border border-gray-300 text-gray-400 dark:border-gray-700'
              }`}
            >
              {done ? <Check size={13} /> : n}
            </span>
            <span className="flex flex-col leading-tight">
              <span className={now ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}>
                {s.label}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{notes[i] || s.idle}</span>
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

function Refusal({ children }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5" />
      {children}
    </div>
  );
}

/** One sentence a Worker absence carries, printed as the absence it is. */
function Absent({ label, reason, testId }) {
  return (
    <p className="text-xs text-gray-600 dark:text-gray-400" data-testid={testId}>
      <span className="font-medium text-gray-700 dark:text-gray-300">{label}: </span>
      <Unrecorded reason={reason} /> — {reason}
    </p>
  );
}

// The fields the send fills by itself; everything else is the sender's.
const autoValue = (key, rec) => {
  if (key === 'recipient_name') return rec.name || rec.email;
  if (key === 'recipient_email') return rec.email;
  if (key === 'counterparty_name') return rec.name || rec.email;
  return null; // effective_date and counterparty.* are set at send time
};

/**
 * The template text with each `{{field}}` shown as its value, or as its label
 * when still blank — the canvas's highlighted tokens, over the real body.
 */
function Preview({ body, fields, values, rec }) {
  const byKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    const key = m[1];
    const f = byKey[key];
    const v = f?.filled_by === 'send' ? autoValue(key, rec) : values[key];
    parts.push({ token: true, key, text: String(v || '').trim() || `[${f?.label || key}]`, filled: !!String(v || '').trim(), atSend: f?.filled_by === 'send' && !v });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return (
    <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-serif text-[13px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200" data-testid="send-document-preview">
      {parts.map((p, i) => (p.token ? (
        <mark
          key={i}
          title={p.atSend ? 'Filled when the envelope is sent' : undefined}
          className={`rounded px-0.5 ${p.filled ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'}`}
        >
          {p.text}
        </mark>
      ) : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

function Compose({ picker, onSent }) {
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState('');
  const [tpl, setTpl] = useState(null);          // GET /templates/:doc_type
  const [tplErr, setTplErr] = useState('');
  const [values, setValues] = useState({});
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const chosen = useMemo(() => (picker.items || []).find((t) => t.doc_type === docType) || null, [picker, docType]);

  const loadTemplate = useCallback((dt) => {
    setTpl(null);
    setTplErr('');
    api.esignTemplate(dt)
      .then(setTpl)
      .catch((e) => { reportError('SendForSignaturePage:loadTemplate', e); setTplErr(e?.message || 'The template could not be read.'); });
  }, []);

  const pick = (dt) => {
    setDocType(dt);
    setValues({});
    setErr('');
    setStep(2);
    loadTemplate(dt);
  };

  const senderFields = useMemo(() => (tpl?.fields || []).filter((f) => f.filled_by === 'sender'), [tpl]);
  const rec = { email: email.trim().toLowerCase(), name: name.trim() };
  const emailOk = EMAIL_RE.test(rec.email);
  // The recipient's email plus every sender field is what "filled" counts;
  // the name is optional, as the Worker treats it.
  const total = senderFields.length + 1;
  const filled = senderFields.filter((f) => String(values[f.key] || '').trim()).length + (emailOk ? 1 : 0);
  const complete = !!tpl && filled === total;

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      const merge = Object.fromEntries(senderFields.map((f) => [f.key, String(values[f.key] || '').trim()]));
      const r = await api.esignSend({
        document_type: docType,
        recipient_email: rec.email,
        recipient_name: rec.name,
        provider: 'native',
        ...(senderFields.length ? { merge_fields: merge } : {}),
      });
      onSent(r);
    } catch (e) {
      reportError('SendForSignaturePage:send', e);
      setErr(e?.message || 'Could not send the envelope');
      // The server's blank-field refusal sends the sender back to the fields.
      if (e?.code === 'unfilled_fields') setStep(2);
    } finally {
      setBusy(false);
    }
  };

  const notes = [
    step > 1 && chosen ? chosen.name : '',
    step > 2 ? `${filled} of ${total} fields set` : '',
    '',
  ];

  return (
    <>
      <StepRail step={step} notes={notes} />

      {step === 1 && (
        <div className="space-y-3" data-testid="send-step-1">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">What are you sending?</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              The templates your role can send. The recipient signs in the browser from a private link.
            </p>
          </div>

          {picker.items.length === 0 && (
            <Card variant="dashed" className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No templates are available to your role yet.</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Documents you have been asked to sign still appear in your account.</p>
            </Card>
          )}

          {picker.items.map((t) => (
            <Card
              key={t.doc_type}
              as="button"
              type="button"
              onClick={() => pick(t.doc_type)}
              className="w-full text-left hover:border-violet-400"
            >
              <div className="flex items-start gap-3">
                <FileText size={16} className="mt-0.5 text-violet-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{t.name}</span>
                    <Pill tone="info">{t.tag}</Pill>
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t.when}</p>
                  <p className="mt-1 text-xs text-gray-500">{t.meta}</p>
                </div>
                <ArrowRight size={15} className="mt-1 text-gray-400 shrink-0" />
              </div>
            </Card>
          ))}

          {picker.not_offered.length > 0 && (
            <div className="pt-2 space-y-2" data-testid="send-not-offered">
              <SectionLabel>Not sent from this page</SectionLabel>
              {picker.not_offered.map((t) => (
                <div key={t.name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
                  <Pill>{t.tag}</Pill>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t.reason}</span>
                  {t.instead && (
                    <Link to={t.instead.path} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                      {t.instead.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}

          <Card variant="sunken" className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
            <Shield size={14} className="mt-0.5 shrink-0 text-violet-600" />
            <span>
              Every envelope is token-gated per signer, timestamped, and produces an audit trail with the
              executed PDF. Templates are not legal advice — have your own counsel review terms before sending.
            </span>
          </Card>
        </div>
      )}

      {step === 2 && chosen && (
        <div className="space-y-5" data-testid="send-step-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{chosen.name}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">{chosen.when}</p>
            </div>
            <button
              type="button"
              onClick={() => { setStep(1); setErr(''); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft size={14} /> Change template
            </button>
          </div>

          {tplErr && <Unreadable what="The template" claim={tplErr} onRetry={() => loadTemplate(docType)} />}
          {!tpl && !tplErr && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6"><Loader2 size={15} className="animate-spin" /> Loading the template…</div>
          )}

          {tpl && (
            <>
              <Absent label="Pre-fill" reason={tpl.absent.prefill} testId="send-absent-prefill" />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <SectionLabel>Document preview</SectionLabel>
                  <span className="text-xs text-gray-500 dark:text-gray-400" data-testid="send-filled-count">
                    {filled} of {total} fields filled
                  </span>
                </div>
                <Preview body={tpl.body} fields={tpl.fields} values={values} rec={rec} />
                <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="send-signature-blocks">
                  <Card variant="sunken" padding="sm">
                    <SectionLabel tone="faint">Signs</SectionLabel>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{rec.name || rec.email || 'The recipient'}</p>
                    <p className="text-xs text-gray-500">Signature, name and date are captured when they sign.</p>
                  </Card>
                  <Card variant="dashed" padding="sm">
                    <SectionLabel tone="faint">Your signature</SectionLabel>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{tpl.absent.ordered_signers}</p>
                  </Card>
                </div>
              </div>

              <div className="space-y-3">
                <SectionLabel>Recipient</SectionLabel>
                <Field label="Email" hint="The signing link goes here and nowhere else.">
                  <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
                </Field>
                <Field label="Name" hint="Optional. Used in the covering email and on the signature block.">
                  <input type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full legal name" />
                </Field>
              </div>

              <div className="space-y-3" data-testid="send-term-fields">
                <SectionLabel>Terms</SectionLabel>
                {senderFields.length === 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">This template has no terms to fill; its text is fixed.</p>
                )}
                {senderFields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    {f.kind === 'area' ? (
                      <textarea rows={3} className={inputCls} value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                    ) : (
                      <input type="text" className={inputCls} value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                    )}
                  </Field>
                ))}
              </div>

              {err && <Refusal>{err}</Refusal>}

              <button
                type="button"
                disabled={!complete}
                onClick={() => { setErr(''); setStep(3); }}
                className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="send-continue"
              >
                {complete ? 'Continue to review' : 'Fill all fields to continue'}
              </button>
            </>
          )}
        </div>
      )}

      {step === 3 && chosen && tpl && (
        <div className="space-y-5" data-testid="send-step-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Review and send</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Once sent, the signer receives a private link. You can void the envelope until their signature lands.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft size={14} /> Back to fields
            </button>
          </div>

          <Card>
            <SectionLabel>Final terms</SectionLabel>
            <dl className="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800" data-testid="send-final-terms">
              {[['Document', chosen.name], ['Recipient', rec.name ? `${rec.name} · ${rec.email}` : rec.email],
                ...senderFields.map((f) => [f.label, String(values[f.key] || '').trim()])].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-1.5">
                  <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                  <dd className="text-right font-medium text-gray-900 dark:text-gray-100">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <SectionLabel>Signer</SectionLabel>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{rec.name || rec.email}</p>
            <p className="text-xs text-gray-500">{rec.email}</p>
            <div className="mt-2"><Absent label="Signing order" reason={tpl.absent.ordered_signers} testId="send-absent-order" /></div>
          </Card>

          <Absent label="Pre-send checks" reason={tpl.absent.pre_send_checks} testId="send-absent-checks" />

          {err && <Refusal>{err}</Refusal>}

          <button
            type="button"
            disabled={busy}
            onClick={send}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            data-testid="send-envelope"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send for signature
          </button>
          <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Shield size={13} className="mt-0.5 shrink-0" />
            Once sent, the document body is fixed and hashed. Changing it means voiding this envelope and sending a new one.
          </p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const AUDIT_LABEL = {
  envelope_created: 'Envelope created and sent',
  email_sent: 'Signing email delivered',
  email_failed: 'Signing email could not be sent',
  envelope_viewed: 'Signing link opened',
  envelope_signed: 'Signed',
  envelope_rejected: 'Declined',
  envelope_voided: 'Voided by the sender',
  reminder_sent: 'Reminder sent',
  reminder_failed: 'Reminder could not be sent',
  document_downloaded: 'Executed PDF downloaded',
  document_downloaded_by_recipient: 'Executed PDF downloaded by the recipient',
  document_forwarded: 'Executed PDF forwarded',
};

const RECIPIENT_STATE = {
  pending: ['Awaiting signature', 'neutral'],
  signing: ['Signing', 'info'],
  signed: ['Signed', 'ok'],
  rejected: ['Declined', 'danger'],
  void: ['Voided', 'warn'],
};

function EnvelopeStatus({ id }) {
  const [env, setEnv] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [actionErr, setActionErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(() => {
    setLoadErr(null);
    api.esignDetail(id)
      .then(setEnv)
      .catch((e) => { reportError('SendForSignaturePage:loadEnvelope', e); setLoadErr(e); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (what, fn) => {
    setBusy(what);
    setActionErr('');
    setNotice('');
    try {
      const r = await fn();
      if (what === 'remind') {
        const renewed = (r?.results || []).some((x) => x.link_renewed);
        setNotice(renewed ? 'Reminder sent with a fresh link; the old one had expired.' : 'Reminder sent.');
      }
      if (what === 'void') { setConfirmVoid(false); setNotice('Envelope voided. Its link no longer opens the document.'); }
      load();
    } catch (e) {
      reportError(`SendForSignaturePage:${what}`, e);
      setActionErr(e?.message || 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  if (loadErr) {
    if (loadErr?.status === 404) {
      return <Card variant="dashed"><p className="text-sm text-gray-700 dark:text-gray-300">No envelope with that number is visible to you.</p></Card>;
    }
    return <Unreadable what="This envelope" claim="Its status is not shown." onRetry={load} />;
  }
  if (!env) {
    return <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading the envelope…</div>;
  }

  const audit = env.audit_log || [];
  const first = (action) => audit.find((a) => a.action === action)?.ts || null;
  const recs = env.recipients || [];
  const status = String(env.status);
  const voided = status === 'void' || status === 'voided';
  const executed = status === 'completed';
  const pending = status === 'sent' || status === 'partially_signed';
  const outstanding = recs.filter((r) => r.status === 'pending');

  const lifecycle = [
    ['Sent', first('envelope_created') || env.created_at],
    ['Viewed', first('envelope_viewed')],
    [voided ? 'Voided' : status === 'rejected' ? 'Declined' : 'Signed',
      voided ? first('envelope_voided') : status === 'rejected' ? first('envelope_rejected') : (env.completed_at || first('envelope_signed'))],
  ];

  const heading = executed ? 'Fully executed' : voided ? 'Voided' : status === 'rejected' ? 'Declined'
    : first('envelope_viewed') ? 'Viewed — awaiting signature' : 'Out for signature';

  return (
    <div className="space-y-5" data-testid="send-status-view">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{heading}</h2>
          <Pill tone={executed ? 'ok' : voided || status === 'rejected' ? 'warn' : 'info'} dot>{env.document_title}</Pill>
        </div>
        <p className="mt-1 font-mono text-xs text-gray-500">Envelope {env.envelope_uuid} · sent {fmt(env.created_at)}</p>
      </div>

      <ol className="grid grid-cols-3 gap-2" data-testid="send-lifecycle">
        {lifecycle.map(([label, when]) => (
          <li key={label} className={`rounded-lg border p-3 text-sm ${!when ? 'border-gray-200 dark:border-gray-800'
            : label === 'Voided' || label === 'Declined' ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
              : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'}`}>
            <div className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-gray-100">
              {!when ? <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-700" />
                : label === 'Voided' || label === 'Declined' ? <Ban size={13} className="text-amber-600" />
                  : <Check size={13} className="text-emerald-600" />}
              {label}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">{when ? fmt(when) : 'Not yet'}</div>
          </li>
        ))}
      </ol>

      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>Signers</SectionLabel>
          <span className="text-xs text-gray-500">
            {executed ? 'All signatures collected' : `${outstanding.length} of ${recs.length} outstanding`}
          </span>
        </div>
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800" data-testid="send-signers">
          {recs.map((r) => {
            const [label, tone] = RECIPIENT_STATE[r.status] || [r.status, 'neutral'];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.recipient_name || r.recipient_email}</p>
                  <p className="text-xs text-gray-500">{r.recipient_email}{r.signed_at ? ` · signed ${fmt(r.signed_at)}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={tone}>{label}</Pill>
                  {env.can_manage && pending && r.status === 'pending' && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => act('remind', () => api.esignRemind(env.id))}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      data-testid="send-remind"
                    >
                      {busy === 'remind' ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />} Remind
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {notice && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{notice}</p>}
      {actionErr && <Refusal>{actionErr}</Refusal>}

      {pending && (
        <Card variant="accent" data-testid="send-outstanding">
          <SectionLabel tone="violet">Outstanding</SectionLabel>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {first('envelope_viewed')
              ? `${outstanding[0]?.recipient_name || outstanding[0]?.recipient_email || 'The recipient'} has opened it`
              : `Waiting on ${outstanding[0]?.recipient_name || outstanding[0]?.recipient_email || 'the recipient'}`}
          </p>
          {outstanding[0]?.token_expires_at && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              The signing link stays live until the envelope is voided or it expires on {fmt(outstanding[0].token_expires_at)}.
              A reminder after that sends a fresh link.
            </p>
          )}
          {env.can_manage && !confirmVoid && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setConfirmVoid(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
              data-testid="send-void"
            >
              <Ban size={14} /> Void envelope
            </button>
          )}
          {env.can_manage && confirmVoid && (
            <div className="mt-3 space-y-2">
              <Field label="Why are you voiding it?" hint="Optional. Kept on the audit trail.">
                <input type="text" maxLength={500} className={inputCls} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act('void', () => api.esignVoid(env.id, voidReason.trim()))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  data-testid="send-void-confirm"
                >
                  {busy === 'void' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Void it
                </button>
                <button type="button" onClick={() => setConfirmVoid(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
                  Keep it
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {executed && (
        <Card variant="accent" data-testid="send-executed">
          <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-gray-100"><Check size={15} className="text-emerald-600" /> Fully executed</div>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">All signatures collected. Both parties were notified; the executed PDF is here.</p>
          <div className="mt-2"><Absent label="Data room" reason={env.absent?.data_room} testId="send-absent-dataroom" /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={api.esignDocumentUrl(env.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              data-testid="send-download"
            >
              <Download size={14} /> Download executed PDF
            </a>
            <a href="#audit-trail" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
              View audit trail
            </a>
          </div>
        </Card>
      )}

      <Card id="audit-trail">
        <SectionLabel>Audit trail</SectionLabel>
        <ol className="mt-2 space-y-1.5" data-testid="send-audit-trail">
          {[...audit].reverse().map((a, i) => (
            <li key={i} className="flex justify-between gap-4 text-sm">
              <span className="text-gray-800 dark:text-gray-200">{AUDIT_LABEL[a.action] || a.action.replace(/_/g, ' ')}</span>
              <span className="shrink-0 text-xs text-gray-500">{fmt(a.ts)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3"><Absent label="IP addresses" reason={env.absent?.signer_ip} testId="send-absent-ip" /></div>
      </Card>

      <Link to="/legal/send" className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline dark:text-violet-400">
        <Send size={14} /> Send another document
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

export default function SendForSignaturePage() {
  const [params, setParams] = useSearchParams();
  const envelopeParam = params.get('envelope');
  const envelopeId = /^\d{1,12}$/.test(envelopeParam || '') ? envelopeParam : null;
  const [picker, setPicker] = useState(null);
  const [pickerErr, setPickerErr] = useState('');
  const [pendingNote, setPendingNote] = useState('');

  const loadPicker = useCallback(() => {
    setPickerErr('');
    api.esignTemplates()
      .then((r) => setPicker({
        items: Array.isArray(r?.items) ? r.items : [],
        not_offered: Array.isArray(r?.not_offered) ? r.not_offered : [],
        absent: r?.absent || {},
      }))
      .catch((e) => { reportError('SendForSignaturePage:loadTemplates', e); setPickerErr(e?.message || 'Could not load templates'); });
  }, []);
  useEffect(() => { loadPicker(); }, [loadPicker]);

  const onSent = (r) => {
    setPendingNote(r?.already_pending
      ? 'You already have this document out for signature with this recipient, so nothing new was sent. Here it is.'
      : '');
    setParams({ envelope: String(r.envelope_id) });
  };

  const coverage = envelopeId
    ? ['One envelope, read through its signing scope', 'Remind and void are the sender’s']
    : [
      picker ? `${picker.items.length} template${picker.items.length === 1 ? '' : 's'} you can send` : 'Templates loading',
      picker ? `${picker.not_offered.length} drawn on the canvas and not sent from here` : '',
    ].filter(Boolean);

  return (
    <div className="p-6 max-w-6xl mx-auto grid gap-6 lg:grid-cols-[minmax(0,1fr)_var(--fwr-track,286px)]">
      <main className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Send className="w-6 h-6 text-violet-600" /> Send for signature
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-6">
          One recipient per envelope. They sign in the browser from a private link, and you are notified when it is executed.
        </p>

        {envelopeId ? (
          <>
            {pendingNote && <p className="mb-4 text-sm text-amber-800 dark:text-amber-300" role="status">{pendingNote}</p>}
            <EnvelopeStatus key={envelopeId} id={envelopeId} />
          </>
        ) : pickerErr ? (
          <Unreadable what="Your templates" claim={pickerErr} onRetry={loadPicker} />
        ) : !picker ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading templates…</div>
        ) : (
          <Compose picker={picker} onSent={onSent} />
        )}
      </main>
      <WorkerRail
        workspace="Send for signature"
        // A literal, and the right one: the canvas draws this page in violet
        // (#7c3aed) for every role it serves, which is the founder accent.
        // branch_rail_mount.test.mjs caps computed rail roles at five.
        role="founder"
        className="self-start lg:sticky lg:top-4"
        stance="You choose, fill and send"
        note="Nothing here is drafted for you. The document is the template’s own text with your values in it, and it is fixed and hashed when it is sent."
        coverage={coverage}
        unavailable={picker?.absent ? [
          ['Pre-fill', picker.absent.prefill],
          ['Pre-send checks', picker.absent.pre_send_checks],
          ['Signing order', picker.absent.ordered_signers],
        ].filter(([, why]) => why) : []}
      />
    </div>
  );
}
