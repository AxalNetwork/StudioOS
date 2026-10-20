import { useState } from 'react';
import { api } from '../../lib/api';
import { tokenPacksApi } from '../../lib/api/tokenPacks';
import { reportError } from '../../lib/log';
import { Card, Pill, Unrecorded, Unreadable } from '../../ui';
import { whenLabel } from '../account/usageModel';
import { MemberSpend } from './HqAiCards';
import {
  ADJUST_BOUNDS, ADJUST_NOTICE, BONUS_NOTE, PACK_LIMITS, REASON_MIN, RESEND,
  allowanceView, balanceView, bonusPercentOf, bonusUsd, exactEmailMatch, faceCentsOf, ledgerView, memberQuery,
  newKey, newPackConfirm, packLabelPreview, packLines, parseAdjustment, parseBonusPercent, parsePackAmount,
  parsePriceId, purchasesView, reasonOk, reconcileView, shortfallsView,
} from './tokenPacksModel';

/**
 * D755 §4 and §14 (#1986, CR8) — HQ › AI allowances' token packs, one member's
 * AI account and the reconcile list, drawn from the cards and rows the page
 * already uses (D642, D750). The rules are `tokenPacksModel.js`; the Worker's
 * routes are `lib/api/tokenPacks.js` (#1919). Super Admin only, as the page is.
 *
 * HQ NEVER CREDITS A PURCHASE. A purchase is credited by Stripe's
 * `payment_intent.succeeded` webhook alone; the reconcile list says how to
 * resend it and draws no credit control. An adjustment is the only balance
 * write here, within D755 §16's bounds, with a reason the member never sees.
 */

const ROSE = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm bg-rose-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SMALL = 'text-[12px] font-semibold text-axal-muted hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400';
const FIELD = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 font-mono text-[13px] text-axal-ink focus:outline-none focus:ring-2 focus:ring-rose-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400';
const NOTE = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const WARN = 'rounded-axal-sm border border-amber-300 bg-amber-50/60 px-2.5 py-2 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200';
const HEADER = 'border-b border-axal-hairline px-4 py-3 text-sm font-bold dark:border-gray-800';
const ROW = 'border-b border-axal-ground px-4 py-2.5 text-[12.5px] last:border-0 dark:border-gray-800';
const TONE = { success: 'ok', warning: 'warn' };

function Refusal({ text, testId }) {
  return text ? <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}
const sentence = (e, fallback) => (typeof e?.message === 'string' && e.message ? e.message : fallback);

// ---------- New pack and Adopt --------------------------------------------

/** New pack: whole dollars from $5 to $500, a label preview, a confirm, and one idempotency key for this form. */
export function NewPackForm({ mode, api: packs = tokenPacksApi, onDone, onCancel }) {
  const [key] = useState(newKey);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const usd = parsePackAmount(amount);
  const create = async () => {
    if (usd == null || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await packs.create(usd, key);
      onDone(`${r?.pack?.label || packLabelPreview(usd)} was created, off sale. Put it on sale when it should be offered.`);
    } catch (e) {
      reportError('hq-allowances:pack-create', e);
      setError(sentence(e, 'The token pack was not created. Pressing Create again is safe.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3" data-testid="hq-pack-new">
      <label className={LABEL}>
        New pack · whole dollars, ${PACK_LIMITS.minUsd} to ${PACK_LIMITS.maxUsd}
        <input className={FIELD} inputMode="numeric" value={amount} disabled={confirming}
          onChange={(e) => { setAmount(e.target.value); setError(null); }} data-testid="hq-pack-new-amount" aria-invalid={amount && usd == null ? 'true' : undefined} />
      </label>
      {amount && usd == null && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="hq-pack-new-invalid">A pack is whole dollars from ${PACK_LIMITS.minUsd} to ${PACK_LIMITS.maxUsd}.</p>}
      {usd != null && <p className={NOTE} data-testid="hq-pack-new-preview">Members see it as “{packLabelPreview(usd)}”.</p>}
      {confirming && <p className={WARN} data-testid="hq-pack-new-confirm">{newPackConfirm(mode)}</p>}
      <Refusal text={error} testId="hq-pack-new-error" />
      <div className="flex justify-end gap-1.5">
        <button type="button" className={GHOST} onClick={confirming ? () => setConfirming(false) : onCancel}>{confirming ? 'Back' : 'Cancel'}</button>
        {confirming
          ? <button type="button" className={ROSE} disabled={busy || usd == null} onClick={create} data-testid="hq-pack-new-create">{busy ? 'Creating…' : 'Create in Stripe'}</button>
          : <button type="button" className={ROSE} disabled={usd == null} onClick={() => setConfirming(true)} data-testid="hq-pack-new-next">Continue</button>}
      </div>
    </div>
  );
}

/** Adopt an existing one-time USD price by its ID; the Worker judges it as D750 does. */
export function AdoptForm({ api: packs = tokenPacksApi, suffix, onDone, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const id = parsePriceId(text);
  const adopt = async () => {
    if (!id || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await packs.adopt(id);
      onDone(r?.already ? `${r?.pack?.label || 'That price'} is already a pack.` : `${r?.pack?.label || 'The price'} was adopted, off sale.`);
    } catch (e) {
      reportError('hq-allowances:pack-adopt', e);
      setError(sentence(e, 'The price was not adopted. Nothing changed.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3" data-testid="hq-pack-adopt">
      <label className={LABEL}>
        Adopt a price · its Stripe price ID{suffix ? `, ending …${suffix}` : ''}
        <input className={FIELD} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder="price_…" data-testid="hq-pack-adopt-id" />
      </label>
      <Refusal text={error} testId="hq-pack-adopt-error" />
      <div className="flex justify-end gap-1.5">
        <button type="button" className={GHOST} onClick={onCancel}>Cancel</button>
        <button type="button" className={ROSE} disabled={busy || !id} onClick={adopt} data-testid="hq-pack-adopt-submit">{busy ? 'Adopting…' : 'Adopt'}</button>
      </div>
    </div>
  );
}

// ---------- One pack's controls --------------------------------------------

/** On sale, Bonus (0–10%) and Archive (asked first) for one pack row. The fallback has none: it is adopted first. */
export function PackControls({ pack, line, api: packs = tokenPacksApi, onDone }) {
  const face = faceCentsOf(pack.label);
  const [mode, setMode] = useState(null);
  const [bonus, setBonus] = useState(() => String(bonusPercentOf(face, pack.bonus_microusd)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pct = parseBonusPercent(bonus);
  const run = async (scope, call, done) => {
    setBusy(true); setError(null);
    try { await call(); setMode(null); onDone(done); } catch (e) { reportError(`hq-allowances:${scope}`, e); setError(sentence(e, 'The pack was not changed.')); } finally { setBusy(false); }
  };
  const label = pack.label;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-testid={`hq-pack-controls-${line.uid}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" role="switch" aria-checked={pack.on_sale === true} className={SMALL} disabled={busy}
          onClick={() => run('pack-sale', () => packs.update(line.uid, { on_sale: pack.on_sale !== true }), `${label} is ${pack.on_sale === true ? 'off' : 'on'} sale.`)}
          data-testid={`hq-pack-sale-${line.uid}`}>{pack.on_sale === true ? 'On sale · take off sale' : 'Off sale · put on sale'}</button>
        <button type="button" className={SMALL} disabled={busy || face == null} onClick={() => setMode('bonus')} data-testid={`hq-pack-bonus-open-${line.uid}`}>Bonus…</button>
        <button type="button" className={SMALL} disabled={busy} onClick={() => setMode('archive')} data-testid={`hq-pack-archive-open-${line.uid}`}>Archive…</button>
      </div>
      {mode === 'bonus' && face != null && (
        <div className="flex flex-col gap-1.5" data-testid={`hq-pack-bonus-${line.uid}`}>
          <label className={LABEL}>
            Bonus · 0 to {PACK_LIMITS.maxBonusPercent}% of {label}
            <input className={FIELD} inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} data-testid={`hq-pack-bonus-input-${line.uid}`} aria-invalid={pct == null ? 'true' : undefined} />
          </label>
          {pct == null && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`hq-pack-bonus-invalid-${line.uid}`}>A bonus is 0 to {PACK_LIMITS.maxBonusPercent}% of the pack's face value.</p>}
          <p className={WARN}>{BONUS_NOTE}</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" className={GHOST} onClick={() => setMode(null)}>Cancel</button>
            <button type="button" className={ROSE} disabled={busy || pct == null}
              onClick={() => run('pack-bonus', () => packs.update(line.uid, { bonus_usd: bonusUsd(face, pct) }), `${label}'s bonus is ${pct}%.`)}
              data-testid={`hq-pack-bonus-save-${line.uid}`}>Save the bonus</button>
          </div>
        </div>
      )}
      {mode === 'archive' && (
        <div className="flex flex-col gap-1.5" data-testid={`hq-pack-archive-${line.uid}`}>
          <p className={WARN} data-testid={`hq-pack-archive-confirm-${line.uid}`}>Archive {label}? It goes off sale for good and its Stripe price is archived. A pack bought before stays credited.</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" className={GHOST} onClick={() => setMode(null)}>Keep it</button>
            <button type="button" className={ROSE} disabled={busy} onClick={() => run('pack-archive', () => packs.archive(line.uid), `${label} is archived.`)} data-testid={`hq-pack-archive-submit-${line.uid}`}>Archive</button>
          </div>
        </div>
      )}
      <Refusal text={error} testId={`hq-pack-error-${line.uid}`} />
    </div>
  );
}

// ---------- The Token packs card -----------------------------------------

/** One line per pack (§14), the pack controls, New pack and Adopt. It replaces D750's single top-up line. */
export function TokenPacksCard({ status, api: packs = tokenPacksApi, onChanged }) {
  const [form, setForm] = useState(null);
  const view = status.status === 'ready' ? packLines(status.data) : null;
  const raw = view ? status.data.packs : [];
  const done = (msg) => { setForm(null); onChanged?.(msg); };
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-token-packs">
      <div className={HEADER}>Token packs</div>
      {status.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the token packs…</p>
        : !view ? <div className="px-4 py-3"><Unreadable what="The token packs" claim="No pack has changed." onRetry={status.reload} /></div>
          : (
            <>
              {view.lines.map((line, i) => (
                <div key={line.uid || `fallback-${i}`} className={ROW} data-testid="hq-pack-row">
                  <p data-testid="hq-pack-line" data-tone={line.tone} className="flex items-start gap-2">
                    <Pill tone={TONE[line.tone]}>{line.tone === 'success' ? 'On sale' : 'Not offered'}</Pill>
                    <span>{line.text}</span>
                  </p>
                  {line.fallback
                    ? line.adoptable && <button type="button" className={`${SMALL} mt-1.5`} onClick={() => setForm({ kind: 'adopt', suffix: line.suffix })} data-testid="hq-pack-fallback-adopt">Adopt…</button>
                    : line.uid && <PackControls pack={raw[i]} line={line} api={packs} onDone={done} />}
                </div>
              ))}
              {view.empty && <p className={`${ROW} text-axal-muted`} data-testid="hq-packs-none">{view.empty}</p>}
              {form?.kind === 'new' && <NewPackForm mode={view.mode} api={packs} onDone={done} onCancel={() => setForm(null)} />}
              {form?.kind === 'adopt' && <AdoptForm api={packs} suffix={form.suffix} onDone={done} onCancel={() => setForm(null)} />}
              {!form && (
                <div className="flex gap-1.5 border-t border-axal-hairline px-4 py-2.5 dark:border-gray-800">
                  <button type="button" className={GHOST} onClick={() => setForm({ kind: 'new' })} data-testid="hq-pack-new-open">New pack…</button>
                  <button type="button" className={GHOST} onClick={() => setForm({ kind: 'adopt', suffix: null })} data-testid="hq-pack-adopt-open">Adopt a price…</button>
                </div>
              )}
            </>
          )}
    </Card>
  );
}

// ---------- One member's AI account --------------------------------------

/** Adjust balance: plus or minus within §16's bounds, a reason of at least 10 characters, one write per key. */
export function AdjustForm({ memberId, api: packs = tokenPacksApi, onDone }) {
  const [key, setKey] = useState(newKey);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const usd = parseAdjustment(amount);
  const ok = usd != null && reasonOk(reason);
  const submit = async (e) => {
    e?.preventDefault?.();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await packs.adjust(memberId, usd, reason.trim(), key);
      setAmount(''); setReason(''); setKey(newKey());
      onDone(r?.already_recorded ? 'That adjustment was already recorded.' : `${usd > 0 ? 'Added' : 'Took off'} $${Math.abs(usd).toFixed(2)}.`);
    } catch (err) {
      reportError('hq-allowances:adjust', err);
      setError(sentence(err, 'The adjustment was not recorded. Nothing changed.'));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-4 py-3" data-testid="hq-member-adjust">
      <label className={LABEL}>
        Adjust balance · US$, plus or minus
        <input className={FIELD} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+10 or -5" data-testid="hq-member-adjust-amount" aria-invalid={amount && usd == null ? 'true' : undefined} />
      </label>
      {amount && usd == null && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="hq-member-adjust-invalid">{ADJUST_BOUNDS}</p>}
      <label className={LABEL}>
        Reason · at least {REASON_MIN} characters
        <input className={`${FIELD} font-sans`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="hq-member-adjust-reason" />
      </label>
      <p className={NOTE}>{ADJUST_BOUNDS} {ADJUST_NOTICE}</p>
      <Refusal text={error} testId="hq-member-adjust-error" />
      <div className="flex justify-end">
        <button type="submit" className={ROSE} disabled={busy || !ok} data-testid="hq-member-adjust-submit">{busy ? 'Recording…' : 'Record the adjustment'}</button>
      </div>
    </form>
  );
}

function Section({ title, testId, children }) {
  return (
    <div className="border-t border-axal-hairline dark:border-gray-800" data-testid={testId}>
      <div className="px-4 pt-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400">{title}</div>
      <div className="pb-2">{children}</div>
    </div>
  );
}
const when = (at) => (at ? whenLabel(at) ?? at : null);
const blank = (what) => <div className="px-4 py-2"><Unreadable what={what} claim="The rest of this account is as shown." /></div>;

/** The member's account as read: each section from its own part, Unreadable on its own. */
export function MemberAccount({ account, memberId, api: packs = tokenPacksApi, onAdjusted }) {
  const [older, setOlder] = useState({ rows: [], next: undefined, failed: false, busy: false });
  const allowance = allowanceView(account);
  const balance = balanceView(account);
  const ledger = ledgerView(account?.ledger);
  const purchases = purchasesView(account?.purchases);
  const shortfalls = shortfallsView(account?.shortfalls);
  const next = older.next === undefined ? ledger?.next : older.next;
  const more = async () => {
    setOlder((o) => ({ ...o, busy: true }));
    try {
      const page = ledgerView((await packs.member(memberId, { before: next }))?.ledger);
      if (!page) throw new Error('ledger unreadable');
      setOlder((o) => ({ rows: [...o.rows, ...page.rows], next: page.next, failed: false, busy: false }));
    } catch (e) {
      reportError('hq-allowances:member-ledger', e);
      setOlder((o) => ({ ...o, failed: true, busy: false }));
    }
  };
  return (
    <div data-testid="hq-member-account">
      <Section title="Allowance" testId="hq-member-allowance">
        {allowance ? (
          <p className={`${ROW} font-mono`}>{allowance.daily} a day · {allowance.monthly} a month · {allowance.source}{allowance.licence ? ` · ${allowance.licence}` : ''}</p>
        ) : blank('The allowance')}
      </Section>
      <Section title="Balance" testId="hq-member-balance">
        {balance ? (
          <div className={ROW}>
            <p className="font-mono">Balance {balance.balance} · held {balance.held} · ledger {balance.ledger}</p>
            {balance.differs && <p className="mt-1 text-red-700 dark:text-red-300" data-testid="hq-member-balance-differs">The balance differs from the ledger. It is listed under Reconcile.</p>}
            {balance.onHold === true && <p className="mt-1 text-amber-800 dark:text-amber-300" data-testid="hq-member-on-hold">Token packs are on hold for this member: an open dispute, or a shortfall in the last 90 days.</p>}
          </div>
        ) : blank('The balance')}
      </Section>
      {balance && <AdjustForm key={memberId} memberId={memberId} api={packs} onDone={onAdjusted} />}
      <Section title="Ledger" testId="hq-member-ledger">
        {!ledger || older.failed ? blank('The ledger')
          : [...ledger.rows, ...older.rows].length === 0 ? <p className={`${ROW} text-axal-muted`}>No ledger row is recorded for this member.</p>
            : (
              <>
                {[...ledger.rows, ...older.rows].map((r) => (
                  <div key={r.uid} className={ROW} data-testid="hq-member-ledger-row">
                    <div className="flex flex-wrap justify-between gap-2 font-mono">
                      <span>{r.kind}{r.pack ? ` · ${r.pack}` : ''}</span><span>{r.amount}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-[11.5px] text-axal-muted dark:text-gray-400">
                      <span>{r.reason || (r.kind === 'Adjustment' ? <Unrecorded reason="No reason is recorded on this row.">No reason</Unrecorded> : '')}</span>
                      <span>{when(r.at)}</span>
                    </div>
                  </div>
                ))}
                {next && <div className="px-4 pt-2"><button type="button" className={SMALL} disabled={older.busy} onClick={more} data-testid="hq-member-ledger-more">{older.busy ? 'Reading…' : 'Older rows'}</button></div>}
              </>
            )}
      </Section>
      <Section title="Purchases" testId="hq-member-purchases">
        {!purchases ? blank('The purchases')
          : purchases.length === 0 ? <p className={`${ROW} text-axal-muted`}>No token pack has been bought.</p>
            : purchases.map((p) => (
              <div key={p.key} className={`${ROW} flex flex-wrap justify-between gap-2`} data-testid="hq-member-purchase">
                <span>{p.pack || 'Token pack'} · <Pill tone={p.state === 'credited' ? 'ok' : p.state === 'waiting' ? 'neutral' : 'warn'}>{p.label}</Pill></span>
                <span className="font-mono">{p.amount} · {when(p.at)}</span>
              </div>
            ))}
      </Section>
      <Section title="Shortfalls" testId="hq-member-shortfalls">
        {!shortfalls ? blank('The shortfalls')
          : shortfalls.length === 0 ? <p className={`${ROW} text-axal-muted`}>No shortfall is recorded.</p>
            : shortfalls.map((s) => (
              <div key={s.uid} className={`${ROW} flex justify-between gap-2 font-mono`} data-testid="hq-member-shortfall"><span>{s.kind}</span><span>{s.amount} · {when(s.at)}</span></div>
            ))}
      </Section>
    </div>
  );
}

/** Look a member up by email or ID, then read their whole AI account. */
export function MemberAccountCard({ api: packs = tokenPacksApi, users = api }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const q = memberQuery(text);
  const read = async (id) => {
    const account = await packs.member(id);
    setFound({ id, account });
  };
  const look = async (e) => {
    e?.preventDefault?.();
    if (!q || busy) return;
    setBusy(true); setError(null); setDone(null); setFound(null);
    try {
      let id = q.id ?? null;
      if (q.email) {
        id = exactEmailMatch(await users.adminListUsers({ q: q.email, limit: 20 }), q.email);
        if (id == null) { setError('No member has exactly that email.'); return; }
      }
      await read(id);
    } catch (err) {
      reportError('hq-allowances:member', err);
      setError(sentence(err, 'This member\'s AI account could not be read.'));
    } finally { setBusy(false); }
  };
  const adjusted = async (msg) => {
    setDone(msg);
    try { await read(found.id); } catch (err) { reportError('hq-allowances:member', err); setError(sentence(err, 'This member\'s AI account could not be read again.')); }
  };
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-member-card">
      <div className={HEADER}>One member's AI account</div>
      <form onSubmit={look} className="flex items-end gap-1.5 px-4 py-3" data-testid="hq-member-lookup">
        <label className={`${LABEL} flex-1`}>
          Member · email or ID
          <input className={`${FIELD} font-sans`} value={text} onChange={(e) => setText(e.target.value)} placeholder="name@example.test or 42" data-testid="hq-member-query" />
        </label>
        <button type="submit" className={GHOST} disabled={busy || !q} data-testid="hq-member-look">{busy ? 'Reading…' : 'Look up'}</button>
      </form>
      <div className="px-4"><Refusal text={error} testId="hq-member-error" /></div>
      {done && <p role="status" className="px-4 pb-2 text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="hq-member-done">{done}</p>}
      {found && <MemberAccount key={found.id} account={found.account} memberId={found.id} api={packs} onAdjusted={adjusted} />}
      {found && <MemberSpend key={`spend-${found.id}`} memberId={found.id} />}
    </Card>
  );
}

// ---------- Reconcile ------------------------------------------------------

/** What needs reconciling (§14). No credit button: a purchase is credited by Stripe's webhook alone. */
export function ReconcileCard({ reconcile }) {
  const v = reconcile.status === 'ready' ? reconcileView(reconcile.data) : null;
  const list = (rows, what, empty, draw) => (!rows ? blank(what) : rows.length === 0 ? <p className={`${ROW} text-axal-muted`}>{empty}</p> : rows.map(draw));
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-reconcile">
      <div className={HEADER}>Reconcile</div>
      {reconcile.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading what needs reconciling…</p>
        : reconcile.status !== 'ready' ? <div className="px-4 py-3"><Unreadable what="The reconcile list" claim="This is not a claim that nothing needs reconciling." onRetry={reconcile.reload} /></div>
          : (
            <>
              <Section title="Balance differs from the ledger" testId="hq-reconcile-mismatched">
                {list(v.mismatched, 'The balances', 'Every balance equals its ledger.', (m) => (
                  <p key={m.member} className={`${ROW} font-mono`} data-testid="hq-reconcile-mismatch">Member {m.member} · balance {m.balance} · ledger {m.ledger} · {m.difference}</p>
                ))}
              </Section>
              <Section title="Paid over an hour ago, not credited" testId="hq-reconcile-overdue">
                {list(v.overdue, 'The overdue purchases', 'No paid purchase is waiting to be credited.', (p) => (
                  <div key={p.key || `${p.member}-${p.at}`} className={ROW} data-testid="hq-reconcile-overdue-row">
                    <p className="font-mono">Member {p.member} · {p.pack || 'Token pack'} · {p.amount} · {when(p.at)}</p>
                    <p className="mt-0.5 text-amber-800 dark:text-amber-300">{p.instruction || RESEND}.</p>
                  </div>
                ))}
              </Section>
              <Section title="Open disputes" testId="hq-reconcile-disputes">
                {list(v.disputes, 'The open disputes', 'No dispute is open.', (p) => (
                  <p key={p.key || `${p.member}-${p.at}`} className={`${ROW} font-mono`} data-testid="hq-reconcile-dispute">Member {p.member} · {p.pack || 'Token pack'} · {p.amount} · {when(p.at)}</p>
                ))}
              </Section>
              <p className={`${NOTE} border-t border-axal-hairline px-4 py-2.5 dark:border-gray-800`}>HQ never credits a purchase. Stripe's payment_intent.succeeded credits it; resend that event when one is overdue.</p>
            </>
          )}
    </Card>
  );
}

