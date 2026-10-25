import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { X, ShieldCheck, XCircle, CheckCircle2 } from 'lucide-react';
import { KycSensitiveFields } from '../../../components/hqReview/SensitiveField';
import { ROLE_BADGES, KV, CONSOLE_LOADING, ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the KYC / AML queue and its review drawer. It reads the queue
 * only when this console is open (the read writes an audit row). A failed read
 * says so; it no longer draws "No submissions". D938: it is the KYC & KYB
 * page's body, at /admin/kyc.
 */

export default function KycConsole() {
  const [kycQueue, setKycQueue] = useState([]);
  const [kycFilter, setKycFilter] = useState('pending');
  const [kycDetail, setKycDetail] = useState(null);
  const [kycRejectReason, setKycRejectReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => { loadKyc(kycFilter); }, [kycFilter]);

  const loadKyc = async (status) => {
    try {
      const q = await api.kycAdminQueue(status);
      const rows = Array.isArray(q) ? q : [];
      setKycQueue(rows);
      setFailed(false);
    } catch (e) {
      reportError('AdminPage:loadKycQueue', e);
      setKycQueue([]);
      setFailed(true);
    } finally { setLoading(false); }
  };

  const approveKyc = async (userId) => {
    try {
      await api.kycAdminApprove(userId);
      setKycDetail(null);
      loadKyc(kycFilter);
    } catch (e) { alert(e.message); }
  };

  const rejectKyc = async (userId) => {
    if (!kycRejectReason || kycRejectReason.trim().length < 5) { alert('Reason must be at least 5 characters.'); return; }
    try {
      await api.kycAdminReject(userId, kycRejectReason.trim());
      setKycDetail(null);
      setKycRejectReason('');
      loadKyc(kycFilter);
    } catch (e) { alert(e.message); }
  };


  if (loading) return <div className="text-gray-600 text-center py-20">{CONSOLE_LOADING}</div>;

  return (
    <>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
            <ShieldCheck size={16} className="text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">KYC / AML Queue</h3>
            <div className="ml-auto flex gap-1">
              {['pending', 'approved', 'rejected', 'not_started'].map(s => (
                <button key={s} onClick={() => setKycFilter(s)}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium ${kycFilter === s ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          {failed ? (
            <ConsoleUnreadable what="The KYC queue" onRetry={() => loadKyc(kycFilter)} />
          ) : kycQueue.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No submissions in <strong>{kycFilter.replace('_', ' ')}</strong> status.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">User</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Role</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Provider</th>
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Submitted</th>
                    <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {kycQueue.map(k => (
                    <tr key={k.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{k.name}</div>
                        <div className="text-xs text-gray-500">{k.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGES[k.role] || 'bg-gray-100 text-gray-700'}`}>{k.role}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{k.kyc_provider || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{k.submitted_at ? new Date(k.submitted_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={async () => {
                          try {
                            setKycDetail(await api.kycAdminGet(k.id));
                            setKycRejectReason('');
                          } catch (e) {
                            reportError('AdminPage:kycRecord', e);
                            alert(e.message || 'The KYC record could not be read.');
                          }
                        }}
                          className="px-2.5 py-1.5 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg font-medium transition-colors">
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      {kycDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setKycDetail(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl dark:bg-gray-900" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3 sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
              <ShieldCheck size={18} className="text-violet-600" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">KYC Review — {kycDetail.name}</h3>
              <button onClick={() => setKycDetail(null)} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <KV label="Email" value={kycDetail.email} />
                <KV label="Role" value={kycDetail.role} />
                <KV label="Status" value={kycDetail.kyc_status} />
                <KV label="Provider" value={kycDetail.kyc_provider || '—'} />
                <KV label="Submitted" value={kycDetail.submitted_at ? new Date(kycDetail.submitted_at).toLocaleString() : '—'} />
                <KV label="Reviewed" value={kycDetail.reviewed_at ? new Date(kycDetail.reviewed_at).toLocaleString() : '—'} />
              </div>
              {kycDetail.kyc_data && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide dark:text-gray-300">Submitted Information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <KV label="Legal Name" value={`${kycDetail.kyc_data.legal_first_name || ''} ${kycDetail.kyc_data.legal_last_name || ''}`.trim()} />
                    <KV label="Nationality" value={kycDetail.kyc_data.nationality || '—'} />
                    <KV label="Country" value={kycDetail.kyc_data.country} />
                    <KV label="ID Type" value={kycDetail.kyc_data.id_type} />
                    <KV label="Document Uploaded" value={kycDetail.kyc_data.document_uploaded ? `Yes (${kycDetail.kyc_data.document_storage || 'unknown'})` : 'No'} />
                    <KV label="PEP Disclosed" value={kycDetail.kyc_data.pep_self_disclosed ? 'Yes' : 'No'} />
                  </div>
                  {/* D634 — masked until Show; each showing is logged by its route. */}
                  <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                    <KycSensitiveFields
                      masked={kycDetail.kyc_data.masked}
                      onShow={(field) => api.kycAdminShowField(kycDetail.id, field)}
                    />
                  </div>
                  {kycDetail.kyc_data.document_uploaded && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={async () => {
                          // Bearer auth: must fetch via authenticated API call,
                          // build a blob URL, and open that. A plain anchor link
                          // can't carry the Authorization header.
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/kyc/admin/${kycDetail.id}/document`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (!res.ok) {
                              const msg = await res.text().catch(() => '');
                              alert(`Failed to load document (${res.status}): ${msg}`);
                              return;
                            }
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const w = window.open(url, '_blank', 'noopener,noreferrer');
                            // Revoke after the new tab has had time to load.
                            setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            if (!w) alert('Pop-up blocked. Allow pop-ups for axal.vc and try again.');
                          } catch (e) {
                            alert(`Failed to load document: ${e?.message || e}`);
                          }
                        }}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-axal-violet hover:text-axal-violet/80 underline"
                      >
                        View ID Document &rarr;
                      </button>
                      <p className="text-[10px] text-gray-500 mt-1">Opens in a new tab. Every access is audit-logged.</p>
                    </div>
                  )}
                  {kycDetail.kyc_data.provider_result && (
                    <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs">
                      <div className="font-semibold text-gray-700 mb-1 dark:text-gray-300">Automated Provider Result: <span className="font-mono">{kycDetail.kyc_data.provider_result.result}</span></div>
                      <pre className="text-gray-600 whitespace-pre-wrap text-[11px]">{JSON.stringify(kycDetail.kyc_data.provider_result.checks, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
              {kycDetail.rejection_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <strong>Previous rejection:</strong> {kycDetail.rejection_reason}
                </div>
              )}
              {(kycDetail.kyc_status === 'pending' || kycDetail.kyc_status === 'rejected') && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <textarea value={kycRejectReason} onChange={e => setKycRejectReason(e.target.value)}
                    rows={2} placeholder="Rejection reason (required if rejecting; min 5 chars)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 outline-none dark:border-gray-700" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => rejectKyc(kycDetail.id)}
                      className="px-3 py-2 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-medium flex items-center gap-1.5">
                      <XCircle size={14} /> Reject
                    </button>
                    <button onClick={() => approveKyc(kycDetail.id)}
                      className="px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
