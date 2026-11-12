/**
 * D1344 (#3552, part 5 of #3547) — `/email` in every profile's shell (EM2),
 * and `/email/settings` (EM7).
 *
 *   · The header: the mailbox the page sends from (`mailboxLine`), or the
 *     connect cards (EM1) and the OAuth outcome (`?mail=`, EM1c and EM1d).
 *   · People: the member's recent drafts, then their profile's own groups
 *     from `GET /api/mail/people` (D4664, `peoplePane`), each group with its
 *     own empty or unreadable line.
 *   · The conversation with the chosen person: what was sent to them, with
 *     what each quoted, and their drafts; "Write with Eadwyn".
 *   · "What Eadwyn knows": the person's pack, each record with its date, a
 *     switch per record; only the switched-on records go into a draft.
 *   · The composer (`ComposeSheet`), opened from here or from a record's
 *     Email action (`?person=…&compose=1&from=…`, EM4b).
 *
 * A Network match's address is read only from `GET /api/mail/shares`, and
 * only once both have shared (D1342); EM5's cards stand in until then.
 * D4664 (#4664): that read keeps its state apart from its data, so a failed
 * read is "could not be read" with Try again, never "not shared" and never
 * an address; and the card offers Stop sharing, behind a confirmation, both
 * while waiting and once both have shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import { Unreadable } from '../../ui';
import { mailApi } from '../../lib/api/mail.js';
import { draftChain, draftRowText, mailboxLine, MODULE_OF_KIND, networkCard, noPeopleState, peoplePane, sentLine, recipientFor, sendingAccount, shareStatus, stateFor } from './emailModel.js';
import { BODY, BTN, CARD, DANGER, ERROR, EYEBROW, H3, MUTED, PRIMARY, StateCard } from './emailParts.jsx';
import ComposeSheet from './ComposeSheet.jsx';
import ConnectPanel, { ConnectOutcome } from './ConnectPanel.jsx';
import EmailSettings from './EmailSettings.jsx';
import { MessagesMovedNotice } from './MessagesRedirect.jsx';

export default function EmailPage({ api = mailApi, userId }) {
  const { pathname } = useLocation();
  return <Frame><MessagesMovedNotice userId={userId}>{pathname.startsWith('/email/settings')
    ? <EmailSettings api={api} /> : <EmailHome key={userId ?? 'current'} api={api} />}</MessagesMovedNotice></Frame>;
}

function Frame({ children }) {
  return <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-5 sm:px-6" data-testid="email-page">{children}</div>;
}

function EmailHome({ api }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const person = params.get('person');
  const [accounts, setAccounts] = useState(null);
  const [providers, setProviders] = useState({});
  const [drafts, setDrafts] = useState(null);
  const [failed, setFailed] = useState(false);
  // D4664 (#4664, finding 10): the shares read's state, apart from its data. A failure is `unreadable`, never `{ items: [] }`.
  const [sharesRead, setSharesRead] = useState({ status: 'reading', items: [] });
  // D4664 (finding 8): the profile's own People read (`GET /api/mail/people`); each group carries its own empty or error.
  const [peopleRead, setPeopleRead] = useState({ status: 'reading', data: null });
  const sharesSeq = useRef(0);
  const peopleSeq = useRef(0);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([api.accounts(), api.drafts()])
      .then(([a, d]) => { setAccounts(a?.accounts ?? []); setProviders(a?.providers ?? {}); setDrafts(d?.drafts ?? []); })
      .catch(() => setFailed(true));
  }, [api]);
  // `quiet` re-reads without first forgetting what was read (after a share or a stop); a failure still forgets it, so no unverified address stays.
  const readShares = useCallback((quiet = false) => {
    const seq = ++sharesSeq.current;
    if (!quiet) setSharesRead({ status: 'reading', items: [] });
    Promise.resolve().then(() => api.shares())
      .then((s) => { if (seq === sharesSeq.current) setSharesRead({ status: 'ready', items: Array.isArray(s?.items) ? s.items : [] }); })
      .catch(() => { if (seq === sharesSeq.current) setSharesRead({ status: 'unreadable', items: [] }); });
  }, [api]);
  const readPeople = useCallback(() => {
    const seq = ++peopleSeq.current;
    setPeopleRead({ status: 'reading', data: null });
    Promise.resolve().then(() => api.people())
      .then((p) => { if (seq === peopleSeq.current) setPeopleRead({ status: 'ready', data: p ?? null }); })
      .catch(() => { if (seq === peopleSeq.current) setPeopleRead({ status: 'unreadable', data: null }); });
  }, [api]);
  useEffect(load, [load]);
  useEffect(() => { readShares(); }, [readShares]);
  useEffect(() => { readPeople(); }, [readPeople]);
  // A share or a stop answered with the pair's new state: draw it at once, then read the list again.
  const shareChanged = useCallback((share) => {
    if (share?.uid) {
      setSharesRead((r) => (r.status === 'ready' ? { status: 'ready', items: r.items.map((s) => (s.uid === share.uid ? share : s)) } : r));
      readShares(true);
    } else readShares();
  }, [readShares]);

  const shares = sharesRead.status === 'ready' ? sharesRead.items : [];
  const account = sendingAccount(accounts ?? []);
  const expired = (accounts ?? []).find((a) => a.status === 'expired');
  const pane = useMemo(() => peoplePane({ drafts: drafts ?? [], people: peopleRead }), [drafts, peopleRead]);
  const empty = noPeopleState(pane.profile);
  const choose = (ref) => setParams(ref ? { person: ref } : {});

  if (failed) return <Unreadable what="Unreadable: your email" claim="Retry to read your mailboxes and drafts." onRetry={load} />;
  if (accounts === null) return <p className={MUTED}>Reading your email…</p>;

  return <>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1"><span className={EYEBROW}>Email</span>
        <h1 className="m-0 text-[24px] font-extrabold text-axal-ink dark:text-gray-100">Email</h1></div>
      <div className="flex flex-wrap items-center gap-2">
        {account && <span className="rounded-axal-pill border border-axal-hairline px-3 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:text-gray-200" data-testid="mailbox-chip">✉ {mailboxLine(account)}</span>}
        <Link to="/email/settings" className={BTN}>Email settings</Link>
      </div>
    </header>
    <ConnectOutcome outcome={params.get('mail')} />
    {expired && !account && <StateCard state={stateFor('expired', { provider: expired.provider === 'gmail' ? 'Gmail' : expired.provider === 'outlook' ? 'Outlook' : 'Your mailbox', sentence: expired.last_error })} href="/email/settings" />}
    {!account && !expired && <ConnectPanel providers={providers} onConnected={load} api={api} />}

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      <People pane={pane} selected={person} onChoose={choose} onRetry={readPeople} />
      {person ? <Person key={person} refId={person} api={api} account={account} shares={shares} sharesRead={sharesRead} params={params}
        onRetryShares={() => readShares()} onShareChanged={shareChanged}
        onCloseCompose={() => { const p = new URLSearchParams(params); p.delete('compose'); p.delete('from'); setParams(p); }}
        onSent={() => { load(); navigate(`/email?person=${encodeURIComponent(person)}`); }} />
        : <div className="lg:col-span-2">{pane.none ? <StateCard state={empty} href={empty.href} testId="email-no-people" />
          : <p className={`${CARD} ${BODY}`} data-testid="email-choose">{pane.prompt ?? 'Choose a person to write to them, or open a record and press Email.'}</p>}</div>}
    </div>
  </>;
}

/**
 * D4664 (#4664, finding 8): the recent drafts, then the profile's groups as
 * the Worker returned them. Each group draws its own rows, its own empty
 * line or its own unreadable line; one failed group leaves the others as read.
 */
function People({ pane, selected, onChoose, onRetry }) {
  const [q, setQ] = useState('');
  const hit = (p) => !q || p.name.toLowerCase().includes(q.toLowerCase());
  return <aside className={`${CARD} flex flex-col gap-3`} aria-label="People" data-testid="email-people">
    <input type="search" className="min-h-[36px] rounded-axal-sm border border-axal-hairline bg-white px-2.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
    {pane.groups.map((g) => <section key={g.key} data-testid={`people-group-${g.key}`} data-state={g.error ? 'unreadable' : g.people.length ? 'ready' : 'empty'}>
      <span className={EYEBROW}>{g.label}</span>
      {g.error ? <Unreadable what={g.label} claim="The other groups are as read." onRetry={onRetry} />
        : !g.people.length ? <p className={`mt-1 text-[12px] ${MUTED}`}>{g.empty ?? 'No one here yet.'}</p>
          : <ul className="mt-1 flex flex-col">{g.people.filter(hit).map((p) => <li key={p.ref}>
            <button type="button" onClick={() => onChoose(p.ref)} aria-current={selected === p.ref ? 'true' : undefined} data-testid="people-row"
              className={`flex w-full flex-col items-start rounded-axal-md px-2 py-1.5 text-left ${selected === p.ref ? 'bg-axal-lavender dark:bg-violet-950/40' : 'hover:bg-axal-ground dark:hover:bg-gray-800'}`}>
              <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{p.name}
                {p.marker && <span className="rounded-axal-pill border border-amber-300 bg-amber-50 px-1.5 text-[10.5px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="people-marker">{p.marker}</span>}</span>
              <span className={`text-[11.5px] ${MUTED}`}>{p.role ? `${p.role} · ` : ''}{p.source}{p.last ? ` · last contact ${p.last}` : ''}</span>
            </button></li>)}</ul>}
    </section>)}
    {pane.status === 'reading' && <p className={`text-[12.5px] ${MUTED}`} role="status" data-testid="people-reading">Reading the people you work with…</p>}
    {pane.status === 'unreadable' && <div data-testid="people-unreadable"><Unreadable what="The people you work with" claim="Nothing here is shown as empty." onRetry={onRetry} /></div>}
    {pane.none && <p className={`text-[12.5px] ${MUTED}`}>{noPeopleState(pane.profile).line}</p>}
    {pane.note && <p className={`text-[12px] ${MUTED}`} data-testid="people-note">{pane.note}</p>}
  </aside>;
}

function Person({ refId, api, account, shares, sharesRead, params, onCloseCompose, onSent, onRetryShares, onShareChanged }) {
  const [pack, setPack] = useState(null);
  const [failed, setFailed] = useState(null);
  const [off, setOff] = useState(new Set());
  const [sent, setSent] = useState(null);
  const [sentRead, setSentRead] = useState('reading');
  const sentSeq = useRef(0);
  const draftSeq = useRef(0);
  const contextSeq = useRef(0);
  const [drafts, setDrafts] = useState(null);
  const [composing, setComposing] = useState(params.get('compose') === '1');
  const [resume, setResume] = useState(null);

  // D4662: every refresh supersedes older pages. Cleanup also fences replies after a person/account switch.
  const readSent = useCallback((page = 1) => {
    const seq = ++sentSeq.current;
    setSentRead('reading');
    Promise.resolve().then(() => api.sent(page, refId)).then((r) => {
      if (seq !== sentSeq.current) return;
      setSent((old) => {
        if (page === 1) return r;
        const rows = new Map((old?.items ?? []).map((row) => [row.uid, row]));
        for (const row of r.items) rows.set(row.uid, row);
        return { ...r, items: [...rows.values()] };
      });
      setSentRead('ready');
    }).catch(() => { if (seq === sentSeq.current) setSentRead('unreadable'); });
  }, [api, refId]);
  const readDrafts = useCallback(() => {
    const seq = ++draftSeq.current;
    Promise.resolve().then(() => api.drafts(refId))
      .then((r) => { if (seq === draftSeq.current) setDrafts(r?.drafts ?? []); })
      .catch(() => { if (seq === draftSeq.current) setDrafts(false); });
  }, [api, refId]);
  const load = useCallback(() => {
    const seq = ++contextSeq.current;
    setFailed(null);
    Promise.resolve().then(() => api.context(refId)).then((p) => {
      if (seq !== contextSeq.current) return;
      setPack(p); setOff(new Set((p?.items ?? []).filter((i) => !i.selected).map((i) => i.ref)));
    }).catch((e) => { if (seq === contextSeq.current) setFailed(e?.status === 404 ? 'not_found' : 'unreadable'); });
    readSent(); readDrafts();
  }, [api, refId, readSent, readDrafts]);
  useEffect(() => {
    load();
    return () => { sentSeq.current += 1; draftSeq.current += 1; contextSeq.current += 1; };
  }, [load]);

  if (failed === 'not_found') return <div className="lg:col-span-2"><p className={`${CARD} ${BODY}`}>Record not found. It may have been removed, or it is not yours to read.</p></div>;
  if (failed) return <div className="lg:col-span-2"><Unreadable what="Unreadable: this person’s records" claim="Retry to read them." onRetry={load} /></div>;
  if (!pack) return <p className={`lg:col-span-2 ${MUTED}`}>Reading their records…</p>;

  const person = pack.person;
  // D4664 (finding 10): a match's sharing is known only from a shares read that answered; until then it is unknown, not "not shared".
  const sharing = person.kind === 'member' ? shareStatus(sharesRead, person.ref) : null;
  const to = recipientFor(person, shares);
  const refs = pack.items.filter((i) => !off.has(i.ref)).map((i) => i.ref);
  const blocked = person.kind === 'member' && sharing.state !== 'ready';
  const write = () => { setResume(null); setComposing(true); };
  // #4660: a stored draft opens in the composer with its versions and the member's saved text, and sends without another run.
  const open = (uid) => { const chain = draftChain(drafts, uid); if (chain) { setResume(chain); setComposing(true); } };
  const closeComposer = () => {
    setComposing(false); setResume(null); onCloseCompose();
    readDrafts();
  };

  return <>
    <section className={`${CARD} flex min-w-0 flex-col gap-3`} data-testid="email-thread">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col"><h2 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">{person.name}</h2>
          <span className={`text-[12.5px] ${MUTED}`} data-testid="thread-address">{to ?? (person.kind === 'member' ? MEMBER_ADDRESS[sharing.state] ?? MEMBER_ADDRESS.none : 'No email address on record')}</span></div>
        {!blocked && <button type="button" className={PRIMARY} onClick={write} data-testid="write-with-eadwyn">Draft an email</button>}
      </div>
      {person.kind === 'member' && <SharingCard sharing={sharing} name={person.name} api={api} onRetry={onRetryShares} onChanged={onShareChanged} />}
      {!to && person.kind !== 'member' && <StateCard state={stateFor('no_address', { name: person.name, module: MODULE_OF_KIND[person.kind] ?? 'their record' })} />}
      <ThreadRows sent={sent} sentRead={sentRead} drafts={drafts} onOpen={open} onRetry={() => { readSent(); readDrafts(); }} onMore={() => readSent(sent.page + 1)} />
      {!account?.can_read && account && <p className={`text-[12px] ${MUTED}`}>Replies arrive in your mailbox, not here.</p>}
    </section>

    <aside className={`${CARD} flex flex-col gap-2`} aria-label="What Eadwyn knows" data-testid="email-knows">
      <h3 className={H3}>What Eadwyn knows</h3>
      <span className={`text-[12px] ${MUTED}`}>For your next email to {person.name}</span>
      <ul className="flex flex-col divide-y divide-axal-hairline dark:divide-gray-700">{pack.items.map((i) => <li key={i.ref} className="flex items-center justify-between gap-3 py-2">
        <span className="flex flex-col"><span className="text-[12.5px] text-axal-ink dark:text-gray-200">{i.label}</span>
          <span className={`text-[11.5px] ${MUTED}`}>{i.as_of ? `as of ${i.as_of}` : 'date not recorded'}</span></span>
        <input type="checkbox" className="h-4 w-4 accent-axal-violet" aria-label={`Let Eadwyn read ${i.label}`} checked={!off.has(i.ref)}
          onChange={() => setOff((s) => { const n = new Set(s); if (n.has(i.ref)) n.delete(i.ref); else n.add(i.ref); return n; })} />
      </li>)}</ul>
      <p className={`text-[12px] ${MUTED}`}>Nothing else is shared. Turn a record off and Eadwyn will not read it for this email.</p>
    </aside>

    {composing && !blocked && <ComposeSheet key={resume?.versions?.[resume.at]?.uid ?? 'new'} pack={pack} refs={refs} to={to} account={account} from={params.get('from')} api={api} resume={resume}
      onClose={closeComposer} onSent={() => { setComposing(false); setResume(null); readSent(); readDrafts(); onSent(); }} />}
  </>;
}

function ThreadRows({ sent, sentRead, drafts, onOpen, onRetry, onMore }) {
  const unreadable = sentRead === 'unreadable' || drafts === false;
  return <>
    {unreadable && <Unreadable what="Unreadable: this conversation’s history" claim="Retry to read the full history for this person." onRetry={onRetry} />}
    {sentRead === 'reading' && <p className={MUTED} role="status">Reading your emails…</p>}
    {sentRead === 'ready' && drafts !== null && drafts !== false && !sent?.items.length && !drafts.length && <p className={BODY}>Nothing written to them yet.</p>}
    <ul className="flex flex-col gap-2">
    {(sent?.items ?? []).map((r) => <li key={r.uid} className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="thread-sent">
      <div className="flex justify-between gap-2"><span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.subject}</span>
        <span className={`font-mono text-[11.5px] ${MUTED}`}>{String(r.sent_at ?? r.created_at ?? '').slice(0, 16).replace('T', ' · ')}</span></div>
      <span className={`text-[12px] ${r.status === 'failed' ? 'text-red-700 dark:text-red-300' : MUTED}`}>{sentLine(r)}</span>
    </li>)}
    {(Array.isArray(drafts) ? drafts : []).map((d) => { const t = draftRowText(d); return <li key={d.uid} className="rounded-axal-md border border-dashed border-axal-hairline p-3 dark:border-gray-700" data-testid="thread-draft">
      <span className={EYEBROW}>Draft · {String(d.created_at ?? '').slice(0, 10)}{t.edited ? ' · edited' : ''}</span>
      <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{t.subject}</p>
      <p className={`m-0 line-clamp-3 ${BODY}`}>{t.body}</p>
      <button type="button" className={`mt-2 ${BTN}`} onClick={() => onOpen?.(d.uid)} data-testid="thread-draft-open">Open draft</button>
    </li>; })}
    </ul>
    {sent && <p className={`text-[12px] ${MUTED}`} data-testid="thread-history-count">Showing {sent.items.length} of {sent.total} recorded sends{sentRead === 'unreadable' ? ' · history could not be refreshed' : ''}.</p>}
    {sent && sent.page * sent.per_page < sent.total && <button type="button" className={BTN} disabled={sentRead === 'reading'} onClick={onMore} data-testid="thread-history-more">Load older emails</button>}
  </>;
}

/** D4664 (finding 10): the thread's address line for a Network match, by what the shares read established. */
const MEMBER_ADDRESS = Object.freeze({
  reading: 'Reading what you both shared…',
  unreadable: 'Address not verified: sharing could not be read',
  none: 'Address not shared yet',
});

/** D4664: before Stop sharing, what is true now, by state. */
const STOP_NOW = Object.freeze({
  ready: (name) => `You and ${name} both shared an address, so you can email each other from here.`,
  waiting: (name) => `You shared your address. ${name} has not shared theirs yet.`,
});

/**
 * EM5: a Network match's sharing, in every state the shares read can be in.
 * Sharing is the member's own choice, behind a confirmation; so is stopping
 * (D4664, finding 9), offered while waiting and once both have shared. Stop
 * sharing goes scope (the card), review (the confirmation: what stops, what
 * stays), result (a line, only once the Worker said it stopped). Cancel
 * writes nothing; a failed stop says nothing stopped.
 */
function SharingCard({ sharing, name, api, onRetry, onChanged }) {
  const [asking, setAsking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stopError, setStopError] = useState(null);
  const [result, setResult] = useState(null);
  const inFlight = useRef(false);
  const share = sharing.share;

  const decide = async (yes) => {
    setError(null); setResult(null);
    try { const r = await api.share(share.uid, yes); setAsking(false); onChanged?.(r?.share ?? null); } catch (e) { setError(e?.message || 'That could not be saved. Try again.'); }
  };
  const stop = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setStopError(null);
    try {
      const r = await api.unshare(share.uid);
      setStopping(false);
      setResult(`You stopped sharing your address with ${name}. They no longer see it, and Email between you is closed until you both share again.`);
      onChanged?.(r?.share ?? null);
    } catch (e) {
      setStopError(`Sharing did not stop${e?.message ? `: ${e.message}` : ''}. Nothing changed. Try again.`);
    } finally { inFlight.current = false; setBusy(false); }
  };
  const resultLine = result && <p className={`mt-2 ${BODY}`} role="status" data-testid="sharing-result">{result}</p>;

  if (sharing.state === 'reading') return <p className={`text-[12.5px] ${MUTED}`} role="status" data-testid="sharing-reading">Reading what you and {name} shared…</p>;
  if (sharing.state === 'unreadable') {
    return <div className="rounded-axal-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30" role="alert" data-testid="sharing-unreadable">
      <span className={EYEBROW}>Network · not verified</span>
      <p className={`mt-1 ${BODY}`}>Whether you and {name} shared an address could not be read. Nothing is assumed: no address is shown and Email stays closed until it is read.</p>
      <button type="button" className={`mt-2 ${BTN}`} onClick={onRetry} data-testid="sharing-retry">Try again</button>
    </div>;
  }
  if (!share) return resultLine || null;
  const card = networkCard(share);
  const canStop = sharing.state === 'ready' || sharing.state === 'waiting';
  return <div className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="network-card" data-state={sharing.state}>
    <span className={EYEBROW}>{card.eyebrow}</span>
    <h3 className={`mt-1 ${H3}`}>{sharing.state === 'ready' ? `You and ${name} shared an address` : card.title}</h3>
    <p className={`mt-1 ${BODY}`}>{card.line}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {sharing.state === 'matched' && card.action && <button type="button" className={BTN} onClick={() => setAsking(true)}>{card.action}</button>}
      {sharing.state === 'waiting' && <span className="inline-flex rounded-axal-pill border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Waiting</span>}
      {canStop && <button type="button" className={DANGER} onClick={() => { setStopError(null); setStopping(true); }} data-testid="sharing-stop">Stop sharing</button>}
    </div>
    {resultLine}
    {error && <p className={`mt-2 ${ERROR}`} role="alert">{error}</p>}
    {asking && <Lightbox title={`Share your email address with ${share.name}?`} label="Share your address" onClose={() => setAsking(false)} width={480} testId="share-confirm"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={() => decide(false)}>Not now</button>
        <button type="button" className={PRIMARY} onClick={() => decide(true)}>Yes, share it</button></div>}>
      <p className={BODY}>They will see your account’s address. You can stop sharing it at any time.</p>
    </Lightbox>}
    {stopping && canStop && <Lightbox title={`Stop sharing your address with ${name}?`} label="Stop sharing your address" onClose={() => { if (!busy) setStopping(false); }} width={480} testId="unshare-confirm"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} disabled={busy} onClick={() => setStopping(false)} data-testid="unshare-cancel">Keep sharing</button>
        <button type="button" className={DANGER} disabled={busy} onClick={stop} data-testid="unshare-stop">{busy ? 'Stopping…' : 'Stop sharing'}</button></div>}>
      <p className={BODY}>{STOP_NOW[sharing.state](name)}</p>
      <p className={`mt-2 ${BODY}`}>Once you stop, {name} no longer sees your address and Email between you closes until you both share again. Emails already sent stay sent. You can share again later.</p>
      {stopError && <p className={`mt-2 ${ERROR}`} role="alert" data-testid="unshare-error">{stopError}</p>}
    </Lightbox>}
  </div>;
}
