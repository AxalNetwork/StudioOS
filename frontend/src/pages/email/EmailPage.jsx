/**
 * D1344 (#3552, part 5 of #3547) — `/email` in every profile's shell (EM2),
 * and `/email/settings` (EM7).
 *
 *   · The header: the mailbox the page sends from (`mailboxLine`), or the
 *     connect cards (EM1) and the OAuth outcome (`?mail=`, EM1c and EM1d).
 *   · People: a founder's drafts and Network matches (`founderPeople`).
 *   · The conversation with the chosen person: what was sent to them, with
 *     what each quoted, and their drafts; "Write with Eadwyn".
 *   · "What Eadwyn knows": the person's pack, each record with its date, a
 *     switch per record; only the switched-on records go into a draft.
 *   · The composer (`ComposeSheet`), opened from here or from a record's
 *     Email action (`?person=…&compose=1&from=…`, EM4b).
 *
 * A Network match's address is read only from `GET /api/mail/shares`, and
 * only once both have shared (D1342); EM5's cards stand in until then.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import { Unreadable } from '../../ui';
import { mailApi } from '../../lib/api/mail.js';
import { founderPeople, mailboxLine, MODULE_OF_KIND, networkCard, quotedLine, recipientFor, sendingAccount, stateFor } from './emailModel.js';
import { BODY, BTN, CARD, ERROR, EYEBROW, H3, MUTED, PRIMARY, StateCard } from './emailParts.jsx';
import ComposeSheet from './ComposeSheet.jsx';
import ConnectPanel, { ConnectOutcome } from './ConnectPanel.jsx';
import EmailSettings from './EmailSettings.jsx';
import { MessagesMovedNotice } from './MessagesRedirect.jsx';

export default function EmailPage({ api = mailApi, userId }) {
  const { pathname } = useLocation();
  return <Frame><MessagesMovedNotice userId={userId}>{pathname.startsWith('/email/settings')
    ? <EmailSettings api={api} /> : <EmailHome api={api} />}</MessagesMovedNotice></Frame>;
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
  const [shares, setShares] = useState([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([api.accounts(), api.drafts(), api.shares().catch(() => ({ items: [] }))])
      .then(([a, d, s]) => { setAccounts(a?.accounts ?? []); setProviders(a?.providers ?? {}); setDrafts(d?.drafts ?? []); setShares(s?.items ?? []); })
      .catch(() => setFailed(true));
  }, [api]);
  useEffect(load, [load]);

  const account = sendingAccount(accounts ?? []);
  const expired = (accounts ?? []).find((a) => a.status === 'expired');
  const groups = useMemo(() => founderPeople({ drafts: drafts ?? [], shares }), [drafts, shares]);
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
      <People groups={groups} selected={person} onChoose={choose} />
      {person ? <Person key={person} refId={person} api={api} account={account} shares={shares} params={params} onShared={load}
        onCloseCompose={() => { const p = new URLSearchParams(params); p.delete('compose'); p.delete('from'); setParams(p); }}
        onSent={() => { load(); navigate(`/email?person=${encodeURIComponent(person)}`); }} />
        : <div className="lg:col-span-2">{groups.length ? <p className={`${CARD} ${BODY}`}>Choose a person to write to them, or open a record and press Email.</p>
          : <StateCard state={stateFor('no_people')} href="/validate/customer-research" />}</div>}
    </div>
  </>;
}

function People({ groups, selected, onChoose }) {
  const [q, setQ] = useState('');
  const shown = groups.map((g) => ({ ...g, people: g.people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())) }));
  return <aside className={`${CARD} flex flex-col gap-3`} aria-label="People" data-testid="email-people">
    <input type="search" className="min-h-[36px] rounded-axal-sm border border-axal-hairline bg-white px-2.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
    {shown.map((g) => <section key={g.key}><span className={EYEBROW}>{g.label}</span>
      <ul className="mt-1 flex flex-col">{g.people.map((p) => <li key={p.ref}>
        <button type="button" onClick={() => onChoose(p.ref)} aria-current={selected === p.ref ? 'true' : undefined}
          className={`flex w-full flex-col items-start rounded-axal-md px-2 py-1.5 text-left ${selected === p.ref ? 'bg-axal-lavender dark:bg-violet-950/40' : 'hover:bg-axal-ground dark:hover:bg-gray-800'}`}>
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{p.name}</span>
          <span className={`text-[11.5px] ${MUTED}`}>{p.source}{p.last ? ` · ${p.last}` : ''}</span>
        </button></li>)}</ul></section>)}
    {!groups.length && <p className={`text-[12.5px] ${MUTED}`}>People appear here as you draft emails from records and accept Network matches.</p>}
  </aside>;
}

function Person({ refId, api, account, shares, params, onCloseCompose, onSent, onShared }) {
  const [pack, setPack] = useState(null);
  const [failed, setFailed] = useState(null);
  const [off, setOff] = useState(new Set());
  const [sent, setSent] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [composing, setComposing] = useState(params.get('compose') === '1');

  const load = useCallback(() => {
    setFailed(null);
    api.context(refId).then((p) => { setPack(p); setOff(new Set((p?.items ?? []).filter((i) => !i.selected).map((i) => i.ref))); })
      .catch((e) => setFailed(e?.status === 404 ? 'not_found' : 'unreadable'));
    api.sent(1, refId).then(setSent).catch(() => setSent(false));
    api.drafts(refId).then((r) => setDrafts(r?.drafts ?? [])).catch(() => setDrafts(false));
  }, [api, refId]);
  useEffect(load, [load]);

  if (failed === 'not_found') return <div className="lg:col-span-2"><p className={`${CARD} ${BODY}`}>Record not found. It may have been removed, or it is not yours to read.</p></div>;
  if (failed) return <div className="lg:col-span-2"><Unreadable what="Unreadable: this person’s records" claim="Retry to read them." onRetry={load} /></div>;
  if (!pack) return <p className={`lg:col-span-2 ${MUTED}`}>Reading their records…</p>;

  const person = pack.person;
  const share = person.kind === 'member' ? shares.find((s) => s.person === person.ref) ?? null : null;
  const to = recipientFor(person, shares);
  const refs = pack.items.filter((i) => !off.has(i.ref)).map((i) => i.ref);
  const blocked = person.kind === 'member' && !(share?.ready);
  const write = () => setComposing(true);

  return <>
    <section className={`${CARD} flex min-w-0 flex-col gap-3`} data-testid="email-thread">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col"><h2 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">{person.name}</h2>
          <span className={`text-[12.5px] ${MUTED}`} data-testid="thread-address">{to ?? (person.kind === 'member' ? 'Address not shared yet' : 'No email address on record')}</span></div>
        {!blocked && <button type="button" className={PRIMARY} onClick={write} data-testid="write-with-eadwyn">Write with Eadwyn</button>}
      </div>
      {person.kind === 'member' && share && !share.ready && <NetworkCard share={share} api={api} onShared={onShared} />}
      {!to && person.kind !== 'member' && <StateCard state={stateFor('no_address', { name: person.name, module: MODULE_OF_KIND[person.kind] ?? 'their record' })} />}
      <ThreadRows sent={sent} drafts={drafts} />
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

    {composing && !blocked && <ComposeSheet pack={pack} refs={refs} to={to} account={account} from={params.get('from')} api={api}
      onClose={() => { setComposing(false); onCloseCompose(); }} onSent={() => { setComposing(false); onSent(); }} />}
  </>;
}

function ThreadRows({ sent, drafts }) {
  if (sent === false || drafts === false) return <p className={ERROR} role="alert">What you sent this person could not be read. Try again.</p>;
  if (sent === null || drafts === null) return <p className={MUTED}>Reading your emails…</p>;
  if (!sent.items.length && !drafts.length) return <p className={BODY}>Nothing written to them yet.</p>;
  return <ul className="flex flex-col gap-2">
    {sent.items.map((r) => <li key={r.uid} className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="thread-sent">
      <div className="flex justify-between gap-2"><span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.subject}</span>
        <span className={`font-mono text-[11.5px] ${MUTED}`}>{String(r.sent_at ?? r.created_at ?? '').slice(0, 16).replace('T', ' · ')}</span></div>
      <span className={`text-[12px] ${r.status === 'failed' ? 'text-red-700 dark:text-red-300' : MUTED}`}>{r.status === 'failed' ? `Not sent: ${r.error || 'the mail server refused it.'}` : quotedLine(r)}</span>
    </li>)}
    {drafts.map((d) => <li key={d.uid} className="rounded-axal-md border border-dashed border-axal-hairline p-3 dark:border-gray-700" data-testid="thread-draft">
      <span className={EYEBROW}>Draft · {String(d.created_at ?? '').slice(0, 10)}</span>
      <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{d.subject}</p>
      <p className={`m-0 line-clamp-3 ${BODY}`}>{d.body}</p>
    </li>)}
  </ul>;
}

/** EM5: a Network match not yet ready. Sharing is the member's own choice, behind a confirmation. */
function NetworkCard({ share, api, onShared }) {
  const card = networkCard(share);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const decide = async (yes) => {
    setError(null);
    try { await api.share(share.uid, yes); setAsking(false); onShared?.(); } catch (e) { setError(e?.message || 'That could not be saved. Try again.'); }
  };
  return <div className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid="network-card">
    <span className={EYEBROW}>{card.eyebrow}</span>
    <h3 className={`mt-1 ${H3}`}>{card.title}</h3>
    <p className={`mt-1 ${BODY}`}>{card.line}</p>
    {card.action && share.mine !== 'shared' && <button type="button" className={`mt-2 ${BTN}`} onClick={() => setAsking(true)}>{card.action}</button>}
    {share.mine === 'shared' && <span className="mt-2 inline-flex rounded-axal-pill border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Waiting</span>}
    {error && <p className={`mt-2 ${ERROR}`} role="alert">{error}</p>}
    {asking && <Lightbox title={`Share your email address with ${share.name}?`} label="Share your address" onClose={() => setAsking(false)} width={480} testId="share-confirm"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={() => decide(false)}>Not now</button>
        <button type="button" className={PRIMARY} onClick={() => decide(true)}>Yes, share it</button></div>}>
      <p className={BODY}>They will see your account’s address. You can stop sharing it at any time.</p>
    </Lightbox>}
  </div>;
}
