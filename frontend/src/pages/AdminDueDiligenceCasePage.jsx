import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, FileDown, Send, RefreshCw, Shield, AlertTriangle, CheckCircle2, ClipboardList, Mail, Upload } from 'lucide-react';
import { dd } from '../lib/api';
import { reportError } from '../lib/log';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';

const SEV_STYLES = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-amber-900',
  low: 'bg-blue-400 text-white',
  info: 'bg-gray-300 text-gray-700',
};
const VERDICT_STYLES = {
  pass: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  fail: 'bg-red-100 text-red-700',
  n_a: 'bg-gray-100 text-gray-600',
};
const BAND_STYLES = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  amber: 'bg-orange-500',
  red: 'bg-red-600',
};
const SOURCE_STATUS = {
  queued: 'bg-gray-100 text-gray-600',
  running: 'bg-sky-100 text-sky-700 animate-pulse',
  ok: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  disabled: 'bg-gray-100 text-gray-500',
};

export default function AdminDueDiligenceCasePage() {
  const { uid } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inv = searchParams.get('inv');
  const focusSection = searchParams.get('section');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verdictModal, setVerdictModal] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [inviteBanner, setInviteBanner] = useState(null);
  const sectionRefs = useRef({});
  const inviteConsumedRef = useRef(false);
  const { toast, push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dd.getCase(uid);
      setData(r);
    } catch (e) {
      reportError('AdminDueDiligenceCasePage:get', e);
      push(e.message || 'Failed to load case', 'error');
    } finally { setLoading(false); }
  }, [uid, push]);
  useEffect(() => { load(); }, [load]);

  // Consume the magic-link invite jti once on first load. The backend
  // validates the jti against dd_reviewers and (a) records acceptance for
  // audit + (b) returns the section_id this reviewer was invited to.
  useEffect(() => {
    if (!inv || inviteConsumedRef.current) return;
    inviteConsumedRef.current = true;
    (async () => {
      try {
        const r = await dd.acceptInvite(uid, inv);
        setInviteBanner({ sectionId: r.section_id });
        // Strip ?inv= from URL so a refresh doesn't re-consume.
        const next = new URLSearchParams(searchParams);
        next.delete('inv');
        setSearchParams(next, { replace: true });
      } catch (e) {
        push(`Invitation invalid: ${e.message || 'expired or revoked'}`, 'error');
      }
    })();
  }, [inv, uid, searchParams, setSearchParams, push]);

  // Scroll & highlight the focused section once data is loaded.
  useEffect(() => {
    if (!focusSection || !data) return;
    const el = sectionRefs.current[focusSection];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-violet-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-violet-400'), 3000);
    }
  }, [focusSection, data]);

  // Poll for scan status while any source row is queued/running.
  useEffect(() => {
    if (!data) return;
    const inFlight = (data.sources || []).some(s => s.status === 'queued' || s.status === 'running');
    if (!inFlight) return;
    const t = setInterval(() => { load(); }, 2500);
    return () => clearInterval(t);
  }, [data, load]);

  const runScan = async () => {
    setBusy(true);
    try { await dd.scan(uid); push('Scan queued — results will appear shortly', 'success'); await load(); }
    catch (e) { push(e.message || 'Scan failed', 'error'); }
    finally { setBusy(false); }
  };

  const generateReport = async () => {
    setBusy(true);
    try {
      const r = await dd.generateReport(uid);
      if (r.download_url) {
        // Open the report in a new tab. Same-origin worker route streams
        // the file with Content-Disposition: attachment.
        window.open(r.download_url, '_blank', 'noopener,noreferrer');
        push(`Report generated (${r.format.toUpperCase()})`, 'success');
      }
      await load();
    } catch (e) { push(e.message || 'Report failed', 'error'); }
    finally { setBusy(false); }
  };

  const shareWithFounder = async () => {
    if (!window.confirm('Notify the founder that the report is ready? They will not see the report contents — only that it exists.')) return;
    setBusy(true);
    try { await dd.shareReport(uid); push('Founder notified', 'success'); }
    catch (e) { push(e.message || 'Share failed', 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="text-gray-500 text-center py-20">Loading…</div>;
  if (!data) return <div className="text-gray-500 text-center py-20">Case not found.</div>;

  const cs = data.case;
  const score = cs.risk_score != null ? Math.round(cs.risk_score * 100) : null;
  const band = cs.risk_band || 'green';
  const scanInFlight = (data.sources || []).some(s => s.status === 'queued' || s.status === 'running');

  return (
    <div>
      <Link to="/admin/due-diligence" className="inline-flex items-center gap-1 text-sm text-violet-600 hover:underline mb-3">
        <ArrowLeft size={14} /> All cases
      </Link>

      {inviteBanner && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-sm text-violet-900 dark:text-violet-200 flex items-center gap-2">
          <Mail size={16} /> You're reviewing this case as an invited expert. Your assigned section is highlighted below.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-violet-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{cs.subject_label}</h1>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            <span className="capitalize">{cs.subject_type}</span> · case <span className="font-mono">{cs.uid}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runScan} disabled={busy || scanInFlight}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">
            <Play size={14} /> {scanInFlight ? 'Scan running…' : 'Run external scan'}
          </button>
          <button onClick={generateReport} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-lg font-medium hover:bg-black dark:hover:bg-gray-600 disabled:opacity-60">
            <FileDown size={14} /> Generate report
          </button>
          {(cs.subject_type === 'project' || cs.subject_type === 'founder') && (
            <button onClick={shareWithFounder} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60">
              <Send size={14} /> Notify founder
            </button>
          )}
          <button onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50">
            <ClipboardList size={14} /> Audit log
          </button>
          <button onClick={load} className="p-2 text-gray-600 hover:text-violet-600" title="Refresh"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className={`md:col-span-1 p-5 rounded-xl text-white ${BAND_STYLES[band]}`}>
          <div className="text-xs uppercase tracking-wider opacity-80">Risk band</div>
          <div className="text-3xl font-bold mt-1">{band.toUpperCase()}</div>
          <div className="text-sm opacity-90 mt-1">Score {score ?? '—'}/100</div>
        </div>
        <div className="md:col-span-2 grid grid-cols-3 gap-3">
          <Stat label="Sections" value={data.sections.length} />
          <Stat label="Findings" value={data.findings.length} highlight={data.findings.some(f => f.severity === 'critical' || f.severity === 'high')} />
          <Stat label="Reviewers" value={data.reviewers.length} />
        </div>
      </div>

      {(cs.subject_email || cs.subject_legal_name) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6 text-sm">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium mb-1">
            <AlertTriangle size={14} /> Encrypted PII
          </div>
          {cs.subject_legal_name && <div><span className="text-gray-600 dark:text-gray-400">Legal name:</span> {cs.subject_legal_name}</div>}
          {cs.subject_email && <div><span className="text-gray-600 dark:text-gray-400">Email:</span> {cs.subject_email}</div>}
        </div>
      )}

      <FindingHeatmap sections={data.sections} findings={data.findings} />
      <ReviewerQueue reviewers={data.reviewers} sections={data.sections} />

      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Sections</h2>
      <div className="space-y-3 mb-6">
        {data.sections.map(s => {
          const sectionFindings = data.findings.filter(f => f.section_id === s.id);
          const hasNda = data.attachments.some(a => a.section_id === s.id);
          return (
            <div key={s.id} ref={(el) => { if (el) sectionRefs.current[String(s.id)] = el; }}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 transition-shadow">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
                  <div className="text-xs text-gray-500">weight {Number(s.weight).toFixed(2)} · {s.status}{hasNda ? ' · NDA on file' : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  {s.verdict && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${VERDICT_STYLES[s.verdict]}`}>
                      {s.verdict.toUpperCase()}
                    </span>
                  )}
                  <button onClick={() => setAssignModal(s)}
                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded">Assign</button>
                  <button onClick={() => setVerdictModal(s)}
                    className="text-xs px-2 py-1 bg-violet-600 text-white hover:bg-violet-700 rounded">Verdict</button>
                </div>
              </div>
              {s.reviewer_notes && (
                <div className="text-xs bg-gray-50 dark:bg-gray-900/40 p-2 rounded mb-2 text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Reviewer:</span> {s.reviewer_notes}
                </div>
              )}
              {sectionFindings.length > 0 ? (
                <ul className="space-y-1.5 mt-2">
                  {sectionFindings.map(f => (
                    <li key={f.id} className="flex items-start gap-2 text-sm">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${SEV_STYLES[f.severity]}`}>{f.severity.toUpperCase()}</span>
                      <div className="flex-1">
                        <div className="text-gray-900 dark:text-gray-100">{f.title}</div>
                        {f.detail && <div className="text-xs text-gray-600 dark:text-gray-400">{f.detail}</div>}
                        {f.evidence_url && <a href={f.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline">{f.evidence_url}</a>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-gray-400 italic">No findings yet.</div>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">External sources</h2>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-6">
        {data.sources.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">No scans run yet. Click "Run external scan" to query connectors.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-600 dark:text-gray-400">
              <th className="text-left px-3 py-2">Connector</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Records</th><th className="px-3 py-2">Findings</th>
              <th className="text-left px-3 py-2">Completed</th>
            </tr></thead>
            <tbody>{data.sources.map(s => (
              <tr key={s.id} className="border-t border-gray-100 dark:border-gray-700/40">
                <td className="px-3 py-2 font-mono text-xs">{s.connector}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${SOURCE_STATUS[s.status] || SOURCE_STATUS.queued}`}>{s.status}</span>
                </td>
                <td className="px-3 py-2 text-center text-xs">{s.records_count}</td>
                <td className="px-3 py-2 text-center text-xs">{s.findings_emitted}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{s.completed_at ? new Date(s.completed_at).toLocaleString() : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {verdictModal && (
        <VerdictModal section={verdictModal} caseUid={uid}
          attachments={data.attachments.filter(a => a.section_id === verdictModal.id)}
          onClose={() => setVerdictModal(null)}
          onSave={async (verdict, notes) => {
            try { await dd.setVerdict(uid, verdictModal.id, verdict, notes); push('Verdict recorded', 'success'); setVerdictModal(null); load(); }
            catch (e) { push(e.message || 'Failed', 'error'); }
          }}
          onUploadNda={async (file) => {
            try { await dd.uploadNda(uid, verdictModal.id, file); push('NDA uploaded', 'success'); load(); }
            catch (e) { push(e.message || 'NDA upload failed', 'error'); throw e; }
          }} />
      )}
      {assignModal && (
        <AssignModal section={assignModal} onClose={() => setAssignModal(null)}
          onSave={async (userId) => {
            try { await dd.assignSection(uid, assignModal.id, userId); push('Reviewer assigned', 'success'); setAssignModal(null); load(); }
            catch (e) { push(e.message || 'Failed', 'error'); }
          }} />
      )}
      {auditOpen && <AuditDrawer uid={uid} onClose={() => setAuditOpen(false)} />}
      {toast}
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
    </div>
  );
}

function VerdictModal({ section, attachments, onClose, onSave, onUploadNda }) {
  useEscapeClose(onClose);
  const [verdict, setVerdict] = useState(section.verdict || 'pass');
  const [notes, setNotes] = useState(section.reviewer_notes || '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const ndaOnFile = attachments.length > 0 || Boolean(section.reviewer_signed_nda_at);

  const upload = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setUploading(true);
    try { await onUploadNda(f); fileRef.current.value = ''; }
    catch { /* toast handled by caller */ }
    finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Record verdict — {section.title}</h3>
        <label className="block text-sm mb-3">
          <div className="text-xs font-medium text-gray-600 mb-1">Verdict</div>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
            <option value="pass">Pass</option><option value="warn">Warn</option>
            <option value="fail">Fail</option><option value="n_a">Not applicable</option>
          </select>
        </label>
        <label className="block text-sm mb-3">
          <div className="text-xs font-medium text-gray-600 mb-1">Reviewer notes</div>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
        </label>
        <div className="mb-4 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
            <Upload size={12} /> Reviewer NDA
          </div>
          {ndaOnFile ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Signed NDA on file ({attachments.length || 1} document{attachments.length === 1 ? '' : 's'}).
            </div>
          ) : (
            <>
              <input ref={fileRef} type="file" accept="application/pdf,image/*"
                className="block text-xs text-gray-700 dark:text-gray-300 file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-violet-600 file:text-white file:text-xs" />
              <button type="button" onClick={upload} disabled={uploading}
                className="mt-2 px-3 py-1 text-xs bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-60">
                {uploading ? 'Uploading…' : 'Upload signed NDA'}
              </button>
              <p className="text-[10px] text-gray-500 mt-1">PDF preferred, max 10MB. Required before submitting any verdict other than "n/a".</p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
          <button onClick={() => onSave(verdict, notes)}
            disabled={verdict !== 'n_a' && !ndaOnFile}
            title={verdict !== 'n_a' && !ndaOnFile ? 'Upload the signed NDA before submitting a verdict.' : ''}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">
            <CheckCircle2 size={14} className="inline mr-1" /> Save verdict
          </button>
        </div>
      </div>
    </div>
  );
}

// Expertise-driven reviewer picker. Backend /dd/experts returns
// `suggestions` (users who have completed prior verdicts on this same
// section_key, ranked by review count) and `eligible` (all admin/
// partner/mentor/investor users) as a fallback. Admins can still type
// any user id manually if the dropdown doesn't surface the right
// person.
function AssignModal({ section, onClose, onSave }) {
  useEscapeClose(onClose);
  const [userId, setUserId] = useState(section.assignee_user_id ? String(section.assignee_user_id) : '');
  const [suggestions, setSuggestions] = useState([]);
  const [eligible, setEligible] = useState([]);
  const [loadingExperts, setLoadingExperts] = useState(true);

  useEffect(() => {
    let alive = true;
    dd.experts(section.section_key).then(r => {
      if (!alive) return;
      setSuggestions(r.suggestions || []);
      setEligible(r.eligible || []);
    }).catch(() => null).finally(() => { if (alive) setLoadingExperts(false); });
    return () => { alive = false; };
  }, [section.section_key]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Assign reviewer — {section.title}</h3>
        <p className="text-xs text-gray-500 mb-3">Pick a reviewer for this section. They'll be notified by email and in-app with a magic link scoped to this section.</p>
        {loadingExperts && <div className="text-xs text-gray-500 mb-2">Loading suggested experts…</div>}
        {!loadingExperts && suggestions.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Suggested (prior reviews on this section type)</div>
            <ul className="space-y-1">
              {suggestions.map(u => (
                <li key={u.id}>
                  <button type="button" onClick={() => setUserId(String(u.id))}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                      String(userId) === String(u.id)
                        ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}>
                    <span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{u.name || u.email}</span>
                      <span className="text-gray-500 ml-1.5">({u.role})</span>
                    </span>
                    <span className="text-gray-500">{u.prior_reviews} prior</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!loadingExperts && eligible.length > 0 && (
          <label className="block mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Or pick from all eligible reviewers</div>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
              <option value="">— choose —</option>
              {eligible.map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email} · {u.role}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs mb-4">
          <span className="text-gray-500">Or enter a user ID directly</span>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID"
            className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
          <button onClick={() => onSave(Number(userId))} disabled={!userId}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">Assign</button>
        </div>
      </div>
    </div>
  );
}

// Compact 5×N grid: one row per section, one column per severity. Cell
// shade encodes the count of unresolved findings at that severity.
// Surfaces hot zones at a glance without forcing reviewers to scan the
// section list one by one.
function FindingHeatmap({ sections, findings }) {
  const SEV_COLS = ['critical', 'high', 'medium', 'low', 'info'];
  const counts = sections.map(s => {
    const row = { section: s };
    for (const sev of SEV_COLS) row[sev] = 0;
    for (const f of findings) {
      if (f.section_id === s.id && !f.resolved_at && row[f.severity] !== undefined) row[f.severity]++;
    }
    return row;
  });
  const totalFindings = findings.length;
  if (totalFindings === 0) return null;
  const shadeFor = (sev, n) => {
    if (n === 0) return 'bg-gray-50 dark:bg-gray-900/30 text-gray-300 dark:text-gray-600';
    const base = SEV_STYLES[sev];
    return base + ' font-bold';
  };
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Finding heatmap</h2>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-gray-500">
            <th className="text-left px-2 py-1">Section</th>
            {SEV_COLS.map(s => <th key={s} className="px-2 py-1 text-center w-14">{s}</th>)}
          </tr></thead>
          <tbody>{counts.map(({ section, ...row }) => (
            <tr key={section.id} className="border-t border-gray-100 dark:border-gray-700/40">
              <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200">{section.title}</td>
              {SEV_COLS.map(sev => (
                <td key={sev} className="px-1 py-1 text-center">
                  <span className={`inline-block w-9 h-6 leading-6 rounded ${shadeFor(sev, row[sev])}`}>{row[sev] || ''}</span>
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// Reviewer queue: who's been invited, what their NDA + response state
// is, and which section they own. Helps the case lead chase outstanding
// reviews without scrolling the section list.
function ReviewerQueue({ reviewers, sections }) {
  if (!reviewers || reviewers.length === 0) return null;
  const sectionTitle = (id) => sections.find(s => s.id === id)?.title || `Section #${id}`;
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Reviewer queue</h2>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-gray-50 dark:bg-gray-900/40 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="text-left px-3 py-2">Reviewer</th>
            <th className="text-left px-3 py-2">Section</th>
            <th className="px-3 py-2">Invited</th>
            <th className="px-3 py-2">Accepted</th>
            <th className="px-3 py-2">NDA</th>
            <th className="px-3 py-2">Verdict</th>
          </tr></thead>
          <tbody>{reviewers.map(r => {
            const section = sections.find(s => s.id === r.section_id);
            const verdict = section?.verdict;
            return (
              <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700/40">
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.user_name || r.user_email}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{sectionTitle(r.section_id)}</td>
                <td className="px-3 py-2 text-center text-gray-500">{r.invited_at ? new Date(r.invited_at).toLocaleDateString() : '—'}</td>
                <td className="px-3 py-2 text-center">{r.responded_at ? <CheckCircle2 size={12} className="inline text-emerald-600" /> : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-center">{r.nda_signed_at ? <CheckCircle2 size={12} className="inline text-emerald-600" /> : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-center">
                  {verdict
                    ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${VERDICT_STYLES[verdict]}`}>{verdict.toUpperCase()}</span>
                    : <span className="text-gray-300">pending</span>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function AuditDrawer({ uid, onClose }) {
  useEscapeClose(onClose);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    dd.audit(uid).then(r => { if (alive) setItems(r.items || []); })
      .catch(e => { if (alive) setError(e.message || 'Failed to load audit log'); });
    return () => { alive = false; };
  }, [uid]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-white dark:bg-gray-800 shadow-xl border-l border-gray-200 dark:border-gray-700 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-violet-600" />
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Case audit log</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 text-xl leading-none">×</button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {error && <div className="text-red-600 text-xs">{error}</div>}
          {!error && items === null && <div className="text-gray-500 text-xs">Loading…</div>}
          {!error && items && items.length === 0 && <div className="text-gray-500 text-xs">No audit entries yet.</div>}
          {items && items.length > 0 && (
            <ol className="space-y-3 border-l-2 border-violet-100 dark:border-gray-700 pl-4">
              {items.map(it => (
                <li key={it.id} className="relative">
                  <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-violet-500 border-2 border-white dark:border-gray-800" />
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{it.action.replace(/_/g, ' ')}</div>
                  <div className="text-[11px] text-gray-500">
                    {it.actor_name || it.actor_email || (it.actor_email_hash ? `actor#${it.actor_email_hash.slice(0, 8)}` : 'system')} · {new Date(it.created_at).toLocaleString()}
                  </div>
                  {it.target_type && (
                    <div className="text-[11px] text-gray-500 font-mono">{it.target_type}#{it.target_id}</div>
                  )}
                  {it.details && (
                    <pre className="mt-1 text-[10px] bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400 p-1.5 rounded overflow-x-auto">{it.details}</pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
