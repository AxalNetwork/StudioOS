/**
 * #5310 part 3 — NW3.2 / NW3.4: one introduction request's record, opened
 * from a row of the Introductions log (`IntroductionsDesk`), as the shared
 * detail `Sheet`. It reads `GET /api/relationships/intro-requests/:uid`; the
 * words are `introRecordModel.js`'s, and D5310-p3 lists where this departs
 * from the board. Every action is one the Worker already allows that side:
 * withdraw (the asker, while pending), update the record (the introducer, a
 * send the mail server took), record the outcome (either, once made), and the
 * reader's own follow-up date.
 */
import { useCallback, useEffect, useState } from 'react';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { Sheet } from '../../ui';
import { reportError } from '../../lib/log';
import { OUTCOMES, UPDATE_RECORD } from './relationshipsModel';
import { CREDITS_LINE, ENDINGS_LINE, NO_RESEND, banner, followUpOf, headline, lifecycle, nextStep, people, subline, timeline } from './introRecordModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LABEL = 'm-0 text-[10.5px] font-bold uppercase tracking-[.04em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[32px] items-center justify-center rounded-[9px] px-3 text-[12px] font-bold disabled:opacity-50 max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400`;
const FIELD = 'min-h-[32px] rounded-[9px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 max-sm:min-h-[44px]';
const STEP = {
  done: 'border-axal-positive/40 bg-axal-positive/10 text-axal-positive dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  todo: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  ended: 'border-axal-hairline bg-white text-axal-faint line-through dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500',
};
const BANNER = {
  wait: 'border-axal-amber/40 bg-axal-amber/10 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  reconcile: 'border-axal-destructive/40 bg-axal-destructive/10 text-axal-destructive dark:border-red-800 dark:bg-red-950 dark:text-red-300',
};
const MARK = { done: '✓', todo: '○', ended: '–' };

export default function IntroRecordSheet({ uid, side, onClose, onChanged, api = relationshipsApi }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [outcome, setOutcome] = useState('');
  const [due, setDue] = useState('');

  const load = useCallback(() => {
    setRead((s) => ({ status: s.data ? 'ok' : 'loading', data: s.data }));
    api.introRequest(uid).then((d) => setRead({ status: 'ok', data: d?.request || null }))
      .catch((e) => { reportError('relationships:intro-record', e); setRead({ status: 'error', data: null }); });
  }, [api, uid]);
  useEffect(() => { load(); }, [load]);

  const act = async (call) => {
    setBusy(true); setErr('');
    try { const out = await call(); if (out?.request) setRead({ status: 'ok', data: out.request }); else load(); onChanged?.(); }
    catch (e) { setErr(e?.data?.message || e?.message || 'That could not be saved. Nothing changed.'); }
    finally { setBusy(false); }
  };

  const r = read.data;
  const b = r ? banner(r, side) : null;
  const next = r ? nextStep(r, side) : null;
  return (
    <Sheet eyebrow={side === 'asker' ? 'Introduction · you asked' : 'Introduction · asked of you'} title={r ? headline(r, side) : 'Introduction'}
      sub={r ? subline(r) : undefined} label="Introduction record" width={640} testId="intro-record" onClose={onClose}>
      <div className="flex flex-col gap-4 px-5 py-4 text-[13px]">
        {read.status === 'loading' && <p className={MUTED} aria-live="polite">Reading the record…</p>}
        {read.status === 'error' && (
          <div role="alert" className="flex flex-col items-start gap-2" data-testid="intro-record-unreadable">
            <span className={`font-bold ${INK}`}>This record could not be read. Nothing is shown in its place.</span>
            <button type="button" className={GHOST} onClick={load}>Try again</button>
          </div>
        )}
        {r && (
          <>
            {b && (
              <div className={`flex flex-col gap-2 rounded-[9px] border px-3 py-2.5 ${BANNER[b.tone]}`} role="status" data-testid={`intro-record-banner-${b.tone}`}>
                <p className="m-0 font-semibold">{b.tone === 'reconcile' ? '! ' : '◷ '}{b.text}</p>
                {b.tone === 'reconcile' && <p className="m-0 text-[12px]">{NO_RESEND}</p>}
              </div>
            )}

            <section aria-label="Lifecycle" className="flex flex-col gap-1.5">
              <h3 className={LABEL}>Lifecycle · recorded states only</h3>
              <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="intro-record-lifecycle">
                {lifecycle(r).map((s) => (
                  <li key={s.key} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${STEP[s.state]}`} data-testid={`intro-record-step-${s.key}`} data-state={s.state}>
                    {MARK[s.state]} {s.label}
                  </li>
                ))}
              </ol>
              <p className={MUTED}>{ENDINGS_LINE}</p>
            </section>

            <section aria-label="Record" className="flex flex-col gap-2" data-testid="intro-record-timeline">
              {timeline(r, side).map((t) => (
                <div key={t.key} className="flex flex-wrap items-start justify-between gap-2 border-t border-axal-hairline pt-2 first:border-t-0 first:pt-0 dark:border-gray-700" data-testid={`intro-record-entry-${t.key}`}>
                  <div className="min-w-0">
                    <p className={`m-0 font-semibold ${INK}`}>{t.recorded ? '✓' : '○'} {t.title}</p>
                    {t.note && <p className={MUTED}>{t.note}</p>}
                  </div>
                  <span className={`${MUTED} tabular-nums`}>{t.at || (t.recorded ? '' : '—')}</span>
                </div>
              ))}
            </section>

            <section aria-label="People" className="flex flex-col gap-1" data-testid="intro-record-people">
              <h3 className={LABEL}>People</h3>
              {people(r, side).map((p) => (
                <p key={p.role} className="m-0"><span className={MUTED}>{p.role} · </span><span className={`font-semibold ${INK}`}>{p.name}</span>{p.line ? <span className={MUTED}> · {p.line}</span> : null}</p>
              ))}
            </section>

            <section aria-label="Next step" className="flex flex-col gap-2" data-testid="intro-record-next">
              <h3 className={LABEL}>Next step</h3>
              <p className={`m-0 ${INK}`}>{next.text}</p>
              <div className="flex flex-wrap items-center gap-2">
                {next.actions.includes('withdraw') && (
                  <button type="button" className={GHOST} disabled={busy} onClick={() => act(() => api.withdrawIntro(r.uid))} data-testid="intro-record-withdraw">Withdraw request</button>
                )}
                {next.actions.includes('reconcile') && (
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => act(() => api.reconcileIntroDelivery(r.uid))} data-testid="intro-record-reconcile">{UPDATE_RECORD}</button>
                )}
                {next.actions.includes('outcome') && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <select className={FIELD} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Record the outcome" data-testid="intro-record-outcome-pick">
                      <option value="">Record the outcome</option>
                      {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <button type="button" className={GHOST} disabled={busy || !outcome} onClick={() => act(() => api.recordIntroOutcome(r.uid, outcome))} data-testid="intro-record-outcome-save">Save</button>
                  </span>
                )}
              </div>
              {next.actions.includes('follow_up') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={MUTED} data-testid="intro-record-follow">Your follow-up on this request: {followUpOf(r)}</span>
                  <input type="date" className={FIELD} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Follow-up date" data-testid="intro-record-follow-date" />
                  <button type="button" className={GHOST} disabled={busy || !due} onClick={() => act(() => api.setIntroFollowUp(r.uid, due))} data-testid="intro-record-follow-save">Change</button>
                </div>
              )}
              {err && <p role="alert" className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" data-testid="intro-record-error">{err}</p>}
            </section>

            <section aria-label="Credits" className="flex flex-col gap-1">
              <h3 className={LABEL}>Credits</h3>
              <p className={MUTED}>{CREDITS_LINE}</p>
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}
