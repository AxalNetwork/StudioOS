import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Play, FileDown, Send, RefreshCw, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

export default function AdminDueDiligenceCasePage() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verdictModal, setVerdictModal] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
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

  const runScan = async () => {
    setBusy(true);
    try { await dd.scan(uid); push('Scan complete', 'success'); await load(); }
    catch (e) { push(e.message || 'Scan failed', 'error'); }
    finally { setBusy(false); }
  };

  const generateReport = async () => {
    setBusy(true);
    try {
      const r = await dd.generateReport(uid);
      if (r.download_url) {
        // Open the report in a new tab. Same-origin worker route streams the
        // file with Content-Disposition: attachment, so the browser downloads
        // it directly. Format may be 'pdf' or 'html' depending on whether
        // Browser Rendering is bound — surface that to the user.
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

  return (
    <div>
      <Link to="/admin/due-diligence" className="inline-flex items-center gap-1 text-sm text-violet-600 hover:underline mb-3">
        <ArrowLeft size={14} /> All cases
      </Link>

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
        <div className="flex items-center gap-2">
          <button onClick={runScan} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">
            <Play size={14} /> Run external scan
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

      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Sections</h2>
      <div className="space-y-3 mb-6">
        {data.sections.map(s => {
          const sectionFindings = data.findings.filter(f => f.section_id === s.id);
          return (
            <div key={s.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
                  <div className="text-xs text-gray-500">weight {Number(s.weight).toFixed(2)} · {s.status}</div>
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
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${s.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : s.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
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
        <VerdictModal section={verdictModal} onClose={() => setVerdictModal(null)}
          onSave={async (verdict, notes, ndaSigned) => {
            try { await dd.setVerdict(uid, verdictModal.id, verdict, notes, ndaSigned); push('Verdict recorded', 'success'); setVerdictModal(null); load(); }
            catch (e) { push(e.message || 'Failed', 'error'); }
          }} />
      )}
      {assignModal && (
        <AssignModal section={assignModal} onClose={() => setAssignModal(null)}
          onSave={async (userId) => {
            try { await dd.assignSection(uid, assignModal.id, userId); push('Reviewer assigned', 'success'); setAssignModal(null); load(); }
            catch (e) { push(e.message || 'Failed', 'error'); }
          }} />
      )}
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

function VerdictModal({ section, onClose, onSave }) {
  useEscapeClose(onClose);
  const [verdict, setVerdict] = useState(section.verdict || 'pass');
  const [notes, setNotes] = useState(section.reviewer_notes || '');
  const [ndaSigned, setNdaSigned] = useState(Boolean(section.reviewer_signed_nda_at));
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
        <label className="flex items-center gap-2 text-sm mb-4">
          <input type="checkbox" checked={ndaSigned} onChange={(e) => setNdaSigned(e.target.checked)} />
          <span>I have signed the reviewer NDA for this case.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
          <button onClick={() => onSave(verdict, notes, ndaSigned)}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700">
            <CheckCircle2 size={14} className="inline mr-1" /> Save verdict
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ section, onClose, onSave }) {
  useEscapeClose(onClose);
  const [userId, setUserId] = useState(section.assignee_user_id || '');
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Assign reviewer — {section.title}</h3>
        <p className="text-xs text-gray-500 mb-3">Enter the user ID of the partner / investor / mentor who will review this section. They will be notified by email and in-app.</p>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID"
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 mb-4" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
          <button onClick={() => onSave(Number(userId))} disabled={!userId}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">Assign</button>
        </div>
      </div>
    </div>
  );
}
