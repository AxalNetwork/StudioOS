// Spin-Out Lab — Graduation Certificate (Week 4 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Graduation Certificate.dc.html.
// Data mapping and the honesty rules live in lib/graduationCertificate.js —
// read its header. In short: the certificate itself is fully real (founder,
// company, cohort, conferral date, jurisdiction, duration, signatory all come
// from existing records), while the design's Admin-issuance and Data-model
// tabs describe a credential SYSTEM whose five tables do not exist. Those are
// not stubbed here; the page says what is missing and why.
//
// The design's three view tabs are reduced to the one that has data. A tab
// strip whose other two tabs render invented graduates, invented delivery
// states and a proposed schema would be exactly the fabricated UI this
// codebase has spent its whole history removing.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award, Loader2, Lock, AlertTriangle, Download, ShieldCheck,
  Mail, X, Check,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { pickLabProject } from './SpinoutLabStartupPage';
import { buildCertificateViewModel, certificateFilename } from '../lib/graduationCertificate';
import { exportCertificatePdf } from '../lib/graduationCertificatePdf';
import LabPageHeader from '../components/spinout/LabPageHeader';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

export default function SpinoutLabCertificatePage() {
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [evidence, setEvidence] = useState({});
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [dlError, setDlError] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe().catch(() => null),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        setStatus('ready');

        // Pillar evidence — each from its own real tool, each optional. A
        // failure just drops that pillar rather than showing a placeholder.
        if (proj) {
          const [ivs, scores] = await Promise.all([
            api.listInterviews(proj.id).catch(() => null),
            api.getScores(proj.id, { includeSandbox: false }).catch(() => null),
          ]);
          if (dead) return;
          const list = Array.isArray(ivs) ? ivs : ivs?.interviews;
          const latest = Array.isArray(scores) ? scores[0] : null;
          setEvidence({
            interviews: Array.isArray(list) ? list.length : undefined,
            composite: Number.isFinite(Number(latest?.total_score)) ? Number(latest.total_score) : undefined,
            raised: Number.isFinite(Number(proj.total_funding)) ? Number(proj.total_funding) : undefined,
          });
        }
      } catch {
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const vm = useMemo(
    () => buildCertificateViewModel({ state, user, project, evidence }),
    [state, user, project, evidence],
  );

  const isAdmin = user?.role === 'admin';
  const unlocked = isAdmin || Boolean(state?.is_incorporated) || (state?.unlocked_features || []).includes('incorporate');

  async function download() {
    setDownloading(true);
    setDlError(null);
    try {
      await exportCertificatePdf({
        cert: vm.cert,
        pillars: vm.pillars,
        filename: certificateFilename(vm.cert.ref, vm.cert.company),
      });
      setDownloaded(true);
    } catch (e) {
      setDlError(e?.message || 'Could not generate the PDF.');
    } finally {
      setDownloading(false);
    }
  }

  if (status === 'loading') {
    return <div className="max-w-7xl mx-auto px-4 py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center" data-testid="page-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Couldn't load your certificate. Reload to try again.</p>
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center" data-testid="page-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <div className="text-base font-extrabold text-gray-900 dark:text-gray-50 mb-1">Your certificate unlocks in Week 4</div>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">It is conferred the moment you complete incorporation.</p>
        <Link to="/spinout-lab" className="text-[13px] font-bold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }

  const { cert } = vm;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-certificate">
      {/* Header — the shared Lab header. The single merged "Unlocked · Wk 4"
          chip is the week chip (there is no separate status chip on this
          page), and Wk 4 stays the literal it has always been. */}
      <LabPageHeader
        className="mb-5"
        icon={Award}
        title="Graduation Certificate"
        subtitle="Cohort credential, generated from your platform records and downloadable as a PDF."
        weekChip="Unlocked · Wk 4"
      />

      {!vm.eligible ? (
        <div className={`${CARD} text-center py-12`} data-testid="cert-not-yet">
          <Award className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-50 mb-1">Not conferred yet</div>
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 max-w-md mx-auto">{vm.reason}</p>
          <Link to="/spinout-lab/incorporate" className="inline-block mt-4 text-[12.5px] font-bold text-violet-600 hover:underline">
            Open Incorporate →
          </Link>
        </div>
      ) : (
        <>
          {/* Status strip */}
          <div className={`${CARD} flex items-center gap-4 flex-wrap mb-5`} data-testid="cert-status-strip">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Conferred</span>
            </div>
            {cert.ref && (
              <>
                <span className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
                  Credential <span className="font-mono font-semibold text-gray-900 dark:text-gray-50" data-testid="text-credential-ref">{cert.ref}</span>
                </div>
              </>
            )}
            {cert.conferred && (
              <>
                <span className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
                <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
                  Conferred <span className="font-semibold text-gray-900 dark:text-gray-50">{cert.conferred}</span>
                </div>
              </>
            )}
            <div className="flex-1" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setVerifyOpen(true)} data-testid="button-verify"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <ShieldCheck size={13} /> Verify
              </button>
              <button type="button" onClick={() => setEmailOpen(true)} data-testid="button-view-email"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <Mail size={13} /> View email
              </button>
              <button type="button" onClick={download} disabled={downloading} data-testid="button-download"
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg px-4 py-2">
                {downloading ? <Loader2 size={13} className="animate-spin" /> : downloaded ? <Check size={13} /> : <Download size={13} />}
                {downloading ? 'Generating…' : downloaded ? 'Downloaded' : 'Download PDF'}
              </button>
            </div>
          </div>
          {dlError && <p className="text-[12px] text-rose-600 dark:text-rose-400 mb-4" data-testid="text-dl-error">{dlError}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
            {/* CERTIFICATE PREVIEW */}
            <div className={CARD}>
              <div className="flex items-center justify-between mb-4">
                <div className={LBL}>Certificate preview · A4 landscape</div>
                <div className="text-[11.5px] text-gray-400 dark:text-gray-500">Auto-populated from platform records</div>
              </div>
              {/* Fixed 1.414 artboard, scaled to the container — the design's
                  own container-query approach, done with aspect-ratio. Always
                  light: it is a print artifact, not app chrome.
                  dark-mode-exempt. */}
              <div className="w-full max-w-[840px] mx-auto aspect-[840/594] relative rounded-lg overflow-hidden border border-gray-200 bg-[#fdfdfd] shadow-sm" data-testid="certificate-artboard">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-600 via-violet-700 to-teal-600 h-[5px]" />
                <div className="absolute inset-[3.5%] border border-[#e0dcea] pointer-events-none" />
                <div className="absolute inset-[4.5%] border border-[#f0eef6] pointer-events-none" />

                <div className="absolute inset-0 px-[8.8%] pt-[9%] pb-[9.5%] flex flex-col text-[#12101a]">
                  {/* wordmark */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[2.4cqw] font-extrabold tracking-tight leading-none">{cert.issuer}</div>
                      <div className="text-[1.05cqw] font-semibold tracking-[0.2em] uppercase text-[#4e4e5a] mt-1">{cert.program}</div>
                    </div>
                    {cert.ref && (
                      <div className="text-right">
                        <div className="text-[0.95cqw] font-bold tracking-[0.18em] uppercase text-[#5a5a66]">Credential</div>
                        <div className="font-mono text-[1.1cqw] font-semibold text-[#52525b] mt-0.5">{cert.ref}</div>
                      </div>
                    )}
                  </div>
                  <div className="h-px bg-[#ebe8f2] mt-[3.5%]" />

                  {/* body */}
                  <div className="flex-1 flex flex-col justify-center text-center px-[3%]">
                    <div className="text-[1.15cqw] font-bold tracking-[0.28em] uppercase text-violet-600">Certificate of Graduation</div>
                    <div className="font-serif text-[6.4cqw] leading-[1.06] tracking-tight mt-[2.5%]" data-testid="cert-founder">{cert.founder || '—'}</div>
                    <div className="text-[1.45cqw] text-[#6b6b78] mt-[2%] leading-[1.75] max-w-[62%] mx-auto">
                      has completed the {cert.days ? `${cert.days}-day ` : ''}{cert.issuer} {cert.program}
                      {cert.company ? <> as founder of <span className="text-[#12101a] font-bold">{cert.company}</span></> : null}
                      {cert.cohortLabel ? <>, satisfying every venture-readiness milestone of {cert.cohortLabel}</> : ', satisfying every venture-readiness milestone'}
                      {' '}— from validated customer demand and a scored diligence package to an incorporated entity and an executed cap table.
                    </div>
                    {vm.pillars.length > 0 && (
                      <div className="flex justify-center mt-[3%]" data-testid="cert-pillars">
                        {vm.pillars.map((p, i) => (
                          <div key={p.k} className={`px-[2.6%] ${i > 0 ? 'border-l border-[#ebe8f2]' : ''}`}>
                            <div className="font-mono text-[1.95cqw] font-semibold">{p.v}</div>
                            <div className="text-[0.95cqw] font-bold tracking-[0.14em] uppercase text-[#5a5a66] mt-1">{p.k}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* signature + seal */}
                  <div className="flex items-end justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="font-serif italic text-[3.2cqw] leading-none text-[#1d1730]">{cert.signer}</div>
                      <div className="h-px bg-[#d8d4e2] my-[1.2%]" />
                      <div className="text-[1.05cqw] font-semibold text-[#6b6b78]">{cert.signerRole}</div>
                    </div>
                    <div className="w-[11.5%] aspect-square flex-none rounded-full border-[1.5px] border-[#d8cff0] bg-[#fbfaff] flex flex-col items-center justify-center">
                      <div className="text-[0.85cqw] font-bold tracking-[0.14em] uppercase text-violet-600">{cert.issuer}</div>
                      {cert.cohortNum && <div className="font-serif text-[3.1cqw] leading-none my-0.5">{cert.cohortNum}</div>}
                      <div className="text-[0.8cqw] font-bold tracking-[0.13em] uppercase text-[#4e4e5a]">Graduate</div>
                    </div>
                  </div>

                  {/* footer */}
                  <div className="mt-auto pt-[2%] border-t border-[#ebe8f2] text-[0.95cqw] text-[#5a5a66] leading-[1.7]">
                    {cert.conferred ? `Conferred ${cert.conferred}` : ''}{cert.jurisdiction ? ` · ${cert.jurisdiction}` : ''}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
                The PDF is redrawn as vector at A4 landscape, so it prints sharper than this preview. The design's
                background artwork, script signature face and decorative QR block are not reproduced — see the notes below.
              </p>
            </div>

            {/* SIDE RAIL */}
            <div className="space-y-5 min-w-0">
              <div className={CARD} data-testid="card-fields">
                <div className="flex items-center justify-between mb-3">
                  <div className={LBL}>Auto-filled fields</div>
                  <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded">From platform</span>
                </div>
                {vm.fields.map((f) => (
                  <div key={f.k} className="py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0" data-testid={`field-${f.k}`}>
                    <div className="flex justify-between gap-3">
                      <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500 flex-none">{f.k}</span>
                      <span className="text-[12px] font-semibold text-right break-words min-w-0 text-gray-900 dark:text-gray-50">{f.v}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{f.src}</div>
                  </div>
                ))}
              </div>

              {/* What the design proposes that does not exist. Stated rather
                  than stubbed — a fake issuance dashboard would be worse. */}
              <div className={CARD} data-testid="card-not-built">
                <div className={`${LBL} mb-2`}>Not issued from a registry</div>
                <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
                  The credential reference above is <span className="font-semibold text-gray-700 dark:text-gray-200">derived</span> from
                  your graduation record — reproducible, but not allocated by an issuance registry. Verification re-checks
                  the live record rather than a stored issuance row.
                </p>
                <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  The design's admin issuance dashboard, delivery tracking, profile-badge mint, revoke/reissue and activity
                  log all need the credential tables it specifies (<span className="font-mono text-[11px]">issued_certificates</span>,{' '}
                  <span className="font-mono text-[11px]">certificate_badges</span>,{' '}
                  <span className="font-mono text-[11px]">certificate_events</span>,{' '}
                  <span className="font-mono text-[11px]">certificate_delivery_logs</span>). None exist yet, so none are shown.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Verify modal — reads the live record, not an issuance row */}
      {verifyOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setVerifyOpen(false)} data-testid="modal-verify">
          <div className={`${CARD} w-full max-w-md text-center`} onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
              <Check size={22} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-[16px] font-extrabold text-gray-900 dark:text-gray-50">Graduation confirmed</div>
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-1.5 mb-4">
              Checked against your live graduation record — the same {' '}
              <span className="font-mono text-[11px]">incorporation_completed</span> milestone the public graduate list uses.
            </p>
            <div className="text-left border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              {vm.verify.map((r) => (
                <div key={r.k} className="flex justify-between gap-3 py-1" data-testid={`verify-${r.k}`}>
                  <span className="text-[12px] text-gray-400 dark:text-gray-500">{r.k}</span>
                  <span className="text-[12.5px] font-semibold text-right text-gray-900 dark:text-gray-50">{r.v}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
              This check is internal. A third party cannot verify it yet — that needs the public verification endpoint the design proposes.
            </p>
            <button type="button" onClick={() => setVerifyOpen(false)} data-testid="button-close-verify"
              className="mt-4 w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delivery email — the REAL spinout_graduated template's copy */}
      {emailOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-auto" onClick={() => setEmailOpen(false)} data-testid="modal-email">
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">Delivery email</div>
              <button type="button" onClick={() => setEmailOpen(false)} data-testid="button-close-email" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              <div className="text-[11.5px] text-gray-400 dark:text-gray-500">Subject</div>
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 mt-0.5">You graduated the Spin-Out Lab</div>
            </div>
            <div className="px-6 py-6">
              <p className="text-[13.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-3">Hi {cert.founder || 'there'},</p>
              <p className="text-[13.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                Congratulations — you graduated the <strong className="text-gray-900 dark:text-gray-50">Spin-Out Lab</strong>. Your StudioOS now has the full founder feature set.
              </p>
              <span className="inline-block text-[12.5px] font-bold text-white bg-violet-600 px-4 py-2.5 rounded-lg">Open dashboard</span>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-5 pt-4 border-t border-gray-200 dark:border-gray-700 leading-relaxed">
                This is the real <span className="font-mono text-[11px]">spinout_graduated</span> template that sends on graduation.
                The design's richer copy — and attaching the certificate PDF — would be a change to that template, not to this page.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
