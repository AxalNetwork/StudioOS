/**
 * D6868 (#6868): investors' rights on the admin position sheet. For the company the sheet is about, HQ reads the
 * open requests to record a right (oldest first: the queue) and answers each — Record, prefilled with the holder and
 * the right asked for, whose save answers the request, or Decline with a reason the investor reads — then each
 * holder's six rights, recorded with their document and clause or not, with Record… or Correct…, then the answered
 * requests.
 *
 * It owns its read (`portfolioRightsApi.company`) and its writes (`record`, `decline`); after each write the list is
 * read again, so a request answered meanwhile shows as answered. Nothing here infers a right: HQ types what the
 * signed document says.
 *
 * States, kept apart:
 *   loading      the rights are being read
 *   unreadable   they could not be read: nothing is offered, and the sheet never says there are none; Retry
 *   none         no investor holds this company through a confirmed commitment, and no request is open
 *   list         the queue, the holders, the answered requests
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { portfolioRightsApi } from '../../lib/api/portfolioRights';
import { RIGHTS_SHAPE, RIGHT_WORDS, adminRefusal, adminRightsOf, recordProblem, requesterWord } from './rightsModel';
import { day } from './portfolioModel';

const BTN = 'px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-xs font-medium dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
const PRIMARY = 'px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium dark:bg-violet-500 dark:hover:bg-violet-600';
const INPUT = 'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100';
const MUTED = 'text-sm text-gray-500 dark:text-gray-400';
const LABEL = 'block text-xs text-gray-600 dark:text-gray-400';

function RecordForm({ id, start, onSave, onCancel }) {
  const [f, setF] = useState(() => ({ documentTitle: start?.document_title || '', clause: start?.clause || '', terms: start?.terms || '', signedOn: start?.signed_on || '' }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const problem = recordProblem(f);
  const set = (k) => (e) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const send = async (e) => {
    e.preventDefault();
    if (problem || sending) return;
    setSending(true); setError(null);
    try { await onSave({ documentTitle: f.documentTitle.trim(), clause: f.clause.trim() || null, terms: f.terms.trim(), signedOn: f.signedOn || null }); } catch (err) { setError(adminRefusal(err)); setSending(false); }
  };
  return (
    <form className="mt-2 space-y-2" onSubmit={send} data-testid={`form-right-${id}`}>
      <label className={LABEL}>Signed document<input className={INPUT} maxLength={200} value={f.documentTitle} onChange={set('documentTitle')} data-testid={`input-right-document-${id}`} /></label>
      <label className={LABEL}>Clause (optional)<input className={INPUT} maxLength={120} value={f.clause} onChange={set('clause')} data-testid={`input-right-clause-${id}`} /></label>
      <label className={LABEL}>What it grants, as the document says it<textarea className={INPUT} rows={2} maxLength={500} value={f.terms} onChange={set('terms')} data-testid={`input-right-terms-${id}`} /></label>
      <label className={LABEL}>Signed on (optional)<input className={INPUT} type="date" value={f.signedOn} onChange={set('signedOn')} data-testid={`input-right-signed-${id}`} /></label>
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300" role="alert" data-testid={`right-error-${id}`}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={Boolean(problem) || sending} title={problem || undefined} data-testid={`button-save-right-${id}`}>{sending ? 'Saving…' : 'Record right'}</button>
        <button type="button" className={BTN} onClick={onCancel} data-testid={`button-cancel-right-${id}`}>Cancel</button>
      </div>
    </form>
  );
}

function DeclineForm({ id, onDecline, onCancel }) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    if (!note.trim() || sending) return;
    setSending(true); setError(null);
    try { await onDecline(note.trim()); } catch (err) { setError(adminRefusal(err)); setSending(false); }
  };
  return (
    <form className="mt-2 space-y-2" onSubmit={send} data-testid={`form-decline-right-${id}`}>
      <label className={LABEL}>Why it is declined (the investor reads this)<textarea className={INPUT} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-decline-right-${id}`} /></label>
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300" role="alert" data-testid={`decline-right-error-${id}`}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={!note.trim() || sending} data-testid={`button-send-decline-right-${id}`}>{sending ? 'Saving…' : 'Decline request'}</button>
        <button type="button" className={BTN} onClick={onCancel} data-testid={`button-cancel-decline-right-${id}`}>Cancel</button>
      </div>
    </form>
  );
}

export default function RightsAdmin({ projectUid, companyName }) {
  const [read, setRead] = useState({ state: 'loading' });
  const [open, setOpen] = useState(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = (seq.current += 1);
    setRead({ state: 'loading' });
    portfolioRightsApi.company(projectUid).then(
      (v) => { if (seq.current === mine) setRead(RIGHTS_SHAPE(v) ? { state: 'ok', value: v } : { state: 'unreadable' }); },
      () => { if (seq.current === mine) setRead({ state: 'unreadable' }); },
    );
  }, [projectUid]);
  useEffect(() => { if (projectUid) load(); }, [projectUid, load]);

  // A failed write keeps its form and says why; a request answered meanwhile is read again, closed.
  const after = async (p) => {
    try { await p; } catch (e) { if (e?.code === 'request_answered') { setOpen(null); load(); } throw e; }
    setOpen(null); load();
  };
  const record = (holderId, type, requestUid) => (form) => after(portfolioRightsApi.record(projectUid, holderId, type, { ...form, requestUid }));
  const decline = (uid) => (note) => after(portfolioRightsApi.decline(uid, note));

  let body;
  if (read.state === 'loading') {
    body = <p className={MUTED} data-testid="admin-rights-loading">Reading investors’ rights…</p>;
  } else if (read.state !== 'ok') {
    body = (
      <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="admin-rights-unreadable">
        Investors’ rights in {companyName} could not be read, so whether a request is open is not known. That is not a claim that none is.
        {' '}<button type="button" className="underline" onClick={load} data-testid="button-retry-admin-rights">Retry</button>
      </p>
    );
  } else {
    const { open: queue, answered, holders } = adminRightsOf(read.value);
    if (!queue.length && !holders.length && !answered.length) {
      body = <p className={MUTED} data-testid="admin-rights-none">No investor holds {companyName} through a confirmed commitment, so there is no right to record.</p>;
    } else {
      body = (
        <div className="space-y-3">
          {queue.map((q) => (
            <div key={q.uid} className="border border-amber-200 dark:border-amber-800 rounded-lg p-3" data-testid={`admin-right-request-${q.uid}`} data-state="open">
              <p className="text-sm text-gray-900 dark:text-gray-100"><b>Record {RIGHT_WORDS[q.type] || 'a right'}</b> · {requesterWord(q)} · Requested{day(q.created_at) ? ` · ${day(q.created_at)}` : ''}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{q.description}</p>
              {open === `q-${q.uid}` ? <RecordForm id={q.uid} onSave={record(q.holder_id, q.type, q.uid)} onCancel={() => setOpen(null)} />
                : open === `d-${q.uid}` ? <DeclineForm id={q.uid} onDecline={decline(q.uid)} onCancel={() => setOpen(null)} />
                  : (
                    <div className="flex gap-2 mt-2">
                      <button type="button" className={BTN} disabled={q.holder_id == null} onClick={() => setOpen(`q-${q.uid}`)} data-testid={`button-record-request-${q.uid}`}>Record…</button>
                      <button type="button" className={BTN} onClick={() => setOpen(`d-${q.uid}`)} data-testid={`button-decline-request-${q.uid}`}>Decline…</button>
                    </div>
                  )}
            </div>
          ))}
          {holders.map((hd) => (
            <div key={hd.id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3" data-testid={`admin-rights-holder-${hd.id}`}>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{hd.name}</p>
              <ul className="mt-1 space-y-1">
                {hd.rights.map((r) => {
                  const key = `r-${hd.id}-${r.type}`;
                  return (
                    <li key={r.type} className="text-sm" data-testid={`admin-right-${hd.id}-${r.type}`} data-recorded={r.recorded ? 'yes' : 'no'}>
                      <span className="text-gray-900 dark:text-gray-100">{r.label}</span>
                      {' · '}
                      {r.recorded ? <span className="text-gray-700 dark:text-gray-300">{r.source.doc} · {r.right.terms}</span> : <span className={MUTED}>Not recorded at closing</span>}
                      {open === key ? <RecordForm id={`${hd.id}-${r.type}`} start={r.right} onSave={record(hd.id, r.type, null)} onCancel={() => setOpen(null)} />
                        : <>{' '}<button type="button" className="underline text-xs text-violet-700 dark:text-violet-300" onClick={() => setOpen(key)} data-testid={`button-record-right-${hd.id}-${r.type}`}>{r.recorded ? 'Correct…' : 'Record…'}</button></>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {answered.map((q) => (
            <div key={q.uid} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3" data-testid={`admin-right-request-${q.uid}`} data-state={q.state}>
              <p className="text-sm text-gray-900 dark:text-gray-100"><b>{RIGHT_WORDS[q.type] || 'Right'}</b> · {requesterWord(q)} · {q.state === 'recorded' ? 'Recorded' : 'Declined'}{day(q.answered_at) ? ` · ${day(q.answered_at)}` : ''}</p>
              {q.answer_note ? <p className={MUTED}>HQ: {q.answer_note}</p> : null}
            </div>
          ))}
        </div>
      );
    }
  }
  return (
    <section aria-labelledby="pf-admin-rights-title" data-testid="admin-rights" data-state={read.state}>
      <h3 id="pf-admin-rights-title" className="font-semibold text-gray-900 dark:text-gray-100 mb-2 mt-6">Investors’ rights</h3>
      <p className={`${MUTED} mb-2`}>From the signed documents. Each right names its document and clause; nothing is filled in for you.</p>
      {body}
    </section>
  );
}
