import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Check, AlertCircle, FileText, Shield, Clock, Eraser, X } from 'lucide-react';

/**
 * Public eSignature page reached via deal@axal.vc magic link.
 * Token is in the URL path; no auth header required. Server gates by token.
 */
export default function ESignPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [envelope, setEnvelope] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    let alive = true;
    api.esignFetchByToken(token)
      .then((env) => { if (alive) { setEnvelope(env); setTypedName(env.recipient_name || ''); } })
      .catch((e) => { if (alive) setError(e.message || 'Could not load this signing link.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  if (loading) return <PageShell><div className="p-12 text-center text-gray-500">Loading envelope…</div></PageShell>;
  if (error)   return <PageShell><ErrorCard message={error} /></PageShell>;
  if (!envelope) return <PageShell><ErrorCard message="Envelope not found." /></PageShell>;

  if (done) {
    return (
      <PageShell>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Signature received</h1>
          <p className="text-gray-600 mb-1">Thank you. Your signature has been recorded for:</p>
          <p className="text-base font-semibold text-gray-900 mb-6">{envelope.document_title}</p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left text-xs text-gray-600 space-y-1.5 max-w-sm mx-auto">
            <div className="flex justify-between"><span>Envelope</span><span className="font-mono text-gray-800">{envelope.envelope_uuid.slice(0, 8)}…</span></div>
            <div className="flex justify-between"><span>Signed at</span><span className="text-gray-800">{new Date(done.signed_at).toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Status</span><span className="text-emerald-700 font-medium">{done.completed ? 'Completed' : 'Partially signed'}</span></div>
          </div>
          <p className="text-xs text-gray-500 mt-6">You will receive a copy by email shortly. You may now close this window.</p>
        </div>
      </PageShell>
    );
  }

  if (envelope.status === 'signed') {
    return <PageShell><InfoCard title="Already signed" message="This envelope has already been signed. A copy has been emailed to you." /></PageShell>;
  }
  if (envelope.status === 'rejected' || envelope.envelope_status === 'rejected') {
    return <PageShell><InfoCard title="Signing declined" message="This signing request was previously declined. Please contact the Axal admin if this was unexpected." /></PageShell>;
  }

  const submit = async (sigDataUrl) => {
    if (!accepted) { setError('Please accept the terms before signing.'); return; }
    if (!sigDataUrl) { setError('Please draw your signature in the box.'); return; }
    setError(''); setSubmitting(true);
    try {
      const r = await api.esignSubmitSignature(token, {
        signature_data_url: sigDataUrl,
        accepted: true,
        typed_name: typedName,
      });
      setDone(r);
    } catch (e) {
      setError(e.message || 'Signing failed.');
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

  return (
    <PageShell>
      <div className="space-y-5">
        {/* Document panel */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
              <FileText className="w-4 h-4 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-violet-600 uppercase tracking-wide">{envelope.document_type}</div>
              <h1 className="text-lg font-bold text-gray-900 truncate">{envelope.document_title}</h1>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-500">
              <Shield className="w-3 h-3" /> SHA-256 verified
            </div>
          </div>
          <div className="px-6 py-5 max-h-[440px] overflow-y-auto bg-gray-50/50">
            <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-gray-800">{envelope.document_body}</pre>
          </div>
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Expires {new Date(envelope.expires_at).toLocaleDateString()}</div>
            <div className="font-mono">Envelope {envelope.envelope_uuid.slice(0, 8)}…{envelope.envelope_uuid.slice(-4)}</div>
          </div>
        </div>

        {/* Signature panel */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Your signature</h2>
          <p className="text-xs text-gray-500 mb-4">
            Signing as <span className="font-medium text-gray-800">{envelope.recipient_email}</span>
          </p>

          <SignaturePad
            onSubmit={submit}
            disabled={submitting || !accepted}
            typedName={typedName}
            setTypedName={setTypedName}
            accepted={accepted}
            setAccepted={setAccepted}
          />

          {error && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
            <button
              onClick={() => setShowRejectDialog(true)}
              disabled={submitting}
              className="text-xs font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
            >
              Decline to sign
            </button>
            <div className="text-[11px] text-gray-400 max-w-xs text-right">
              Electronic signature is legally binding under E-SIGN (15 U.S.C. § 7001) and UETA.
            </div>
          </div>
        </div>
      </div>

      {showRejectDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Decline this signing request?</h3>
              <button onClick={() => setShowRejectDialog(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">This action is permanent. The Axal team will be notified.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Optional: tell us why so we can follow up…"
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:border-violet-500 focus:outline-none resize-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setShowRejectDialog(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
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
// Signature canvas pad — pure HTML5 canvas, no extra deps.
// ---------------------------------------------------------------------------
function SignaturePad({ onSubmit, disabled, typedName, setTypedName, accepted, setAccepted }) {
  const canvasRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Make canvas backing store match CSS size with DPR scaling.
  const resize = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
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
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches?.[0];
    return { x: (t?.clientX ?? e.clientX) - rect.left, y: (t?.clientY ?? e.clientY) - rect.top };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = point(e); };
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
    if (!hasInk) setHasInk(true);
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasInk(false);
  };

  const handleSubmit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSubmit(dataUrl);
  };

  return (
    <div>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1.5">Type your full legal name</label>
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none transition"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-700">Draw your signature</label>
            <button onClick={clear} type="button" className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
              <Eraser className="w-3 h-3" /> Clear
            </button>
          </div>
          <div className="relative border-2 border-dashed border-gray-300 rounded-xl bg-white" style={{ height: 160 }}>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full rounded-xl touch-none cursor-crosshair"
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            />
            {!hasInk && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-gray-400">
                Sign here using mouse, trackpad, or touch
              </div>
            )}
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
          <span className="text-xs text-gray-700 leading-relaxed">
            I agree that my electronic signature is the legal equivalent of my handwritten signature
            and that I am bound by the terms of this Agreement.
          </span>
        </label>

        <button
          onClick={handleSubmit}
          disabled={disabled || !hasInk}
          className="w-full mt-1 px-4 py-3 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" /> Sign &amp; Submit
        </button>
      </div>
    </div>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <img src="/axal-mark.png" alt="Axal" className="w-8 h-8 rounded-lg" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <div className="text-base font-bold text-gray-900 leading-none">Axal Deals</div>
            <div className="text-[11px] text-gray-500 mt-0.5">Secure electronic signature</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorCard({ message }) {
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-600" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Unable to load signing envelope</h2>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}

function InfoCard({ title, message }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
        <Check className="w-6 h-6 text-gray-500" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}
