import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lightbox, Pill, Unrecorded } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { actRow, refusalText } from './fundAdminModel';
import { withQuery } from './lpsModel';
import { Line, NUM, Note, Panel, ReadFailure, Section, TH } from './parts';
import { PersonPicker } from './PersonPicker';
import { ActFlow } from './MoneyFlow';
import { economicsEffects } from './moneyFlowModel';
import { fundNav, identityLine, keyFigures } from './fundPageModel';
import { LABEL } from './FundTabs';
import { useRead } from './useRead';
import {
  ECONOMICS_NOTE, FUND_NAME_MAX, FUND_REASON_MAX, FUND_STATUSES, NO_CARRY, NO_FEE, NO_GP, PROVIDERS, PROVIDER_MAX, REGENERATE_INFO,
  WATERFALL, WATERFALL_LINE, checkEconomics, checkFacts, fact, factsForm, lpaCard, lpaRefusal, providersBody, rateInput,
  rateText,
} from './fundsModel';

/**
 * D1161 (#3068, part 4 of #2388) — one fund at `/admin/fund-admin/funds/:id`
 * (FND4): the summary tiles, Economics, Waterfall, the general partner of
 * record, service providers, the LPA and the ledger administrator.
 *
 * `GET /api/funds/:id` is the fund; the overview's row for it gives the call
 * figures. Every change opens in-page and the Worker decides: Economics'
 * Change (Super Admin; a reason, then the step-up the request helper asks
 * for) reads as its sentence to an Admin. Edit fund facts is the header's
 * primary (`?edit=facts`).
 *
 * D4812 part 3 (FA-04): the fund's identity first — its name, vintage,
 * status and GP by name, and six key figures — then local navigation, then
 * Economics and Roles. The GP of record and the ledger administrator are
 * named (`GET /api/fund-admin/funds/:id/people`) and changed through the
 * shared `PersonPicker`. Service providers and the GP's document fields fold
 * away beneath; the LPA is Documents, and Edit fund facts is Settings.
 */
const INFO = 'm-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100';
const MUTED = 'text-[12px] font-semibold text-axal-muted dark:text-gray-400';

function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback, words = refusalText) => {
    setBusy(true); setError('');
    try { await fn(); return true; } catch (e) { setError(words(e, fallback)); return false; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

function Err({ text, testId }) {
  return text ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={testId}>{text}</p> : null;
}

/** A labelled fact, Not recorded when empty. */
function Fact({ k, v, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-axal-hairline px-4 py-2.5 last:border-b-0 sm:px-5 dark:border-gray-800" data-testid={testId}>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{k}</span>
      <span className="min-w-0 break-words text-right text-[12px] font-semibold text-zinc-700 [overflow-wrap:anywhere] dark:text-gray-200">{v ?? <Unrecorded />}</span>
    </div>
  );
}

export function FundPage({ apis, access, overview, fundId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const read = useRead(() => apis.funds.get(fundId), [apis, fundId]);
  const perf = useRead(() => apis.performance.read(fundId), [apis, fundId], { enabled: Boolean(apis.performance?.read) });
  const gp = useRead(() => apis.fundAdmin.people(fundId, 'gp'), [apis, fundId], { enabled: Boolean(apis.fundAdmin?.people) });
  const ledgerAdmin = useRead(() => apis.fundAdmin.people(fundId, 'ledger'), [apis, fundId], { enabled: Boolean(apis.fundAdmin?.people) });
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const { busy: lpaBusy, error: lpaError, run: runLpa } = useAct();
  const editAsked = new URLSearchParams(location.search).get('edit') === 'facts';
  const open = dialog || (editAsked ? 'facts' : null);
  const close = () => { setDialog(null); if (editAsked) navigate(`${location.pathname}${withQuery(location.search, 'edit', undefined)}`, { replace: true }); };
  const done = async (text) => { close(); setNotice(text); await read.reload(); gp.reload(); ledgerAdmin.reload(); };

  const back = <Link className={BTN.link} to="/admin/fund-admin/funds" data-testid="fund-back">← Funds</Link>;
  if (read.status === 'loading' || read.status === 'idle') {
    return <Section title="Fund" aside={back} testId="fund-page"><Panel label="Fund"><div className="px-4 py-3 sm:px-5"><LoadingRows lines={4} /></div></Panel></Section>;
  }
  if (read.status === 'unreadable' || !read.data?.fund) {
    const missing = read.error?.status === 404;
    return (
      <Section title="Fund" aside={back} testId="fund-page">
        <Panel label="Fund" testId="fund-unreadable">
          <div className="px-4 py-3 sm:px-5">
            {missing ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">No fund is recorded at this address.</p>
              : <ReadFailure what="This fund" claim="Nothing on it is shown until it reads." onRetry={read.reload} />}
          </div>
        </Panel>
      </Section>
    );
  }

  const { fund, lpa } = read.data;
  const item = overview.status === 'ready' && overview.data?.funds?.state === 'ok'
    ? (overview.data.funds.items || []).find((f) => Number(f.fund_id) === Number(fund.id)) || null : null;
  const lpaState = lpaCard(fund, lpa);
  const economicsAllowed = actRow(access, 'fund.economics')?.allowed !== false;
  const download = () => runLpa(async () => { await apis.funds.downloadLpa(fund.id); }, 'The LPA could not be downloaded.', (e, fb) => lpaRefusal(e, refusalText(e, fb)));

  const holder = (r) => (r.status === 'ready' ? r.data?.current : null);
  const holderText = (r, none) => (r.status === 'unreadable' ? <span className="text-red-700 dark:text-red-300">Unreadable</span>
    : r.status !== 'ready' ? (r.status === 'idle' ? <Unrecorded>Not read here</Unrecorded> : 'Reading…')
      : r.data?.current ? <>{r.data.current.name} <span className="font-normal text-axal-muted dark:text-gray-400">· {r.data.current.kind}</span></> : <Unrecorded>{none}</Unrecorded>);

  return (
    <Section title={fund.name || `Fund #${fund.id}`} sub={identityLine(fund, gp)} aside={back} testId="fund-page">
      {notice && <p role="status" className="m-0 text-[12.5px] text-axal-positive dark:text-emerald-300" data-testid="fund-notice">{notice}</p>}
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-axal-hairline py-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-800" data-testid="fund-figures">
        {keyFigures(fund, item, perf).map((f) => (
          <div key={f.key} data-testid={`fund-figure-${f.key}`}>
            <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{f.label}</dt>
            <dd className={`m-0 mt-1 text-[22px] font-bold tracking-[-.02em] text-axal-ink dark:text-gray-100 ${NUM}`}>
              {f.value ?? (f.state === 'unreadable' ? <span className="text-[14px] text-red-700 dark:text-red-300">! Unreadable</span>
                : f.state === 'loading' ? <span className="inline-block h-5 w-16 rounded bg-gray-200 dark:bg-gray-700" aria-label="Reading" />
                  : <span className="text-[14px] font-normal"><Unrecorded reason={f.reason}>— Not recorded</Unrecorded></span>)}
            </dd>
            {f.note && <dd className="m-0 mt-0.5 font-mono text-[12px] text-axal-muted dark:text-gray-400">{f.note}</dd>}
          </div>
        ))}
      </dl>
      {item?.overdue_lines > 0 && <p className="m-0 text-[13px] text-amber-800 dark:text-amber-300" data-testid="fund-overdue">{`▲ ${item.overdue_lines} ${item.overdue_lines === 1 ? 'line' : 'lines'} overdue · `}<Link className="font-bold underline" to={`/admin/fund-admin/calls?fund=${fund.id}`}>Open lines</Link></p>}
      <nav aria-label="This fund" className="-mb-px flex gap-5 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="fund-nav">
        {fundNav(fund.id).map((n) => (
          <Link key={n.key} to={n.to} aria-current={n.key === 'overview' ? 'page' : undefined} data-testid={`fund-nav-${n.key}`}
            className={`inline-flex min-h-[44px] shrink-0 items-center border-b-2 px-0.5 text-[13px] sm:min-h-[40px] ${n.key === 'overview' ? 'border-axal-violet font-bold text-axal-ink dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>{n.label}</Link>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel label="Economics" testId="fund-economics"
          aside={<FundActControl access={access} act="fund.economics" testId="fund-economics-refused" className={MUTED}>
            <button type="button" className={BTN.ghost} onClick={() => setDialog('economics')} data-testid="fund-economics-change">Change…</button>
          </FundActControl>}>
          {economicsAllowed && access && <Note>{ECONOMICS_NOTE}</Note>}
          <Line a="Carry" figure={<span className="text-[15px]" data-testid="fund-carry">{rateText(fund.carried_interest) ?? <Unrecorded reason={NO_CARRY} />}</span>} />
          <Line a="Management fee" figure={<span className="text-[15px]" data-testid="fund-fee">{rateText(fund.management_fee) ?? <Unrecorded reason={NO_FEE} />}</span>} />
          <Line a={WATERFALL} b={WATERFALL_LINE} testId="fund-waterfall" />
        </Panel>
        <Panel label="Roles" testId="fund-roles">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-axal-hairline px-4 py-3 sm:px-5 dark:border-gray-800" data-testid="fund-gp">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-axal-muted dark:text-gray-400">GP of record</div>
              <div className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="fund-gp-name">{holderText(gp, NO_GP)}</div>
            </div>
            <FundActControl access={access} act="fund.gp_of_record" testId="fund-gp-refused" className={MUTED}>
              <button type="button" className={BTN.ghost} onClick={() => setDialog('pick-gp')} data-testid="fund-gp-change">Change…</button>
            </FundActControl>
          </div>
          {fund.gp_user_id == null && <Note testId="fund-gp-none">{`${NO_GP}. No LPA is drafted until one is named.`}</Note>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5" data-testid="fund-ledger-admin">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-axal-muted dark:text-gray-400">Ledger administrator</div>
              <div className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="fund-ledger-admin-name">{holderText(ledgerAdmin, 'No ledger administrator is assigned. Admins keep the books.')}</div>
            </div>
            <FundActControl access={access} act="fund_ledger.administrator" testId="fund-ledger-admin-refused" className={MUTED}>
              <button type="button" className={BTN.ghost} onClick={() => setDialog('pick-ledger')} data-testid="fund-ledger-admin-change">Change…</button>
            </FundActControl>
          </div>
        </Panel>
      </div>
      <div id="fund-documents">
        <Panel label="Documents · LPA" testId="fund-lpa"
          aside={<div className="flex flex-wrap gap-2">
            {lpaState.state === 'on_file' && <button type="button" className={BTN.ghost} onClick={download} disabled={lpaBusy} data-testid="fund-lpa-view">View LPA</button>}
            <FundActControl access={access} act="fund.write" testId="fund-lpa-regenerate-refused" className={MUTED}>
              <button type="button" className={BTN.ghost} onClick={() => setDialog('regenerate')} data-testid="fund-lpa-regenerate">Regenerate LPA</button>
            </FundActControl>
          </div>}>
          <Line a={lpaState.title} b={lpaState.updated ? `${lpaState.line} · updated ${String(lpaState.updated).slice(0, 10)}` : lpaState.line}
            chip={lpaState.state === 'on_file' ? <Pill tone="ok">On file</Pill> : <Pill tone="warn">Pending</Pill>} testId="fund-lpa-state" />
          {lpaError && <div className="px-4 pb-3 sm:px-5"><Err text={lpaError} testId="fund-lpa-error" /></div>}
          <Note>Regenerate asks first: {REGENERATE_INFO.charAt(0).toLowerCase() + REGENERATE_INFO.slice(1)}</Note>
        </Panel>
      </div>
      <details id="fund-settings" className="rounded-axal-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="fund-reference">
        <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <span>
            <span className={TH}>Service providers and GP documents</span>
            <span className="mt-0.5 block text-[12px] text-axal-muted dark:text-gray-400">Auditor, administrator, counsel, custodian · the GP’s name, title and entity on documents</span>
          </span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="grid gap-4 border-t border-axal-hairline p-4 lg:grid-cols-2 dark:border-gray-800">
          <Panel label="Service providers" testId="fund-providers"
            aside={<FundActControl access={access} act="fund.write" testId="fund-providers-refused" className={MUTED}>
              <button type="button" className={BTN.ghost} onClick={() => setDialog('providers')} data-testid="fund-providers-edit">Edit</button>
            </FundActControl>}>
            {PROVIDERS.map(([k, l]) => <Fact key={k} k={l} v={fact(fund[k])} testId={`fund-provider-${k}`} />)}
          </Panel>
          <Panel label="GP on documents" testId="fund-gp-documents">
            <Fact k="Name on documents" v={fact(fund.gp_name)} />
            <Fact k="Title" v={fact(fund.gp_title)} />
            <Fact k="Entity" v={fact(fund.gp_entity)} />
            <Fact k="Email on documents" v={fact(fund.gp_email)} />
          </Panel>
        </div>
      </details>
      {open === 'pick-gp' && <PersonPicker apis={apis} access={access} fund={fund} role="gp" current={holder(gp)} onClose={close} onDone={done} />}
      {open === 'pick-ledger' && <PersonPicker apis={apis} access={access} fund={fund} role="ledger" current={holder(ledgerAdmin)} onClose={close} onDone={done} />}
      {open === 'economics' && <EconomicsDialog apis={apis} access={access} fund={fund} onClose={close}
        onDone={async () => { setNotice('The fund’s economics changed. The reason is kept on the audit record.'); await read.reload(); }} />}
      {open === 'providers' && <ProvidersDialog apis={apis} fund={fund} onClose={close} onDone={() => done('The service providers were saved.')} />}
      {open === 'regenerate' && <RegenerateDialog apis={apis} fund={fund} onClose={close} onDone={() => done('A new LPA draft was asked for. It replaces the current draft when it is ready.')} />}
      {open === 'facts' && <FactsDialog apis={apis} access={access} fund={fund} onClose={close} onDone={() => { overview.reload?.(); return done('The fund’s facts were saved.'); }} />}
    </Section>
  );
}

/** Economics' Change: both rates and a reason; the Worker asks the Super Admin's step-up. */
export function EconomicsDialog({ apis, access, fund, onClose, onDone }) {
  const [form, setForm] = useState({ carry: rateInput(fund.carried_interest), fee: rateInput(fund.management_fee), reason: '' });
  const [body, setBody] = useState(null);
  const { busy, error, setError } = useAct();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  // D4812 part 5: a checked change opens the money flow; the act runs only from its Confirm step.
  const submit = (e) => {
    e.preventDefault();
    const out = checkEconomics(form, fund);
    if (out.error) { setError(out.error); return; }
    setError(''); setBody(out.body);
  };
  if (body) {
    return (
      <ActFlow apis={apis} access={access} act="fund.economics" testId="fund-economics-flow" title="Change economics"
        sub={fund.name || `Fund #${fund.id}`} effects={economicsEffects(fund, body)} label="Change the fund’s economics"
        consequences={['The distribution job withholds carry at the new rate from its next run.', 'The old and new rates and your reason are kept on the audit record.']}
        run={() => apis.funds.update(fund.id, body)}
        receipt={() => economicsEffects(fund, body).slice(1, 3).concat([['Audit', 'Recorded as fund.economics']])}
        onClose={onClose} onBack={() => setBody(null)} onDone={() => onDone()} />
    );
  }
  return (
    <Lightbox label="Change economics" title={`Change economics · ${fund.name || `Fund #${fund.id}`}`}
      sub="The distribution job withholds carry at this rate. A change asks a reason, then your authenticator code." testId="fund-economics-dialog" onClose={onClose} width={480}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="fund-economics-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>Carry %<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.carry} onChange={set('carry')} disabled={busy} placeholder="Not recorded" data-testid="fund-economics-carry" /></label>
          <label className={LABEL}>Management fee %<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.fee} onChange={set('fee')} disabled={busy} placeholder="Not recorded" data-testid="fund-economics-fee" /></label>
        </div>
        <label className={LABEL}>Reason · required
          <textarea className={`${INPUT} mt-1`} rows={3} maxLength={FUND_REASON_MAX} value={form.reason} onChange={set('reason')} disabled={busy} data-testid="fund-economics-reason" />
          <span className="mt-1 block text-[11px] font-normal text-axal-muted dark:text-gray-400">Kept on the audit record with the old and new rates.</span>
        </label>
        <Err text={error} testId="fund-economics-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <FundActControl access={access} act="fund.economics" testId="fund-economics-submit-refused" className={MUTED}>
            <button type="submit" className={BTN.primary} disabled={busy} data-testid="fund-economics-submit">Review the change</button>
          </FundActControl>
        </div>
      </form>
    </Lightbox>
  );
}

/** Service providers' Edit: the five facts migration 163 names; a cleared one is saved as not recorded. */
export function ProvidersDialog({ apis, fund, onClose, onDone }) {
  const [form, setForm] = useState(Object.fromEntries(PROVIDERS.map(([k]) => [k, fact(fund[k]) ?? ''])));
  const { busy, error, setError, run } = useAct();
  const submit = async (e) => {
    e.preventDefault();
    const out = providersBody(form, fund);
    if (out.error) { setError(out.error); return; }
    await run(async () => { await apis.funds.update(fund.id, out.body); await onDone(); }, 'The service providers could not be saved.');
  };
  return (
    <Lightbox label="Service providers" title="Service providers" sub="These are what an LP-facing document states. Leave one empty to show it as not recorded." testId="fund-providers-dialog" onClose={onClose} width={480}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="fund-providers-form">
        {PROVIDERS.map(([k, l]) => (
          <label key={k} className={LABEL}>{l}<input className={`${INPUT} mt-1`} value={form[k]} maxLength={PROVIDER_MAX} disabled={busy}
            onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); }} data-testid={`fund-providers-${k}`} /></label>
        ))}
        <Err text={error} testId="fund-providers-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={busy} data-testid="fund-providers-submit">Save</button>
        </div>
      </form>
    </Lightbox>
  );
}

/** Regenerate LPA, asked first. With no GP of record the Worker refuses, and the dialog says why. */
export function RegenerateDialog({ apis, fund, onClose, onDone }) {
  const { busy, error, run } = useAct();
  const go = () => run(async () => { await apis.funds.regenerateLpa(fund.id); await onDone(); }, 'A new LPA draft could not be asked for.', (e, fb) => lpaRefusal(e, refusalText(e, fb)));
  return (
    <Lightbox label="Regenerate LPA" title="Regenerate the LPA?" sub={fund.name || `Fund #${fund.id}`} testId="fund-regenerate-dialog" onClose={onClose} width={440}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className={INFO}>{REGENERATE_INFO}</p>
        <Err text={error} testId="fund-regenerate-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={go} disabled={busy} data-testid="fund-regenerate-submit">Regenerate LPA</button>
        </div>
      </div>
    </Lightbox>
  );
}

/** Edit fund facts: name, vintage, target size and status (`fund.write`). */
export function FactsDialog({ apis, access, fund, onClose, onDone }) {
  const [form, setForm] = useState(factsForm(fund));
  const { busy, error, setError, run } = useAct();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const submit = async (e) => {
    e.preventDefault();
    const out = checkFacts(form, fund);
    if (out.error) { setError(out.error); return; }
    await run(async () => { await apis.funds.update(fund.id, out.body); await onDone(); }, 'The fund’s facts could not be saved.');
  };
  return (
    <Lightbox label="Edit fund facts" title="Edit fund facts" sub={fund.name || `Fund #${fund.id}`} testId="fund-facts-dialog" onClose={onClose} width={480}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="fund-facts-form">
        <label className={LABEL}>Name<input className={`${INPUT} mt-1`} value={form.name} maxLength={FUND_NAME_MAX} onChange={set('name')} disabled={busy} data-testid="fund-facts-name" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>Vintage year<input className={`${INPUT} mt-1 ${NUM}`} inputMode="numeric" value={form.vintage} onChange={set('vintage')} disabled={busy} data-testid="fund-facts-vintage" /></label>
          <label className={LABEL}>Target size ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.size} onChange={set('size')} disabled={busy} data-testid="fund-facts-size" /></label>
          <label className={LABEL}>Status
            <select className={`${INPUT} mt-1`} value={form.status} onChange={set('status')} disabled={busy} data-testid="fund-facts-status">
              {FUND_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">Carry and the management fee change under Economics.</p>
        <Err text={error} testId="fund-facts-error" />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <FundActControl access={access} act="fund.write" testId="fund-facts-submit-refused" className={MUTED}>
            <button type="submit" className={BTN.primary} disabled={busy} data-testid="fund-facts-submit">Save</button>
          </FundActControl>
        </div>
      </form>
    </Lightbox>
  );
}
