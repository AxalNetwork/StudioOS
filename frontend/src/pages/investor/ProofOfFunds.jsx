import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandIcon, Lightbox, Pill, Unreadable, Unrecorded, actionDanger, actionGhost, actionPrimary } from '../../ui';
import { reportError } from '../../lib/log';
import { mercuryAttestationsApi } from '../../lib/api/mercuryAttestations';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';
import { Banner, Group, Row } from '../account/ConnectorSheet';
import {
  CAP_WORDS, CLOSE_CODES, CONNECTORS_LINK, CONNECTOR_DOOR_CODES, CONNECT_FIRST, EMPTY_LIST, HOLDER_MISSING, LIST_UNREADABLE,
  ONLY_CHECKING_SAVINGS, PURPOSE_UNREADABLE, REPLACES_ACTIVE, REVOKE_CONFIRM, SECTION_LINE, SECTION_TITLE, SHEET_SUB, SHEET_TITLE,
  TARGETS_UNREADABLE, accountChoices, amountCents, amountError, datesLine, dollars, doorState, fillConsent, revokedLine,
  shareBody, stateWords, statementPreview, todayUtc, unreadableLine, viewsWords,
} from './proofOfFundsModel';

// D752 (#1891) — the investor's "Show Axal you can fund this".
//
//   useProofTargets      the page's one `GET /targets` read, when enabled (an HQ investor)
//   ProofDoor            one target's door: the button, its shared or expired chip, or why not
//   ProofOfFundsSheet    the share: accounts by name and last four, the amount held to its
//                        cap, the admin's exact sentence, the Worker's consent words
//   SharedProofOfFunds   "Proof of funds you've shared": states, dates, views, Revoke
//
// No canvas covers it yet (needs-design): it is built from the parts on main.
// It never draws a balance, and no route returns one. The account id lives in
// state only, and goes back in `account_ids`; it never reaches the text, a
// test id, storage, a URL or a log. Every refusal prints the Worker's sentence.

const MARK = <BrandIcon provider="mercury" name="Mercury" size={24} />;

/** The page's one targets read; no call when not enabled. */
export function useProofTargets({ enabled, api = mercuryAttestationsApi }) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', read: null });
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    setState((s) => ({ ...s, status: s.read ? 'ready' : 'loading' }));
    try {
      const read = await api.targets();
      if (alive.current) setState({ status: 'ready', read });
      return read;
    } catch (e) {
      reportError('proof-of-funds:targets', e);
      if (alive.current) setState({ status: 'unreadable', read: null });
      return null;
    }
  }, [enabled, api]);
  useEffect(() => {
    alive.current = true;
    if (enabled) reload();
    return () => { alive.current = false; };
  }, [enabled, reload]);
  return { ...state, reload };
}

/** One target's door (decision 2). Nothing for a null target. */
export function ProofDoor({ target, onShare }) {
  const door = doorState(target);
  if (!door) return null;
  if (door.state === 'not_attestable') {
    return (
      <div className="mt-1.5 text-[12px]" data-testid="proof-door">
        {door.kind === 'unreadable'
          ? <Unreadable what="The amount" claim={door.text} />
          : <Unrecorded>{`Not recorded: ${door.text}`}</Unrecorded>}
      </div>
    );
  }
  if (door.state === 'share') {
    return (
      <div className="mt-1.5" data-testid="proof-door">
        <button type="button" className={actionGhost} onClick={() => onShare?.(target)} data-testid="proof-share">{door.action}</button>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid="proof-door">
      {MARK}
      <span>{door.text}</span>
      {door.state === 'shared'
        ? <Link className="font-semibold underline" to={door.href} data-testid="proof-manage">{door.action}</Link>
        : <button type="button" className="font-semibold underline" onClick={() => onShare?.(target)} data-testid="proof-share">{door.action}</button>}
    </div>
  );
}

const refusalCode = (e) => (typeof e?.code === 'string' ? e.code : null);

/** The share sheet (decisions 3 to 8). */
export function ProofOfFundsSheet({ target, consent, minimumCents, onClose, onShared, onTargetsChanged, api = mercuryAttestationsApi, personal = mercuryPersonalApi }) {
  const [conn, setConn] = useState({ status: 'loading' }); // loading | unreadable | none | ok
  const [accounts, setAccounts] = useState({ status: 'idle', holder: null, choices: [] }); // idle | loading | ok | failed
  const [picked, setPicked] = useState(() => new Set());
  const [amount, setAmount] = useState(() => (target?.max_cents != null ? String(target.max_cents / 100) : ''));
  const [agreed, setAgreed] = useState(false);
  const [words, setWords] = useState(consent);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [shared, setShared] = useState(null);
  const today = todayUtc();

  const readAccounts = useCallback(async () => {
    setAccounts((a) => ({ ...a, status: 'loading' }));
    try {
      const read = await api.accounts();
      setAccounts({ status: 'ok', holder: typeof read?.holder_name === 'string' && read.holder_name.trim() ? read.holder_name : null, choices: accountChoices(read) });
    } catch (e) {
      reportError('proof-of-funds:accounts', e);
      setAccounts({ status: 'failed', holder: null, choices: [] });
      setRefusal(e);
    }
  }, [api]);

  const readStatus = useCallback(async () => {
    setConn({ status: 'loading' });
    try {
      const s = await personal.status();
      if (s?.connected) { setConn({ status: 'ok' }); await readAccounts(); } else setConn({ status: 'none' });
    } catch (e) {
      reportError('proof-of-funds:status', e);
      setConn({ status: 'unreadable' });
    }
  }, [personal, readAccounts]);

  useEffect(() => { readStatus(); /* once per opening */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountProblem = amountError(amount, target, minimumCents);
  const cents = amountProblem ? null : amountCents(amount);
  const holder = accounts.holder;
  const canShare = !busy && !shared && agreed && picked.size > 0 && !amountProblem && !!holder;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const share = async () => {
    if (!canShare) return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await api.share(shareBody({ target, amount_cents: cents, account_ids: [...picked], consent_version: words?.version }));
      setShared(res);
      onShared?.(res);
    } catch (e) {
      reportError('proof-of-funds:share', e);
      setRefusal(e);
      const code = refusalCode(e);
      if (code === 'consent_outdated') {
        setAgreed(false);
        const read = await onTargetsChanged?.();
        if (read?.consent) setWords(read.consent);
      } else if (CLOSE_CODES.includes(code)) {
        await onTargetsChanged?.();
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const code = refusalCode(refusal);
  const capLine = target?.max_cents != null && CAP_WORDS[target.purpose] ? CAP_WORDS[target.purpose](dollars(target.max_cents)) : null;
  const preview = cents != null && holder && picked.size
    ? statementPreview({ amount_cents: cents, as_of: today, holder_name: holder, accounts_counted: picked.size, consented_on: today })
    : null;
  const title = <span className="inline-flex items-center gap-2">{MARK}<span>{SHEET_TITLE}</span></span>;

  return (
    <Lightbox label={SHEET_TITLE} eyebrow={target?.label} title={title} sub={SHEET_SUB} onClose={onClose} testId="proof-sheet"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose}>{shared ? 'Done' : 'Cancel'}</button>
          {!shared && <button type="button" className={actionPrimary} disabled={!canShare} onClick={share} data-testid="proof-share-submit">Share</button>}
        </div>
      )}>
      {target?.active && !shared && <Banner tone="neutral" data-testid="proof-replaces">{REPLACES_ACTIVE(target.active.as_of)}</Banner>}
      {refusal && (
        <Banner tone="danger" data-testid="proof-refusal">
          <span>{refusal.message}</span>
          {CONNECTOR_DOOR_CODES.includes(code) && <> <Link className="font-semibold underline" to={CONNECTORS_LINK.href}>{CONNECTORS_LINK.text}</Link></>}
        </Banner>
      )}
      {conn.status === 'loading' && <p className="mx-5 mt-4 text-[12.5px] text-axal-muted dark:text-gray-400">Reading your connection…</p>}
      {conn.status === 'unreadable' && <div className="mx-5 mt-4"><Unreadable what="Your Mercury connection" claim="This is not a claim that it is not connected." onRetry={readStatus} /></div>}
      {conn.status === 'none' && (
        <Banner tone="neutral" data-testid="proof-connect-first">
          <span>{CONNECT_FIRST}</span> <Link className="font-semibold underline" to={CONNECTORS_LINK.href} data-testid="proof-connectors">{CONNECTORS_LINK.text}</Link>
        </Banner>
      )}
      {shared && (
        <Group label="Shared with Axal's admins">
          <Row a="What Axal's admins read" b={<span data-testid="proof-shared-statement">{shared.attestation?.statement}</span>} />
          {Number(shared.accounts_unreadable) > 0 && (
            <Row a="Accounts counted" b={unreadableLine(shared.accounts_unreadable, shared.attestation?.accounts_counted)} />
          )}
        </Group>
      )}
      {conn.status === 'ok' && !shared && (
        <>
          {accounts.status === 'loading' && <p className="mx-5 mt-4 text-[12.5px] text-axal-muted dark:text-gray-400">Reading your accounts…</p>}
          {accounts.status === 'failed' && <div className="mx-5 mt-4"><button type="button" className={actionGhost} onClick={readAccounts}>Retry</button></div>}
          {accounts.status === 'ok' && (
            <>
              <Group label="Accounts that count">
                {accounts.choices.map((a, i) => (
                  <label key={i} className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`proof-account-${i}`}>
                    <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="min-w-0 break-words">{a.line}</span>
                  </label>
                ))}
                {accounts.choices.length === 0 && <Row a={<Unrecorded>Not recorded: Mercury listed no checking or savings account.</Unrecorded>} />}
              </Group>
              <p className="mx-5 mt-1 text-[12px] text-axal-muted dark:text-gray-400">{ONLY_CHECKING_SAVINGS}</p>
              {!holder && <Banner tone="warn" data-testid="proof-holder-missing">{HOLDER_MISSING}</Banner>}
              <Group label="Amount">
                <div className="px-3 py-2">
                  <label className="block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
                    Whole dollars
                    <input className="mt-1 block w-full rounded-axal-sm border border-axal-hairline bg-white px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                      inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="proof-amount" />
                  </label>
                  {capLine && <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">{capLine}</p>}
                  {amountProblem && <p className="mt-1 text-[12px] text-red-700 dark:text-red-300" data-testid="proof-amount-error">{amountProblem}</p>}
                </div>
              </Group>
              {preview && (
                <Group label="What Axal's admins will read">
                  <p className="px-3 py-2 text-[13px] text-axal-ink dark:text-gray-100 break-words" data-testid="proof-preview">{preview}</p>
                </Group>
              )}
              <label className="mx-5 mt-4 flex items-start gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="proof-consent" />
                <span className="min-w-0 break-words">{fillConsent(words?.template, { accounts: picked.size, amount_cents: cents ?? 0, as_of: today, holder_name: holder })}</span>
              </label>
            </>
          )}
        </>
      )}
    </Lightbox>
  );
}

/** "Proof of funds you've shared" (decisions 9 and 10). */
export function SharedProofOfFunds({ targetsState, api = mercuryAttestationsApi, onChanged }) {
  const [list, setList] = useState({ status: 'loading', items: [] });
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await api.list();
      setList({ status: 'ok', items: Array.isArray(r?.attestations) ? r.attestations : [] });
    } catch (e) {
      reportError('proof-of-funds:list', e);
      setList({ status: 'unreadable', items: [] });
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const revoke = async (uid) => {
    setBusy(true);
    setRefusal(null);
    try {
      await api.revoke(uid);
    } catch (e) {
      reportError('proof-of-funds:revoke', e);
      setRefusal(e);
    } finally {
      setBusy(false);
      setConfirming(null);
      await load();
      await onChanged?.();
    }
  };

  const unreadable = targetsState?.status === 'unreadable' ? null : (targetsState?.read?.unreadable || []);
  return (
    <section id="proof-of-funds" className="scroll-mt-20" data-testid="section-proof-of-funds">
      <h2 className="mx-5 mt-4 flex items-center gap-2 text-[15px] font-bold text-axal-ink dark:text-gray-100">{MARK}<span>{SECTION_TITLE}</span></h2>
      <p className="mx-5 mt-1 text-[12px] text-axal-muted dark:text-gray-400">{SECTION_LINE}</p>
      {targetsState?.status === 'unreadable' && <div className="mx-5 mt-2"><Unreadable what="Your commitments" claim={TARGETS_UNREADABLE} onRetry={targetsState.reload} /></div>}
      {(unreadable || []).map((p) => <div key={p} className="mx-5 mt-2"><Unreadable what="A commitment" claim={PURPOSE_UNREADABLE[p] || TARGETS_UNREADABLE} /></div>)}
      {refusal && <Banner tone="danger" data-testid="proof-revoke-refusal">{refusal.message}</Banner>}
      {list.status === 'loading' && <p className="mx-5 mt-3 text-[12.5px] text-axal-muted dark:text-gray-400">Reading what you shared…</p>}
      {list.status === 'unreadable' && <div className="mx-5 mt-3"><Unreadable what="Your statements" claim={LIST_UNREADABLE} onRetry={load} /></div>}
      {list.status === 'ok' && list.items.length === 0 && <p className="mx-5 mt-3 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="proof-empty">{EMPTY_LIST}</p>}
      {list.status === 'ok' && list.items.length > 0 && (
        <Group label="Statements">
          {list.items.map((d, i) => {
            const s = stateWords(d);
            const views = viewsWords(d);
            return (
              <div key={d.uid || i} className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px]" data-testid={`proof-row-${i}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 font-semibold text-axal-ink dark:text-gray-100 break-words">{d.target_label}</span>
                  {s ? <Pill tone={s.tone}>{s.word}</Pill> : <Unrecorded>Not recorded</Unrecorded>}
                </div>
                {d.state !== 'revoked' && <div className="text-axal-muted dark:text-gray-400">{datesLine(d)}</div>}
                <div className="text-axal-ink dark:text-gray-200 break-words">{d.statement}</div>
                <div className="text-axal-muted dark:text-gray-400">{views ?? <Unrecorded>Views not recorded</Unrecorded>}</div>
                {d.state === 'revoked'
                  ? <div className="text-axal-muted dark:text-gray-400">{revokedLine(d)}</div>
                  : confirming === d.uid
                    ? (
                      <div className="flex flex-col gap-2" data-testid={`proof-revoke-confirm-${i}`}>
                        <span className="text-axal-ink dark:text-gray-200">{REVOKE_CONFIRM}</span>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={actionGhost} disabled={busy} onClick={() => setConfirming(null)} data-testid={`proof-keep-${i}`}>Keep it</button>
                          <button type="button" className={actionDanger} disabled={busy} onClick={() => revoke(d.uid)} data-testid={`proof-revoke-${i}`}>Revoke</button>
                        </div>
                      </div>
                    )
                    : <div><button type="button" className={actionGhost} onClick={() => setConfirming(d.uid)} data-testid={`proof-revoke-ask-${i}`}>Revoke</button></div>}
              </div>
            );
          })}
        </Group>
      )}
    </section>
  );
}
