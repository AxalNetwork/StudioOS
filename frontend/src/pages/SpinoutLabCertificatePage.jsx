// Spin-Out Lab — Graduation Certificate (Week 4 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Graduation Certificate.dc.html.
// Data mapping and the honesty rules live in lib/graduationCertificate.js —
// read its header. In short: the certificate itself is fully real (founder,
// company, cohort, conferral date, jurisdiction, duration, signatory all come
// from existing records).
//
// The issuance REGISTRY is also real, which this page did not used to know.
// `spinout_certificates` ships in routes/spinout_certificates.ts with issue,
// revoke, list, mine and sharing routes, and the public verifier is live at
// /verify/:token. The page previously asserted the opposite — that nothing had
// been allocated and that a third party could not verify anything — because it
// was written against the four table names the DESIGN proposed
// (issued_certificates, certificate_badges, certificate_events,
// certificate_delivery_logs), not the one the registry was actually built as.
// It now reads GET /certificates/mine and renders the credential, its public
// link and the holder's sharing switch when a row exists.
//
// What still does not exist is the design's admin issuance DASHBOARD, delivery
// tracking, profile-badge mint and activity log. Those stay unstubbed.
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
  // The registry row for this founder, if one has been issued. null = none
  // issued (the page falls back to the derived preview); an object = a real
  // credential with a public token a third party can verify.
  const [credential, setCredential] = useState(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingError, setSharingError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects, cert] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe().catch(() => null),
          api.listProjects().catch(() => []),
          // Best-effort: a founder with no issued credential gets null here,
          // which is a normal state, not an error.
          api.spinoutCertificateMine().then((r) => r?.certificate ?? null).catch(() => null),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        setCredential(cert);
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

  // The public verifier keys on the credential's random public_token, never on
  // credential_id — credential_id embeds the user id (…-0117), so a public URL
  // built from it would let anyone enumerate graduates by walking that number.
  const verifyUrl = useMemo(() => {
    if (!credential?.public_token) return null;
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://axal.vc';
    return `${origin}/verify/${credential.public_token}`;
  }, [credential]);

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

              {/* Registry state.
                  This card used to assert that no issuance registry existed
                  and that a third party could not verify the credential. Both
                  were false: `spinout_certificates` ships in the worker with
                  issue/revoke/list/mine/sharing routes, and the public
                  verifier is live at /verify/:token. The claim was written
                  against the FOUR TABLE NAMES THE DESIGN PROPOSED
                  (issued_certificates, certificate_badges, certificate_events,
                  certificate_delivery_logs) — none of which is what the
                  registry was actually built as, so the page looked for them,
                  found nothing, and told every graduate their credential was
                  unverifiable. */}
              {credential && credential.status === 'issued' ? (
                <div className={CARD} data-testid="card-credential-issued">
                  <div className={`${LBL} mb-2`}>Issued credential</div>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="font-mono text-[13px] font-semibold text-gray-900 dark:text-gray-50 break-all" data-testid="issued-credential-id">
                      {credential.credential_id}
                    </span>
                    <span className="flex-none text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      Issued
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                    Allocated from the graduation registry
                    {credential.issued_at ? <> on {String(credential.issued_at).slice(0, 10)}</> : null}. This is a
                    stored issuance row, not a value re-derived on each page load.
                  </p>

                  {credential.public_share_enabled ? (
                    <>
                      <div className={`${LBL} mb-1.5`}>Public verification link</div>
                      <div className="flex items-center gap-2 mb-2">
                        <code className="flex-1 min-w-0 truncate text-[11.5px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-2 text-gray-700 dark:text-gray-200" data-testid="verify-url">
                          {verifyUrl}
                        </code>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(verifyUrl);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            } catch { /* clipboard blocked — the URL is selectable above */ }
                          }}
                          data-testid="button-copy-verify"
                          className="flex-none h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-[11.5px] text-gray-400 dark:text-gray-500 leading-relaxed">
                        Anyone with this link can confirm your credential without an Axal account. It shows your name,
                        company, cohort and issue date — never your email or any internal identifier.
                      </p>
                    </>
                  ) : (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      Public verification is turned off, so the link returns nothing — the endpoint reports a disabled
                      credential as not-found rather than as hidden, so it cannot be used to confirm one you have closed.
                    </p>
                  )}

                  <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!credential.public_share_enabled}
                      disabled={sharingBusy}
                      data-testid="toggle-public-sharing"
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setSharingBusy(true);
                        setSharingError(null);
                        try {
                          const r = await api.spinoutCertificateSharing(next);
                          setCredential(r?.certificate ?? null);
                        } catch {
                          setSharingError('Could not update sharing. Please try again.');
                        } finally {
                          setSharingBusy(false);
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="text-[12.5px] text-gray-700 dark:text-gray-200">
                      Allow public verification of this credential
                    </span>
                  </label>
                  {sharingError ? (
                    <p className="mt-1.5 text-[11.5px] text-red-600 dark:text-red-400" data-testid="sharing-error">{sharingError}</p>
                  ) : null}
                </div>
              ) : credential && credential.status === 'revoked' ? (
                <div className={CARD} data-testid="card-credential-revoked">
                  <div className={`${LBL} mb-2`}>Credential revoked</div>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    <span className="font-mono text-[11.5px]">{credential.credential_id}</span> was revoked
                    {credential.revoked_at ? <> on {String(credential.revoked_at).slice(0, 10)}</> : null}
                    {credential.revocation_reason ? <> — {credential.revocation_reason}</> : null}. Public verification
                    reports it as revoked rather than silently failing.
                  </p>
                </div>
              ) : (
                <div className={CARD} data-testid="card-credential-pending">
                  <div className={`${LBL} mb-2`}>Not yet issued</div>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
                    The reference above is <span className="font-semibold text-gray-700 dark:text-gray-200">derived</span> from
                    your graduation record. It is the exact reference the registry will allocate — the worker builds
                    credential ids with the same rule this page uses — but no issuance row exists for you yet, so there
                    is no public verification link to share.
                  </p>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Certificates are issued by a program admin. Once yours is issued this card becomes your credential
                    id and a public link a third party can check.
                  </p>
                </div>
              )}
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
            {/* This line used to read "A third party cannot verify it yet —
                that needs the public verification endpoint the design
                proposes." That endpoint has shipped: GET /api/public/verify/
                :token, unauthenticated, with /verify/:token routed to the
                public page. */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3" data-testid="verify-modal-footnote">
              {verifyUrl
                ? <>This check is internal. For a third party, share your public verification link — it confirms the credential without an Axal account.</>
                : <>This check is internal. Third-party verification becomes available when your credential is issued from the registry.</>}
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
