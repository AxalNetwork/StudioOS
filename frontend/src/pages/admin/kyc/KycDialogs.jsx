/**
 * D1233 (#3241) — the person's decision dialogs (KYC5 A–G, KYC15e), each in
 * the page and each saying what it changes; never a browser pop-up.
 *
 * THE AUTHENTICATOR CODE is the app's step-up (`StepUpModal`, BLOCK-AUTH-03):
 * Approve, Reject, Ask for information and the re-check are refused by the
 * Worker with `step_up_required` when the last check has lapsed, and
 * `request()` asks for the code and sends the decision again once. The dialog
 * says so before the press. Assigning, a note and Send to HQ decide nothing,
 * so the Worker asks no code for them.
 */
import React, { useEffect, useRef, useState } from 'react';
import { api, kycHqApi, kycPeopleApi } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import {
  HQ_NOTE_MAX, INFO_ASKS, NOTE_MAX, QUICK_REASONS, REASON_MIN, approveNeedsNote, infoMessage, noticePreview,
  refusalWord, screeningView, unlockLine,
} from './peopleModel';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CODE = 'A decision asks for your authenticator code when your last check has lapsed.';
const TOLD = 'They are told by email and in their inbox. Recorded under your name.';

/**
 * The shell every dialog shares: one press at a time, its refusal said in the
 * dialog in words, and closing locked while the write runs.
 */
function Dialog({ title, testId, children, button, danger = false, ready, run, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { onDone(await run()); } catch (e) {
      reportError('KycDialogs:write', e);
      setRefusal(refusalWord(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={close} width={560} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-refused`}>{refusal}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={!ready || busy} data-testid={`${testId}-go`}>{busy ? 'Saving…' : button}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

function Text({ label, value, onChange, testId, rows = 3, max = NOTE_MAX, min = 0, hint = null, placeholder = '' }) {
  const short = min > 0 && value.trim().length > 0 && value.trim().length < min;
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={max} placeholder={placeholder} className={FIELD} data-testid={testId} />
      {(short || hint) && <span className={short ? 'text-[12px] text-red-700 dark:text-red-300' : 'text-[12px] text-axal-muted dark:text-gray-400'}>{short ? `At least ${min} characters.` : hint}</span>}
    </label>
  );
}
const enough = (s, min = REASON_MIN) => s.trim().length >= min;

/** A · Approve. A note is optional, and required while the screening is not clear (KYC13b). */
export function ApproveDialog({ record, screening, onClose, onDone }) {
  const [note, setNote] = useState('');
  const needs = approveNeedsNote(screening);
  const sv = screeningView(screening);
  return (
    <Dialog title={`Approve ${record.name || 'this person'}’s identity check?`} testId="kyc-approve" button="Approve"
      ready={needs ? enough(note) : true}
      run={() => kycPeopleApi.approve(record.id, note.trim() || undefined)} onClose={onClose} onDone={onDone}>
      <p className={SUB}>{unlockLine(record.role)} A referrer, if any, is credited.</p>
      {needs && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="kyc-approve-screening">{sv.title}: {sv.line} Approving needs a note saying why.</p>}
      <Text label={needs ? 'Note · required' : 'Note · optional'} value={note} onChange={setNote} testId="kyc-approve-note" min={needs ? REASON_MIN : 0} placeholder="Add a note for the record" hint="Kept on the case’s history. The member does not read it." />
      <p className={SUB}>{TOLD}</p>
      <p className={SUB} data-testid="kyc-approve-code">{CODE}</p>
    </Dialog>
  );
}

/** B · Reject, with a reason the member reads. Rejecting deletes their uploaded documents. */
export function RejectDialog({ record, onClose, onDone }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={`Reject ${record.name || 'this person'}’s identity check?`} testId="kyc-reject" button="Reject" danger
      ready={enough(reason)} run={() => api.kycAdminReject(record.id, reason.trim())} onClose={onClose} onDone={onDone}>
      <div className="flex flex-col gap-1">
        <span className={EYE}>Quick reasons</span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((q) => (
            <button key={q} type="button" onClick={() => setReason((r) => (r.trim() ? `${r.trim()} ${q}` : q))}
              className="rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" data-testid="kyc-reject-quick">{q.replace(/\.$/, '')}</button>
          ))}
        </div>
      </div>
      <Text label="Reason · required" value={reason} onChange={setReason} testId="kyc-reject-reason" min={REASON_MIN} hint={`At least ${REASON_MIN} characters. They are told this reason.`} />
      <p className={SUB}>Rejecting deletes their uploaded ID documents. Your decision and reason are kept.</p>
      <p className={SUB}>They can submit again, and are told your reason by email and in their inbox. Recorded under your name.</p>
      <p className={SUB}>{CODE}</p>
    </Dialog>
  );
}

/** C · Ask for information. The case moves to Needs information. */
export function InfoDialog({ record, onClose, onDone }) {
  const [picks, setPicks] = useState([]);
  const [other, setOther] = useState('');
  const message = infoMessage(picks, other);
  const toggle = (k) => setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <Dialog title={`Ask ${record.name || 'this person'} for more information`} testId="kyc-info" button="Send request"
      ready={enough(message)} run={() => kycPeopleApi.needsInfo(record.id, message)} onClose={onClose} onDone={onDone}>
      <div className="flex flex-col gap-1.5">
        {INFO_ASKS.map((a) => (
          <label key={a.key} className="flex items-center gap-2">
            <input type="checkbox" checked={picks.includes(a.key)} onChange={() => toggle(a.key)} data-testid={`kyc-info-${a.key}`} />
            <span>{a.label}</span>
          </label>
        ))}
      </div>
      {picks.includes('other') && <Text label="What else" value={other} onChange={setOther} testId="kyc-info-other" rows={2} />}
      <div className="flex flex-col gap-1">
        <span className={EYE}>What they will read</span>
        <p className="m-0 rounded-lg bg-gray-50 p-3 text-[13px] dark:bg-gray-800" data-testid="kyc-info-preview">{message ? noticePreview('needs_info', message) : 'Pick what they should send.'}</p>
      </div>
      <p className={SUB}>The case moves to Needs information until they answer.</p>
      <p className={SUB}>{TOLD}</p>
      <p className={SUB}>{CODE}</p>
    </Dialog>
  );
}

/** D · Ask for a re-check, on an approved or expired case. Their approval ends now (D1229 §4). */
export function RecheckDialog({ record, onClose, onDone }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={`Ask ${record.name || 'this person'} for a re-check?`} testId="kyc-recheck" button="Ask for a re-check"
      ready={enough(reason)} run={() => kycPeopleApi.recheck(record.id, reason.trim())} onClose={onClose} onDone={onDone}>
      <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="kyc-recheck-ends">Their approval ends now. They cannot sign until the re-check is approved.</p>
      <Text label="Reason · required" value={reason} onChange={setReason} testId="kyc-recheck-reason" min={REASON_MIN} hint="They read this reason." />
      <p className={SUB}>{TOLD}</p>
      <p className={SUB}>{CODE}</p>
    </Dialog>
  );
}

/** F · Send to HQ, with a note. A Super Admin then decides; the studio's Approve and Reject stop. */
export function HqDialog({ record, onClose, onDone }) {
  const [note, setNote] = useState('');
  return (
    <Dialog title={`Send ${record.name || 'this person'}’s case to HQ?`} testId="kyc-hq" button="Send to HQ"
      ready={enough(note)} run={() => kycHqApi.sendToHq(record.id, note.trim())} onClose={onClose} onDone={onDone}>
      <Text label="Reason · required" value={note} onChange={setNote} testId="kyc-hq-note" min={REASON_MIN} max={HQ_NOTE_MAX} hint="HQ reads this reason." />
      <p className={SUB}>A Super Admin decides. You can still read the case. Recorded under your name.</p>
      <p className={SUB}>A politically exposed answer and a possible sanctions match go to HQ on their own when the member submits.</p>
    </Dialog>
  );
}

/** G · Review a possible sanctions match. Recorded once; it does not decide the case. */
export function MatchDialog({ record, screening, onClose, onDone }) {
  const [verdict, setVerdict] = useState('');
  const [note, setNote] = useState('');
  const words = { different: 'Not the same person', possible: 'Possibly the same person' };
  return (
    <Dialog title={`Review a possible match for ${record.name || 'this person'}`} testId="kyc-match" button="Save review"
      ready={Boolean(verdict) && enough(note)}
      run={() => kycHqApi.reviewMatch(screening.id, `${words[verdict]}: ${note.trim()}`)} onClose={onClose} onDone={onDone}>
      <div className="flex flex-col gap-1.5">
        {Object.entries(words).map(([k, w]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="kyc-match" checked={verdict === k} onChange={() => setVerdict(k)} data-testid={`kyc-match-${k}`} />
            <span>{w}</span>
          </label>
        ))}
      </div>
      <Text label="Note · required" value={note} onChange={setNote} testId="kyc-match-note" min={REASON_MIN} />
      <p className={SUB}>Recorded under your name. A review does not decide the case: a case with HQ stays with HQ.</p>
    </Dialog>
  );
}

/** Screen again: the legal name and nationality against the lists, recorded on the case. */
export function ScreenDialog({ record, onClose, onDone }) {
  const d = record.kyc_data || {};
  const name = `${d.legal_first_name || ''} ${d.legal_last_name || ''}`.trim();
  return (
    <Dialog title={`Screen ${record.name || 'this person'} again?`} testId="kyc-screen" button="Screen again"
      ready={Boolean(name)} run={() => api.trustScreenSanctions(record.id, { full_legal_name: name, nationality: d.nationality || d.country || null })}
      onClose={onClose} onDone={onDone}>
      <p className={SUB}>{name ? `Checks ${name}${d.nationality || d.country ? ` (${d.nationality || d.country})` : ''} against the OFAC, EU and UK lists, and records the result on this case.` : 'No legal name is on the record, so there is nothing to screen.'}</p>
      <p className={SUB}>The date of birth is not sent from here: it stays masked.</p>
    </Dialog>
  );
}

/**
 * Assign one case or several (the bulk bar). Me, another admin found by name
 * or email, or no one. The Worker re-checks that the holder is an admin.
 */
export function AssignDialog({ people, me, onClose, onDone }) {
  const [pick, setPick] = useState('me');
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ kind: 'idle', rows: [] });
  const [other, setOther] = useState(null);
  const [failed, setFailed] = useState([]);
  useEffect(() => {
    if (pick !== 'other' || q.trim().length < 2) { setFound({ kind: 'idle', rows: [] }); return undefined; }
    let live = true;
    setFound({ kind: 'loading', rows: [] });
    api.adminListUsers({ q: q.trim(), limit: 20 })
      .then((r) => { if (live) setFound({ kind: 'ok', rows: (Array.isArray(r) ? r : r?.results || []).filter((u) => u.role === 'admin') }); })
      .catch((e) => { reportError('KycDialogs:admins', e); if (live) setFound({ kind: 'failed', rows: [] }); });
    return () => { live = false; };
  }, [pick, q]);
  const target = pick === 'me' ? me?.id : pick === 'other' ? other?.id : null;
  const who = pick === 'me' ? 'you' : pick === 'other' ? (other?.name || other?.email || 'that admin') : 'no one';
  const many = people.length > 1;
  const run = async () => {
    const miss = [];
    for (const p of people) {
      try { await kycPeopleApi.assign(p.id, target ?? null); } catch (e) { reportError('KycDialogs:assign', e); miss.push(p.name || p.email || `#${p.id}`); }
    }
    setFailed(miss);
    if (miss.length === people.length) { const e = new Error(`Nothing was assigned: ${miss.join(', ')} could not be saved.`); throw e; }
    return { assigned: people.length - miss.length, failed: miss };
  };
  return (
    <Dialog title={many ? `Assign ${people.length} cases` : `Assign ${people[0]?.name || 'this case'}`} testId="kyc-assign" button="Assign"
      ready={pick === 'none' || (pick === 'me' && me?.id) || (pick === 'other' && other)} run={run} onClose={onClose} onDone={onDone}>
      <div className="flex flex-col gap-1.5">
        {[['me', 'Me'], ['other', 'Another admin'], ['none', 'No one']].map(([k, w]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="kyc-assign" checked={pick === k} onChange={() => setPick(k)} data-testid={`kyc-assign-${k}`} />
            <span>{w}</span>
          </label>
        ))}
      </div>
      {pick === 'other' && (
        <div className="flex flex-col gap-1">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an admin by name or email" className={FIELD} data-testid="kyc-assign-search" />
          {found.kind === 'loading' && <p className={SUB}>Reading…</p>}
          {found.kind === 'failed' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">The admins could not be read. Try again.</p>}
          {found.kind === 'ok' && !found.rows.length && <p className={SUB}>No admin matches “{q.trim()}”.</p>}
          {found.rows.map((u) => (
            <label key={u.id} className="flex items-center gap-2">
              <input type="radio" name="kyc-assign-admin" checked={other?.id === u.id} onChange={() => setOther(u)} data-testid={`kyc-assign-admin-${u.id}`} />
              <span>{u.name || u.email}</span>
            </label>
          ))}
        </div>
      )}
      <p className={SUB}>{many ? `Each of the ${people.length} cases` : 'The case'} will be held by {who}. Assigning decides nothing. Recorded under your name.</p>
      {failed.length > 0 && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">Not saved: {failed.join(', ')}.</p>}
    </Dialog>
  );
}
