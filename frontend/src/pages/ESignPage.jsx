import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { Check, AlertCircle, FileText, Shield, Clock, Eraser, X } from 'lucide-react';
import DocumentBody from '../components/DocumentBody';
import AxalLogo from '../components/AxalLogo';
import { normalizeLegalBody } from '../lib/legalDocFormat';
import { PaperFrame } from '../components/PaperPreview';
import {
  initialSigning,
  signingReducer,
  canSign,
  signingCopy,
  typedSignatureFont,
  drawTypedSignature,
  whenFontReady,
  envelopeShort,
  utcDate,
  utcClock,
} from '../lib/esignSteps';

/**
 * D711 (#1776) — the signer reads the paper they sign. With no paper (the
 * read failed), the body as text, saying so; while it loads, the text alone.
 */
export function SignerPaper({ paper, envelope }) {
  if (paper?.html) return <PaperFrame html={paper.html} title={envelope?.document_title || 'Document'} />;
  return (
    <>
      {!paper?.loading && <p className="mb-3 text-[11px] text-amber-700 dark:text-amber-400" role="status">The formatted page did not load. This is the same text.</p>}
      <DocumentBody text={normalizeLegalBody(envelope?.document_body || '')} className="font-sans text-[13.5px] leading-relaxed text-gray-800 dark:text-gray-200" />
    </>
  );
}

// ---------------------------------------------------------------------------
// D717 (#1857) — signing in four steps, at every width. Each step takes its
// words from a `copy` prop (`signingCopy(envelope)` here; the booklet passes
// its own), so a different envelope changes no layout.
// ---------------------------------------------------------------------------

const BIG_BUTTON = 'w-full min-h-[50px] px-4 rounded-[14px] text-[15px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-[#f4f3f7] disabled:text-[#9a95a6] disabled:cursor-not-allowed dark:disabled:bg-gray-800 dark:disabled:text-gray-500 transition-colors';

/** The phone shell's card: a 44 px top bar, the body, and a footer that sticks to the viewport below `md`. */
export function StepCard({ top, children, footer }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm dark:bg-gray-900 dark:border-gray-800">
      <div className="h-11 px-[18px] flex items-center justify-between gap-3 border-b border-[#ececf1] text-[14px] font-bold text-gray-900 dark:border-gray-800 dark:text-gray-100">
        <div className="flex items-center min-w-0">
          {top.onBack && (
            <button type="button" aria-label="Back" onClick={top.onBack} className="w-11 h-11 -ml-[18px] flex items-center justify-center text-[20px] leading-none text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">‹</button>
          )}
          <span className="truncate">{top.title}</span>
        </div>
        {top.counter && <span className="flex-shrink-0 text-[12px] font-semibold text-gray-500 dark:text-gray-400">{top.counter}</span>}
      </div>
      <div className="px-[18px] py-[14px]">{children}</div>
      {footer && <StepFooter>{footer}</StepFooter>}
    </div>
  );
}

export function StepFooter({ children, className = '' }) {
  return (
    <div className={`sticky bottom-0 md:static z-10 rounded-b-2xl ${className} bg-white border-t border-[#ececf1] px-[18px] pt-3 pb-[26px] md:pb-[18px] dark:bg-gray-900 dark:border-gray-800`}>
      {children}
    </div>
  );
}

export function ReadStep({ copy, envelope, paper, continueDisabled = false, onContinue }) {
  return (
    <StepCard
      top={{ title: copy.readTitle, counter: copy.readCounter }}
      footer={<button type="button" onClick={onContinue} disabled={continueDisabled} className={BIG_BUTTON}>{copy.readContinue}</button>}
    >
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-[#ececf1] dark:border-gray-800">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 dark:bg-indigo-950">
          <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-indigo-600 uppercase tracking-wide dark:text-indigo-400">{envelope.document_type}</div>
          <h1 className="text-lg font-bold text-gray-900 truncate dark:text-gray-100">{envelope.document_title}</h1>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-500">
          <Shield className="w-3 h-3" /> SHA-256 verified
        </div>
      </div>
      <SignerPaper paper={paper} envelope={envelope} />
      <div className="mt-3 pt-3 border-t border-[#ececf1] flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:border-gray-800">
        <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Expires {new Date(envelope.expires_at).toLocaleDateString()}</div>
        <div className="font-mono">{copy.envelopeLine}</div>
      </div>
    </StepCard>
  );
}

export function ConsentStep({ copy, accepted, onAccept, onContinue, onBack }) {
  const row = accepted
    ? 'border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/40'
    : 'border-[#ececf1] dark:border-gray-700';
  return (
    <StepCard
      top={{ title: copy.consentTitle, counter: copy.consentCounter, onBack }}
      footer={<button type="button" onClick={onContinue} disabled={!accepted} className={BIG_BUTTON}>{copy.consentContinue}</button>}
    >
      <label className={`flex items-start gap-3 min-h-[48px] rounded-[12px] border px-3.5 py-3 cursor-pointer ${row}`}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
          className="mt-0.5 w-[22px] h-[22px] flex-shrink-0 rounded border-[#c9c6d2] text-indigo-600 focus:ring-indigo-500 dark:border-gray-600"
        />
        <span className="text-[14px] leading-snug text-gray-800 dark:text-gray-200">{copy.consentText}</span>
      </label>
      <p className="mt-3 text-[11px] text-gray-400">{copy.consentLaw}</p>
    </StepCard>
  );
}

export function AdoptStep({ copy, envelope, mode, name, adopted, disabled, onBack, onName, onMode, onInk, onAdopt }) {
  const option = (value, label) => (
    <label className={`flex-1 min-h-[44px] flex items-center justify-center rounded-[10px] text-[14px] font-semibold cursor-pointer ${mode === value ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-900 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>
      <input type="radio" name="signature-mode" value={value} checked={mode === value} onChange={() => onMode(value)} className="sr-only" />
      {label}
    </label>
  );
  return (
    <StepCard top={{ title: copy.adoptTitle, counter: copy.adoptCounter, onBack }}>
      <p className="text-xs text-gray-500 mb-3">
        {copy.signingAs} <span className="font-medium text-gray-800 dark:text-gray-200">{envelope.recipient_email}</span>
      </p>
      <div role="radiogroup" aria-label="Signature" className="flex gap-1 p-1 mb-3 rounded-[12px] bg-gray-100 dark:bg-gray-800">
        {option('type', copy.modeType)}
        {option('draw', copy.modeDraw)}
      </div>
      {mode === 'type' && <p className="text-[13px] text-gray-600 mb-2 dark:text-gray-400">{copy.typeHint}</p>}
      <input
        type="text"
        aria-label={copy.nameLabel}
        placeholder={copy.nameLabel}
        value={name}
        maxLength={200}
        onChange={(e) => onName(e.target.value)}
        className="w-full mb-3 bg-white border border-gray-300 rounded-[12px] px-3 py-2.5 text-[16px] text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 focus:outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
      />
      <SignaturePad key={mode} copy={copy} mode={mode} name={name} adopted={adopted} disabled={disabled} onInk={onInk} onAdopt={onAdopt} />
    </StepCard>
  );
}

/** Step 4: a sheet over the pad below `md`, a dialog from `md`. Its Sign is the only press that signs. */
export function ConfirmSheet({ copy, adopted, date, submitting, disabled, onSign, onCancel }) {
  const panelRef = useRef(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, submitting]);
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[rgba(24,24,27,.35)] md:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="esign-confirm-title"
        tabIndex={-1}
        className="w-full md:max-w-md bg-white rounded-t-[20px] md:rounded-[20px] pt-[18px] px-[18px] pb-[28px] shadow-xl outline-none dark:bg-gray-900"
      >
        <h2 id="esign-confirm-title" className="text-[17px] font-extrabold text-gray-900 mb-4 dark:text-gray-100">{copy.confirmTitle}</h2>
        <div className="rounded-[12px] border border-[#ececf1] p-3.5 mb-4 font-mono text-[13px] text-gray-800 space-y-1.5 dark:border-gray-800 dark:text-gray-200">
          <div className="flex items-end gap-2">
            <span>{copy.confirmBy}</span>
            <span className="flex-1 border-b border-[#c9c6d2] dark:border-gray-600">
              <img src={adopted.dataUrl} alt={`Signature of ${adopted.name}`} className="h-12 max-w-full object-contain object-left" />
            </span>
          </div>
          <div>{copy.confirmName} {adopted.name}</div>
          <div>{copy.confirmDate} {date}</div>
        </div>
        <button type="button" onClick={onSign} disabled={submitting || disabled} className={BIG_BUTTON}>
          {submitting ? copy.confirmSigning : copy.confirmSign}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="w-full mt-2 min-h-[44px] rounded-[14px] border border-gray-200 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          {copy.confirmCancel}
        </button>
      </div>
    </div>
  );
}

/** After signing, or after declining: the decline never reads as a signature. */
export function DoneScreen({ envelope, done, copy }) {
  const declined = done?.rejected === true;
  const { head } = envelopeShort(envelope?.envelope_uuid);
  return (
    <StepCard
      top={{ title: declined ? copy.declinedTop : copy.doneTop }}
      footer={!declined && copy.doneAction ? <a href={copy.doneAction.href} className={`${BIG_BUTTON} flex items-center justify-center`}>{copy.doneAction.label}</a> : null}
    >
      <div className="py-6 text-center">
        {declined ? (
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center dark:bg-gray-800 dark:border-gray-700">
            <X className="w-7 h-7 text-gray-500" />
          </div>
        ) : (
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center dark:bg-emerald-950 dark:border-emerald-800">
            <Check className="w-7 h-7 text-emerald-600" />
          </div>
        )}
        <h1 className="text-[20px] font-extrabold text-gray-900 mb-2 dark:text-gray-100">{declined ? copy.declinedTitle : copy.doneTitle}</h1>
        {declined ? (
          <p className="text-[13.5px] text-gray-500">{copy.declinedLine}</p>
        ) : (
          <>
            <p className="text-[13.5px] text-gray-500">
              Envelope <span className="font-mono">{head}…</span> · {utcClock(done.signed_at)} UTC · {done.completed ? copy.doneCompleted : copy.donePartial}
            </p>
            <p className="text-xs text-gray-500 mt-4">{copy.doneNext}</p>
          </>
        )}
      </div>
    </StepCard>
  );
}

/**
 * Public eSignature page reached via deal@axal.vc magic link.
 * Token is in the URL path; no auth header required. Server gates by token.
 */
export default function ESignPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [envelope, setEnvelope] = useState(null);
  const [paper, setPaper] = useState({ loading: true });
  // `loadError` gates the whole page (envelope fetch failed — nothing to
  // show). `error` is the inline, in-flow alert for a failed submit/reject
  // once the signing UI is already up. These must stay separate: they used
  // to share one state, so a failed signature submit (which sets it from
  // inside `submit()`, well after the initial load) re-triggered the early
  // full-page ErrorCard return below and wiped out the founder's typed name,
  // acceptance checkbox, and drawn signature instead of showing the inline
  // alert under the signature pad.
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  // The four steps (D717, #1857). The adoption lives here and nowhere else:
  // nothing about the signature or the name is written to browser storage.
  const [signing, dispatch] = useReducer(signingReducer, '', initialSigning);
  const accepted = signing.accepted;
  const typedName = signing.name;
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // If the signer is logged in with limited access, surface the warning up
  // front so they don't waste time drawing a signature only to be rejected
  // by the server. The server is still authoritative — see the worker
  // /api/legal/esign/sign/:token handler.
  //
  // Task #42 — read from the live AuthProvider context (`useAuth`) instead
  // of `safeReadJSON('user')`. The previous storage read was a one-shot
  // module evaluation, so a signer whose role/access_level/kyc_status had
  // just been changed server-side would see a stale warning (or none at
  // all) until they hard-refreshed. AuthProvider re-fetches `/api/auth/me`
  // on every route change, keeping the banner state in sync with what the
  // server will actually enforce. `user` is `null` when the visitor isn't
  // signed in, in which case neither field is set and the banner stays
  // hidden — same behaviour as before.
  const { user: signer } = useAuth();
  const signerAccessLevel = signer?.access_level || null;
  const signerKycStatus = signer?.kyc_status || null;
  const limitedSigner = signerAccessLevel === 'limited' && signerKycStatus !== 'approved';

  useEffect(() => {
    let alive = true;
    api.esignFetchByToken(token)
      .then((env) => { if (alive) { setEnvelope(env); dispatch({ type: 'start', name: env.recipient_name || '' }); } })
      .catch((e) => { if (alive) setLoadError(e.message || 'Could not load this signing link.'); })
      .finally(() => { if (alive) setLoading(false); });
    api.esignPaperByToken(token)
      .then((p) => { if (alive) setPaper(p); })
      .catch(() => { if (alive) setPaper(null); });
    return () => { alive = false; };
  }, [token]);

  // A new step starts at its top; the sheet opening or closing over the pad
  // keeps the pad where it was.
  const lastStep = useRef(signing.step);
  useEffect(() => {
    const from = lastStep.current;
    lastStep.current = signing.step;
    if (from === signing.step || from === 'confirm' || signing.step === 'confirm') return;
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [signing.step]);

  const cancelConfirm = useCallback(() => dispatch({ type: 'cancel' }), []);

  if (loading) return <PageShell><div className="p-12 text-center text-gray-500">Loading envelope…</div></PageShell>;
  if (loadError) return <PageShell><ErrorCard message={loadError} /></PageShell>;
  if (!envelope) return <PageShell><ErrorCard message="Envelope not found." /></PageShell>;

  const copy = signingCopy(envelope);

  if (done) return <PageShell><DoneScreen envelope={envelope} done={done} copy={copy} /></PageShell>;

  if (envelope.status === 'signed') {
    return <PageShell><InfoCard title="Already signed" message="This envelope has already been signed. A copy has been emailed to you." /></PageShell>;
  }
  if (envelope.status === 'rejected' || envelope.envelope_status === 'rejected') {
    return <PageShell><InfoCard title="Signing declined" message="This signing request was previously declined. Please contact the Axal VC admin if this was unexpected." /></PageShell>;
  }

  const submit = async (sigDataUrl) => {
    if (!canSign(signing)) return;
    if (!accepted) { setError('Please accept the terms before signing.'); return; }
    if (!sigDataUrl) { setError('Please draw your signature in the box.'); return; }
    setError(''); setSubmitting(true);
    try {
      // THE DRAWN IMAGE IS THE ARTEFACT, and withholding it made signing
      // impossible in production. The comment that stood here read: "SECURITY:
      // deliberately do NOT ship the drawn-signature image (`sigDataUrl`) to
      // the backend. The server treats authenticated click-through +
      // typed_name as the legal signature record (data minimisation — see
      // services/signatures.py). Sending the base64 image would be wasted
      // bandwidth and unnecessary PII surface."
      //
      // `services/signatures.py` IS THE DEV FASTAPI, WHICH IS NEVER DEPLOYED
      // (CLAUDE.md, fact 3). The production API is the Cloudflare Worker, and
      // `routes/esign.ts` requires `signature_data_url` to start with
      // `data:image/png;base64,` — it 400s with "Signature must be a PNG canvas
      // drawing" without it — because `services/pdf.ts` embeds that PNG into
      // the signed PDF's execution block. So the pad drew a signature, this
      // function threw it away, and every submission was rejected: a person
      // could draw, type their name, tick the consent box, and never sign
      // anything.
      //
      // It is not extra PII either. The image is a rendering of a name the
      // same request already carries as `typed_name`, it goes only into the
      // signed PDF the signer receives, and the worker caps it at 256 KB.
      const r = await api.esignSubmitSignature(token, {
        accepted: true,
        typed_name: typedName,
        signature_data_url: sigDataUrl,
      });
      setDone(r);
    } catch (e) {
      setError(e.message || 'Signing failed.');
      dispatch({ type: 'failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async () => {
    setSubmitting(true);
    try {
      await api.esignReject(token, rejectReason);
      setDone({ signed_at: new Date().toISOString(), completed: false, rejected: true });
    } catch (e) {
      setError(e.message || 'Could not decline.');
    } finally {
      setSubmitting(false);
      setShowRejectDialog(false);
    }
  };

  const onPad = signing.step === 'adopt' || signing.step === 'confirm';

  return (
    <PageShell>
      <div className="space-y-5">
        {limitedSigner && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-start">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-900">Limited access — signing is disabled</div>
              <p className="mt-1 text-amber-800 leading-relaxed">
                Your account currently has limited (browse-only) access. You cannot sign legal
                agreements until you complete identity verification. Please go to{' '}
                <a href="/kyc" className="underline font-medium">Identity Verification</a>{' '}
                to finish KYC, then return to this link to sign. If you believe this is in error,
                contact Axal VC compliance.
              </p>
            </div>
          </div>
        )}

        {signing.step === 'read' && (
          <ReadStep copy={copy} envelope={envelope} paper={paper} continueDisabled={false} onContinue={() => dispatch({ type: 'continue' })} />
        )}
        {signing.step === 'consent' && (
          <ConsentStep
            copy={copy}
            accepted={accepted}
            onAccept={(value) => dispatch({ type: 'accept', value })}
            onContinue={() => dispatch({ type: 'continue' })}
            onBack={() => dispatch({ type: 'back' })}
          />
        )}
        {onPad && (
          <AdoptStep
            copy={copy}
            envelope={envelope}
            mode={signing.mode}
            name={signing.name}
            adopted={signing.adopted}
            disabled={submitting || limitedSigner}
            onBack={() => dispatch({ type: 'back' })}
            onName={(value) => dispatch({ type: 'name', value })}
            onMode={(value) => dispatch({ type: 'mode', value })}
            onInk={() => dispatch({ type: 'ink_changed' })}
            onAdopt={(dataUrl) => dispatch({ type: 'adopt', dataUrl })}
          />
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <div className="flex items-center justify-center">
          <button
            onClick={() => setShowRejectDialog(true)}
            disabled={submitting}
            className="min-h-[44px] px-3 text-xs font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
          >
            Decline to sign
          </button>
        </div>
      </div>

      {signing.step === 'confirm' && signing.adopted && (
        <ConfirmSheet
          copy={copy}
          adopted={signing.adopted}
          date={utcDate(new Date())}
          submitting={submitting}
          disabled={limitedSigner}
          onSign={() => submit(signing.adopted.dataUrl)}
          onCancel={cancelConfirm}
        />
      )}

      {showRejectDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 dark:bg-gray-900">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Decline this signing request?</h3>
              <button onClick={() => setShowRejectDialog(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">This action is permanent. The Axal VC team will be notified.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Optional: tell us why so we can follow up…"
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:border-violet-500 focus:outline-none resize-none dark:border-gray-700"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setShowRejectDialog(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg dark:text-gray-300">Cancel</button>
              <button onClick={reject} disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {submitting ? 'Declining…' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Signature canvas pad — pure HTML5 canvas, no extra deps. One canvas serves
// both modes (the step keys it by mode, so a switch starts a fresh, empty pad
// sized to its new box): Type draws the name, Draw takes strokes. The canvas
// is white with #111827 ink in both themes, because the PNG prints on paper.
// ---------------------------------------------------------------------------
function SignaturePad({ copy, mode, name, adopted, disabled, onInk, onAdopt }) {
  const canvasRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const nameRef = useRef(name);
  nameRef.current = name;
  const adoptedRef = useRef(adopted);
  const onInkRef = useRef(onInk);
  onInkRef.current = onInk;
  const typing = mode === 'type';

  // Make canvas backing store match CSS size with DPR scaling. Returns false,
  // touching nothing, when the box has not changed size: a phone's address bar
  // fires `resize` on scroll, and wiping the drawing there left `hasInk` true
  // over a white canvas.
  const resize = useCallback((force) => {
    const canvas = canvasRef.current; if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (!force && rect.width === size.current.w && rect.height === size.current.h) return false;
    size.current = { w: rect.width, h: rect.height };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    return true;
  }, []);

  // Type: the name in Public Sans italic, once the face has loaded or the wait
  // has given up. Always the latest name, so a fast typist never sees a stale one.
  const drawName = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    whenFontReady(fonts, typedSignatureFont(32)).then(() => {
      if (canvasRef.current !== canvas) return;
      const { w, h } = size.current;
      setHasInk(drawTypedSignature(canvas.getContext('2d'), nameRef.current, { width: w, height: h }));
    });
  }, []);

  useEffect(() => {
    resize(true);
    // Back on the pad with a drawing adopted: paint it back, so the signer
    // sees what they adopted. `onInk` is not called — that would drop it.
    const kept = adoptedRef.current;
    if (!typing && kept?.dataUrl) {
      const canvas = canvasRef.current;
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current !== canvas) return;
        canvas.getContext('2d').drawImage(img, 0, 0, size.current.w, size.current.h);
      };
      img.src = kept.dataUrl;
      setHasInk(true);
    }
    const onResize = () => {
      if (!resize(false)) return;
      if (typing) { drawName(); return; }
      setHasInk(false);
      onInkRef.current?.();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resize, drawName, typing]);

  useEffect(() => {
    if (typing) drawName();
  }, [typing, name, drawName]);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches?.[0];
    return { x: (t?.clientX ?? e.clientX) - rect.left, y: (t?.clientY ?? e.clientY) - rect.top };
  };
  // Every stroke's start reports ink, not only the first: drawing again after
  // an adoption drops it.
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = point(e); onInk(); };
  const move  = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasInk(true);
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasInk(false);
    onInk();
  };

  const handleAdopt = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    const dataUrl = canvas.toDataURL('image/png');
    onAdopt(dataUrl);
  };

  const blankName = !(name || '').trim();

  // A fragment, so the footer's parent is the card body: a sticky footer
  // sticks only inside a box taller than itself.
  return (
    <>
      {!typing && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{copy.drawLabel}</span>
          <button onClick={clear} type="button" className="min-h-[32px] text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 dark:hover:text-gray-200">
            <Eraser className="w-3 h-3" /> {copy.drawClear}
          </button>
        </div>
      )}
      <div className="relative border-2 border-dashed border-[#c7d2fe] rounded-[12px] bg-[#fafaff] dark:border-indigo-800 dark:bg-gray-900" style={{ height: typing ? 110 : 160 }}>
        {typing ? (
          <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full rounded-[10px]" />
        ) : (
          <canvas
            ref={canvasRef}
            aria-label={copy.drawLabel}
            className="absolute inset-0 w-full h-full rounded-[10px] touch-none cursor-crosshair"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
        )}
        {!typing && !hasInk && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-gray-400">
            {copy.drawHint}
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-gray-500 dark:text-gray-400">{copy.adoptNote}</p>
      <StepFooter className="-mx-[18px] -mb-[14px] mt-4">
        <button type="button" onClick={handleAdopt} disabled={disabled || !hasInk || blankName} className={BIG_BUTTON}>
          {copy.adoptAction}
        </button>
      </StepFooter>
    </>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <AxalLogo size="md" />
          <div className="text-[11px] text-gray-500 mt-2 dark:text-gray-400">Secure electronic signature</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorCard({ message }) {
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center dark:bg-gray-900">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-600" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-gray-100">Unable to load signing envelope</h2>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}

function InfoCard({ title, message }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center dark:bg-gray-900 dark:border-gray-800">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
        <Check className="w-6 h-6 text-gray-500" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-gray-100">{title}</h2>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}
