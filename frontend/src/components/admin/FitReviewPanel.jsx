// Fit v2 — admin review panel (rendered as a tab of the Best-Fit Console).
// Left: the decision queue (latest decision per user × role). Right: the
// selected decision — engine scores + reasons, every answered question with
// its raw response and reviewer signal notes, per-question evidence ratings
// (0–3), and the review form (override + reason, requires-follow-up, notes).
// The engine's number starts the conversation; the review recorded here is
// the human judgment layer on top.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader2, AlertCircle, RefreshCw, Star, ShieldAlert, Save, CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { OutcomeChip } from '../fit/FitDecisionCard';

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5';
const SUB = 'text-xs text-gray-500 dark:text-gray-400';
const INPUT =
  'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 p-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500';

const OUTCOMES = [
  ['high_fit', 'High Fit'],
  ['conditional_fit', 'Conditional Fit'],
  ['specialist_fit', 'Specialist Fit'],
  ['low_fit', 'Low Fit'],
  ['misaligned', 'Misaligned'],
  ['insufficient_evidence', 'Insufficient Evidence'],
];

function EvidenceStars({ value, onChange }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2, 3].map((n) => (
        <button
          key={n}
          type="button"
          title={`${n} — ${['no evidence', 'stated example', 'specific & plausible', 'strong / verified'][n]}`}
          onClick={() => onChange(value === n ? null : n)}
          className="p-0.5"
        >
          <Star
            size={14}
            className={
              value != null && n <= value && n > 0
                ? 'text-amber-500 fill-amber-500'
                : value === 0 && n === 0
                  ? 'text-red-500'
                  : 'text-gray-300 dark:text-gray-600'
            }
          />
        </button>
      ))}
    </span>
  );
}

export default function FitReviewPanel() {
  const { user } = useAuth();
  const [queue, setQueue] = useState({ loading: true, error: null, items: [] });
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState({ loading: false, error: null, data: null });
  const [ratings, setRatings] = useState({});
  const [form, setForm] = useState({ override_outcome: '', override_reason: '', requires_followup: false, notes: '', status: 'open' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [recomputing, setRecomputing] = useState(false);

  const loadQueue = useCallback(() => {
    setQueue((q) => ({ ...q, loading: true }));
    api.fit
      .adminQueue(outcomeFilter ? { outcome: outcomeFilter } : {})
      .then((res) => setQueue({ loading: false, error: null, items: res.items || [] }))
      .catch((e) => setQueue({ loading: false, error: e?.message || 'failed', items: [] }));
  }, [outcomeFilter]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const loadDetail = useCallback((id) => {
    setSelectedId(id);
    setDetail({ loading: true, error: null, data: null });
    setSavedAt(null);
    api.fit
      .adminDecision(id)
      .then((data) => {
        setDetail({ loading: false, error: null, data });
        const mine = (data.reviews || []).find((r) => r.reviewer_email && user?.email && r.reviewer_email === user.email);
        let parsedRatings = {};
        try { parsedRatings = mine?.evidence_ratings_json ? JSON.parse(mine.evidence_ratings_json) : {}; } catch { parsedRatings = {}; }
        setRatings(parsedRatings);
        setForm({
          override_outcome: mine?.override_outcome || '',
          override_reason: mine?.override_reason || '',
          requires_followup: !!mine?.requires_followup,
          notes: mine?.notes || '',
          status: mine?.status || 'open',
        });
      })
      .catch((e) => setDetail({ loading: false, error: e?.message || 'failed', data: null }));
  }, [user]);

  const saveReview = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.fit.adminReview(selectedId, {
        evidence_ratings: ratings,
        override_outcome: form.override_outcome || null,
        override_reason: form.override_reason,
        requires_followup: form.requires_followup,
        notes: form.notes,
        status: form.status,
      });
      setSavedAt(new Date());
      loadQueue();
    } catch (e) {
      setDetail((d) => ({ ...d, error: e?.message || 'save failed' }));
    } finally {
      setSaving(false);
    }
  };

  const recompute = async () => {
    const d = detail.data?.decision;
    if (!d) return;
    setRecomputing(true);
    try {
      await api.fit.adminRecompute(d.user_id, d.role_context);
      loadQueue();
    } catch { /* surfaced by queue reload */ } finally {
      setRecomputing(false);
    }
  };

  const d = detail.data?.decision;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* Queue */}
      <div className={`${CARD} xl:col-span-1`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Decisions</h3>
          <div className="flex items-center gap-2">
            <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className={`${INPUT} !w-auto !py-1.5 text-xs`}>
              <option value="">All outcomes</option>
              {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="button" onClick={loadQueue} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        {queue.loading ? (
          <div className="h-24 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>
        ) : queue.error ? (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"><AlertCircle size={15} className="mt-0.5" /><span>{queue.error}</span></div>
        ) : queue.items.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No fit v2 decisions yet — they appear when users submit the staged assessment.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[540px] overflow-y-auto pr-1">
            {queue.items.map((item) => (
              <li key={item.decision_id}>
                <button
                  type="button"
                  onClick={() => loadDetail(item.decision_id)}
                  className={
                    selectedId === item.decision_id
                      ? 'w-full text-left rounded-lg border border-violet-500 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/30 p-2.5'
                      : 'w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 hover:border-violet-400 dark:hover:border-violet-500'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.user_name || item.user_email}</span>
                    <OutcomeChip outcome={item.override_outcome || item.outcome} label={(item.override_outcome || item.outcome).replace(/_/g, ' ')} />
                  </div>
                  <div className={`mt-1 flex items-center gap-2 ${SUB}`}>
                    <span>{item.role_context}</span>
                    <span>C {Math.round(item.culture_score)} · R {Math.round(item.role_score)}</span>
                    {item.flags?.length ? <span className="text-red-500 flex items-center gap-0.5"><ShieldAlert size={11} />{item.flags.length}</span> : null}
                    {item.requires_followup ? <span className="text-amber-600 dark:text-amber-400">follow-up</span> : null}
                    {item.review_count > 0 ? <span className="text-emerald-600 dark:text-emerald-400">reviewed</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail + review form */}
      <div className="xl:col-span-2 space-y-4">
        {!selectedId ? (
          <div className={`${CARD} text-sm text-gray-500 dark:text-gray-400`}>Select a decision to review its answers and record judgment.</div>
        ) : detail.loading ? (
          <div className={`${CARD} h-40 flex items-center justify-center text-gray-400`}><Loader2 className="animate-spin" size={20} /></div>
        ) : detail.error ? (
          <div className={CARD}><div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300"><AlertCircle size={15} className="mt-0.5" /><span>{detail.error}</span></div></div>
        ) : d ? (
          <>
            <div className={CARD}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <OutcomeChip outcome={d.outcome} label={d.outcome_label} />
                    <span className={SUB}>{detail.data.subject?.name || detail.data.subject?.email} · {d.role_context} · engine {d.engine_version}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{d.narrative}</p>
                </div>
                <button
                  type="button"
                  onClick={recompute}
                  disabled={recomputing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-medium px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {recomputing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Recompute
                </button>
              </div>
              <div className={`mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center`}>
                {[
                  ['Culture', Math.round(d.culture_score)],
                  ['Role', Math.round(d.role_score)],
                  ['Confidence', `${Math.round((d.confidence || 0) * 100)}%`],
                  ['Evidence', `${Math.round((d.evidence_quality || 0) * 100)}%`],
                ].map(([label, v]) => (
                  <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 py-2">
                    <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{v}</div>
                    <div className={SUB}>{label}</div>
                  </div>
                ))}
              </div>
              {(d.flags?.length || d.gaps?.length) ? (
                <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  {(d.flags || []).map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-red-600 dark:text-red-400"><ShieldAlert size={13} /> {f.replace(/_/g, ' ')}</li>
                  ))}
                  {(d.gaps || []).slice(0, 6).map((g, i) => <li key={i}>• {g.detail}</li>)}
                </ul>
              ) : null}
            </div>

            {/* Review form */}
            <div className={CARD}>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Partner review</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className={`${SUB} block mb-1`}>Override outcome (empty = keep engine)</label>
                  <select
                    value={form.override_outcome}
                    onChange={(e) => setForm((f) => ({ ...f, override_outcome: e.target.value }))}
                    className={INPUT}
                  >
                    <option value="">No override — engine stands</option>
                    {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`${SUB} block mb-1`}>Override reason {form.override_outcome ? '(required)' : ''}</label>
                  <input
                    type="text"
                    value={form.override_reason}
                    onChange={(e) => setForm((f) => ({ ...f, override_reason: e.target.value }))}
                    placeholder="Why the human call differs from the engine"
                    className={INPUT}
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className={`${SUB} block mb-1`}>Reviewer notes (never shown to the subject)</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={INPUT}
                />
              </div>
              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.requires_followup}
                      onChange={(e) => setForm((f) => ({ ...f, requires_followup: e.target.checked }))}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Requires follow-up
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.status === 'resolved'}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 'resolved' : 'open' }))}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Mark resolved
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  {savedAt ? <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> saved</span> : null}
                  <button
                    type="button"
                    onClick={saveReview}
                    disabled={saving || (!!form.override_outcome && !form.override_reason.trim())}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save review
                  </button>
                </div>
              </div>
            </div>

            {/* Responses with evidence ratings */}
            <div className={CARD}>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Answers ({detail.data.responses?.length || 0})</h4>
              <p className={`${SUB} mb-3`}>Rate the evidence quality of any answer 0–3; ratings save with your review and feed the confidence conversation.</p>
              <ul className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {(detail.data.responses || []).map(({ question, raw }) => (
                  <li key={question.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`${SUB} mb-0.5`}>{question.module} · {question.kind}{question.validation_pair ? ' · consistency pair' : ''}</div>
                        <div className="text-sm text-gray-900 dark:text-gray-100">{question.prompt}</div>
                        <div className="mt-1 text-sm text-violet-700 dark:text-violet-300 break-words">↳ {raw}</div>
                        {question.signal_notes ? (
                          <div className={`mt-1.5 ${SUB}`}>
                            {question.signal_notes.strong ? <div>Strong: {question.signal_notes.strong}</div> : null}
                            {question.signal_notes.weak ? <div>Weak: {question.signal_notes.weak}</div> : null}
                            {question.signal_notes.contradiction ? <div>Contradiction: {question.signal_notes.contradiction}</div> : null}
                          </div>
                        ) : null}
                        {question.followup_prompts?.length ? (
                          <div className={`mt-1 ${SUB}`}>Probe: {question.followup_prompts.join(' · ')}</div>
                        ) : null}
                      </div>
                      <EvidenceStars
                        value={ratings[question.id] ?? null}
                        onChange={(v) => setRatings((r) => {
                          const next = { ...r };
                          if (v == null) delete next[question.id];
                          else next[question.id] = v;
                          return next;
                        })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
