import { request } from '../api.js';

// D1246 (#3261, part 2 of #2385) — a Due Diligence case's lifecycle. Worker:
// routes/dd.ts, migration 620. No page reads these yet: the case tabs and
// dialogs are part 7 (#3266).
//
//   update        PATCH /dd/cases/:uid                 { lead_user_id?, target_ic_date?, round_label?, cheque_cents?, cheque_currency?, deal_id? }
//   archive       PATCH /dd/cases/:uid                 { archive: true, archived_reason }
//   decide        POST  /dd/cases/:uid/decision        { decision, reason } → { decision, status: 'completed', reviewers_told };
//                                                       409 blocking_flag_open when Proceed meets an open High in a blocking section
//   memo          GET   /dd/cases/:uid/memo            → { memo: { summary, verified, on_trust, conditions, updated_at, updated_by_name } | null }
//   saveMemo      PUT   /dd/cases/:uid/memo
//   reports       GET   /dd/cases/:uid/reports         → { items: [{ id, format, created_at, generated_by_name, risk_band_at_generation, stored }] }
//   downloadReport POST /dd/cases/:uid/reports/:id/download → { download_url } (five minutes; needs a recent step-up)
//   sendToIc      POST  /dd/cases/:uid/ic              → { ic_record: { uid, status } }
//
// Every path is written out in full so the drift check reads each one against the Worker.
const enc = encodeURIComponent;

export const DD_DECISIONS = ['proceed', 'proceed_with_conditions', 'do_not_proceed', 'withdrawn'];

export const ddLifecycleApi = {
  update: (uid, changes) => request(`/dd/cases/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  archive: (uid, reason) => request(`/dd/cases/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ archive: true, archived_reason: reason }) }),
  decide: (uid, decision, reason) => {
    if (!DD_DECISIONS.includes(decision)) throw new Error(`Unknown decision: ${decision}`);
    return request(`/dd/cases/${enc(uid)}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
  },
  memo: (uid) => request(`/dd/cases/${enc(uid)}/memo`),
  saveMemo: (uid, memo) => request(`/dd/cases/${enc(uid)}/memo`, { method: 'PUT', body: JSON.stringify(memo) }),
  reports: (uid) => request(`/dd/cases/${enc(uid)}/reports`),
  downloadReport: (uid, reportId) => request(`/dd/cases/${enc(uid)}/reports/${enc(reportId)}/download`, { method: 'POST' }),
  sendToIc: (uid) => request(`/dd/cases/${enc(uid)}/ic`, { method: 'POST' }),
};
