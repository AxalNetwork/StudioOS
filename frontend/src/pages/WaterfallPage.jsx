/**
 * D6221 (#6221): the Exit Waterfall at `/portfolio/waterfall`, built to the
 * canvas D6220 (`design/incoming/Portfolio v2 Exit Waterfall Page.dc.html`,
 * boards EW-01 to EW-14) inside the Portfolio frame (D4817 part 1, #5311).
 *
 * The fund view only: the picker over `GET /api/funds` (D6219), the inputs
 * with their source and assumption chips, the 1× / 2× / 3× chips, the tier bar
 * and legend or the tier table, four figures with their definitions, the
 * per-LP rows with Export CSV and Print, How this is worked out, and the
 * saved scenarios (save for a manager only, load, changed since loaded,
 * compare two as saved, delete with confirmation). Company exit, Eadwyn's
 * proposals and an LP's scoped row need the Worker first (D6221.md).
 *
 * The pure half is `portfolio/waterfallModel.js`; styles `portfolio/waterfall.css`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/csvExport';
import { useAuth } from '../hooks/useAuthSync';
import Lightbox from '../ui/Lightbox';
import Sheet from '../ui/Sheet.jsx';
import WorkerRail from '../ui/WorkerRail';
import { usePhoneWidth } from '../ui/phone/usePhoneWidth';
import PortfolioFrame from './portfolio/PortfolioFrame';
import { FinancialMetric, Skeleton, SourceFailure } from './portfolio/PortfolioParts';
import {
  ASSUMPTION_CHIP, LIMITS, MODEL_LINE, NAME_MAX, NOT_MODELLED, RELATION_LINE, barLabel, bodyOf, carryOf, changesSince,
  compareOf, dollars, figuresOf, fundLabel, inputErrors, inputsFromScenario, lpRowsOf, lpsCsvOf, nameError, presetsOf,
  refusalOf, relationOf, scenarioOf, sourceLineOf, startingInputs, termsLine, tiersCsvOf, tiersOf,
} from './portfolio/waterfallModel';
import './portfolio/waterfall.css';

const DESCRIPTION = 'Model how proceeds split between LPs and the GP at an exit value you choose. Nothing here is recorded as a distribution.';
const utcTime = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;

function ModelChip() {
  return <span className="pew-model" data-testid="waterfall-model-line">{MODEL_LINE}</span>;
}

function Chip({ carry, assumption, testid }) {
  if (assumption) return <span className="pew-chip is-assumption" data-testid={testid}>{ASSUMPTION_CHIP}</span>;
  const tone = carry.state === 'fund' || carry.state === 'lp-record' ? 'is-source' : (carry.state === 'unreadable' ? 'is-unreadable' : 'is-none');
  return <span className={`pew-chip ${tone}`} data-testid={testid} data-state={carry.state}>{carry.chip}</span>;
}

function Field({ id, label, hint, error, children, chip }) {
  return (
    <div className="pew-field">
      <label htmlFor={id}>{label}{hint ? <span>{hint}</span> : null}</label>
      {children}
      {chip}
      {error ? <span className="pew-error" role="alert" id={`${id}-error`}>{error}</span> : null}
    </div>
  );
}

/** Carry, hurdle, years and catch-up: inline at desktop, in a sheet on a phone. */
function Terms({ inputs, setField, errors, carry }) {
  return (
    <>
      <Field id="pew-carry" label="Carry" hint={`${LIMITS.carry[0]}–${LIMITS.carry[1]}%`} error={errors.carry}
        chip={<Chip carry={carry} testid="waterfall-carry-source" />}>
        <input id="pew-carry" className="pew-input" type="number" inputMode="decimal" min={0} max={50} step={0.5} value={inputs.carry} aria-invalid={Boolean(errors.carry)}
          onChange={(e) => setField('carry', e.target.value)} data-testid="input-waterfall-carry" />
      </Field>
      <Field id="pew-hurdle" label="Hurdle" hint={`${LIMITS.hurdle[0]}–${LIMITS.hurdle[1]}%`} error={errors.hurdle} chip={<Chip assumption testid="waterfall-hurdle-source" />}>
        <input id="pew-hurdle" className="pew-input" type="number" inputMode="decimal" min={0} max={50} step={0.5} value={inputs.hurdle} aria-invalid={Boolean(errors.hurdle)}
          onChange={(e) => setField('hurdle', e.target.value)} data-testid="input-waterfall-hurdle" />
      </Field>
      <Field id="pew-years" label="Years held" hint={`${LIMITS.years[0]}–${LIMITS.years[1]}`} error={errors.years} chip={<Chip assumption testid="waterfall-years-source" />}>
        <input id="pew-years" className="pew-input" type="number" inputMode="decimal" min={0} max={20} step={0.5} value={inputs.years} aria-invalid={Boolean(errors.years)}
          onChange={(e) => setField('years', e.target.value)} data-testid="input-waterfall-years" />
      </Field>
      <Field id="pew-catchup" label="GP catch-up" chip={<Chip assumption testid="waterfall-catchup-source" />}>
        <label className="pew-toggle">
          <input id="pew-catchup" type="checkbox" checked={inputs.catchup} onChange={(e) => setField('catchup', e.target.checked)} data-testid="input-waterfall-catchup" />
          <span>{inputs.catchup ? 'On · 100% to carry rate' : 'Off'}</span>
        </label>
      </Field>
    </>
  );
}

function TierBar({ result, grey }) {
  const tiers = tiersOf(result).filter((t) => t.amount > 0);
  return (
    <div className={`pew-bar${grey ? ' is-grey' : ''}`} role="img" aria-label={barLabel(result)} data-testid="waterfall-bar">
      {tiers.map((t) => <span key={t.order} className={`is-${t.kind}`} style={{ width: `${(t.share * 100).toFixed(2)}%` }}>{t.share > 0.12 ? t.to : ''}</span>)}
    </div>
  );
}

function Legend({ result }) {
  return (
    <ol className="pew-legend" aria-label="Tiers in order" data-testid="waterfall-legend">
      {tiersOf(result).map((t) => (
        <li key={t.order}><i className={`is-${t.kind}`} aria-hidden="true" /><b>{t.name}</b><span>to {t.to}</span><span className="pew-am">{dollars(t.amount)}</span></li>
      ))}
    </ol>
  );
}

function TierTable({ result }) {
  const t = result.totals || {};
  return (
    <div className="pf-table-wrap">
      <table className="pf-table" data-testid="waterfall-tier-table">
        <caption>Tiers in the order they are paid · exit {dollars(result.exit_value)}</caption>
        <thead><tr><th scope="col">Tier</th><th scope="col">To</th><th scope="col" className="n">Amount</th><th scope="col" className="n">Running total</th></tr></thead>
        <tbody>
          {tiersOf(result).map((r) => (
            <tr key={r.order}><th scope="row">{r.name}</th><td data-label="To">{r.to}</td><td className="n" data-label="Amount">{dollars(r.amount)}</td><td className="n" data-label="Running total">{dollars(r.running)}</td></tr>
          ))}
          <tr className="pf-total"><th scope="row">Total distributed</th><td data-label="Split">LPs {dollars(t.to_lps)} · GP {dollars(t.to_gp)}</td><td className="n" data-label="Amount">{dollars(t.total_distributed)}</td><td className="n" data-label="Running total">{dollars(t.total_distributed)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function LpRows({ result, readOnly, onExport, onPrint }) {
  const { rows, total } = lpRowsOf(result);
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pew-lp-title" data-testid="waterfall-lp-rows">
      <div className="pf-card-head">
        <h2 id="pew-lp-title">{readOnly ? 'Per-LP rows · your row' : 'Per-LP rows'}</h2>
        <div className="pew-row">
          {!readOnly ? <button type="button" className="pf-btn" onClick={onExport} data-testid="button-waterfall-export">Export CSV</button> : null}
          <button type="button" className="pf-btn" onClick={onPrint} data-testid="button-waterfall-print">Print</button>
          {!readOnly ? <span className="pf-sm">Pro-rated by commitment share · GP of record and admin see every row</span> : null}
        </div>
      </div>
      {readOnly ? (
        <p className="pf-note" data-testid="waterfall-lp-not-recorded">
          <b>Your row: not recorded.</b> The simulation does not say which LP row is yours, and other LPs’ rows are not yours to read, so none is shown. Your own row and the other LPs combined need a scoped answer from the Worker.
        </p>
      ) : rows.length ? (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <caption>At a modelled exit of {dollars(result.exit_value)} · {(Number(result.totals?.years_held) || 0).toFixed(1)} years · {total.name}</caption>
            <thead><tr><th scope="col">LP</th><th scope="col" className="n">Commitment</th><th scope="col" className="n">Invested</th><th scope="col" className="n">Share</th><th scope="col" className="n">Modelled payout</th><th scope="col" className="n">Profit</th><th scope="col" className="n">Multiple</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="waterfall-lp-row">
                  <th scope="row">{r.name}</th>
                  <td className="n" data-label="Commitment">{dollars(r.commitment)}</td>
                  <td className="n" data-label="Invested">{dollars(r.invested)}</td>
                  <td className="n" data-label="Share">{r.share.toFixed(3)}%</td>
                  <td className="n" data-label="Payout">{dollars(r.payout)}</td>
                  <td className="n" data-label="Profit">{dollars(r.profit)}</td>
                  <td className="n" data-label="Multiple">{r.multiple}</td>
                </tr>
              ))}
              <tr className="pf-total">
                <th scope="row">{total.name}</th>
                <td className="n" data-label="Commitment">{dollars(total.commitment)}</td>
                <td className="n" data-label="Invested">{dollars(total.invested)}</td>
                <td className="n" data-label="Share">{total.share.toFixed(3)}%</td>
                <td className="n" data-label="Payout">{dollars(total.payout)}</td>
                <td className="n" data-label="Profit">{dollars(total.profit)}</td>
                <td className="n" data-label="Multiple">{total.multiple}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pew-pad" data-testid="waterfall-no-lp-rows">
          <p className="pf-note"><b>No LP rows recorded.</b> Totals come from the fund’s committed and deployed figures; per-LP rows appear when LPs are added.</p>
        </div>
      )}
    </section>
  );
}

function Scenarios({ read, items, me, loadedUid, onRetry, onLoad, onCompare, onDelete, busy }) {
  return (
    <section className="pf-card" aria-labelledby="pew-sc-title" data-testid="waterfall-scenarios">
      <div className="pf-card-head">
        <h2 id="pew-sc-title">Scenarios · this fund</h2>
        {read?.status === 'ready' ? <span className="pf-sm">{items.length} saved</span> : null}
      </div>
      {!read ? <Skeleton rows={2} /> : null}
      {read?.status === 'unreadable' ? (
        <SourceFailure what="Scenarios" claim="The model still works." onRetry={onRetry} testid="status-waterfall-scenarios-unreadable" retryTestid="button-retry-waterfall-scenarios" />
      ) : null}
      {read?.status === 'ready' && !items.length ? <p className="pf-muted" data-testid="waterfall-no-scenarios">No scenarios saved for this fund.</p> : null}
      {read?.status === 'ready' && items.length ? (
        <ol className="pew-list">
          {items.map((s) => {
            const v = scenarioOf(s, me);
            const on = s.uid === loadedUid;
            return (
              <li key={s.uid} className={on ? 'is-on' : ''} data-testid={`waterfall-scenario-${s.uid}`}>
                <b>{v.name}</b>
                {on ? <span className="pew-loaded">Loaded</span> : <span />}
                <small>{v.by}{v.savedAt ? ` · ${v.savedAt}` : ''}</small>
                <small>{v.summary}</small>
                <div className="pew-row">
                  <button type="button" className="pf-btn" disabled={on || busy} onClick={() => onLoad(s)} data-testid={`button-load-${s.uid}`}>Load</button>
                  <button type="button" className="pf-btn" disabled={items.length < 2 || busy} onClick={() => onCompare(s)} data-testid={`button-compare-${s.uid}`}>Compare</button>
                  <button type="button" className="pf-btn is-quiet" disabled={busy} aria-label={`Delete ${v.name}`} onClick={() => onDelete(s)} data-testid={`button-delete-${s.uid}`}>Delete</button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="pf-foot">Rename is not available: no route updates a saved scenario. Use Save as new.</p>
    </section>
  );
}

function Compare({ items, a, b, setA, setB, onBack }) {
  const sa = items.find((s) => s.uid === a);
  const sb = items.find((s) => s.uid === b);
  const cmp = sa && sb ? compareOf(sa, sb) : null;
  const pick = (id, value, set, label) => (
    <label className="pf-select" htmlFor={id}>
      <span className="pew-lbl">{label}</span>
      <select id={id} value={value || ''} onChange={(e) => set(e.target.value)} data-testid={`select-compare-${label.toLowerCase()}`}>
        {items.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}
      </select>
    </label>
  );
  return (
    <section className="pf-card pf-table-card" aria-labelledby="pew-cmp-title" data-testid="waterfall-compare">
      <div className="pf-card-head">
        <h2 id="pew-cmp-title">Compare</h2>
        <div className="pew-row">
          {pick('pew-cmp-a', a, setA, 'A')}
          {pick('pew-cmp-b', b, setB, 'B')}
          <button type="button" className="pf-btn is-quiet" onClick={onBack} data-testid="button-compare-back">Back to the model</button>
        </div>
      </div>
      {cmp ? (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <caption>{sa.name} compared with {sb.name}, each as saved</caption>
            <thead><tr><th scope="col">Figure</th><th scope="col" className="n">A · {sa.name}</th><th scope="col" className="n">B · {sb.name}</th><th scope="col" className="n">B − A</th></tr></thead>
            {cmp.sections.map((sec) => (
              <tbody key={sec.title}>
                <tr className="pew-sec"><th scope="rowgroup" colSpan={4}>{sec.title}</th></tr>
                {sec.rows.map((r) => (
                  <tr key={r.label} className={r.differs ? 'pew-differs' : ''} data-testid="waterfall-compare-row" data-differs={r.differs ? 'yes' : 'no'}>
                    <th scope="row">{r.label}{r.differs ? <span className="pew-dm"> · differs</span> : null}</th>
                    <td className="n" data-label="A">{r.a}</td><td className="n" data-label="B">{r.b}</td><td className="n" data-label="B − A">{r.diff}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : <p className="pf-note pew-pad">Choose two different saved scenarios.</p>}
      <p className="pf-foot pew-pad">
        Each column is the scenario as it was saved; nothing is re-run.
        {cmp?.periodsDiffer ? ' The holding periods differ, so the annualised returns answer different questions and are shown side by side, never joined into one figure.' : ''}
      </p>
    </section>
  );
}

function HowItWorks({ fund, body, carry, result, onClose }) {
  const t = result?.totals || {};
  const lps = (result?.lp_rows || []).length;
  return (
    <Sheet label="How this is worked out" eyebrow={fund?.name} title="How this is worked out" onClose={onClose} width={600} phone="sheet" testId="waterfall-how">
      <div className="pf-sheet">
        <ModelChip />
        <section>
          <h3>Where each input comes from</h3>
          <dl className="pf-kv">
            <div><dt>Carry {body ? `${Math.round(body.carry_pct * 10000) / 100}%` : ''}</dt><dd>{carry?.chip}</dd></div>
            <div><dt>Hurdle, years, catch-up</dt><dd>{ASSUMPTION_CHIP}</dd></div>
            <div><dt>Exit value</dt><dd>Typed by you{body ? ` · ${dollars(body.exit_value)}` : ''}</dd></div>
            <div><dt>Committed, invested</dt><dd>{lps ? `Summed from ${lps} LP rows` : 'The fund’s committed and deployed figures'}{result ? ` · ${dollars(t.total_committed)} · ${dollars(t.total_invested)}` : ''}</dd></div>
          </dl>
        </section>
        <section>
          <h3>Tiers, in the order they are paid</h3>
          <dl className="pf-kv">
            <div><dt>Return of capital</dt><dd>LPs get back what they invested, up to the exit value.</dd></div>
            <div><dt>Preferred return</dt><dd>Then invested × ((1 + hurdle)^years − 1) to LPs.</dd></div>
            <div><dt>GP catch-up</dt><dd>Then the GP until it holds the carry rate of the profit so far (preferred return × carry ÷ (1 − carry)), when catch-up is on.</dd></div>
            <div><dt>Profit split</dt><dd>What remains, split by the carry rate.</dd></div>
            <div><dt>LP multiple</dt><dd>To LPs ÷ invested. Not computable when nothing is invested.</dd></div>
            <div><dt>Annualised return</dt><dd>(To LPs ÷ invested)^(1 ÷ years) − 1. One cash flow in, one out: not a dated IRR. Not computable when nothing is invested, nothing reaches LPs, or years is 0.</dd></div>
          </dl>
        </section>
        {result?.assumptions?.length ? (
          <section>
            <h3>The engine’s assumption lines</h3>
            <ul className="pew-plain">{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </section>
        ) : null}
        <section>
          <h3>Not modelled</h3>
          <p className="pf-sub">{NOT_MODELLED}</p>
        </section>
      </div>
    </Sheet>
  );
}

function SaveSheet({ fund, body, result, carry, saving, error, onSave, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const err = nameError(name);
  const t = result?.totals || {};
  const f = figuresOf(result);
  const submit = () => { setTouched(true); if (!err && !saving) onSave(name.trim(), description.trim()); };
  return (
    <Sheet label="Save scenario" eyebrow={`${fund?.name} · saved by you · only you and an admin can open it`} title="Save scenario" onClose={() => { if (!saving) onClose(); }} width={560} phone="sheet" testId="waterfall-save"
      footer={(
        <div className="pew-foot">
          <button type="button" className="pf-btn" onClick={onClose} disabled={saving} data-testid="button-save-cancel">Cancel</button>
          <button type="button" className="pf-btn is-primary" onClick={submit} disabled={saving} aria-busy={saving} data-testid="button-save-confirm">
            {saving ? `Saving “${name.trim()}”…` : (name.trim() && !err ? `Save “${name.trim()}”` : 'Save scenario')}
          </button>
        </div>
      )}>
      <div className="pf-sheet">
        <div className="pew-field">
          <label htmlFor="pew-name">Name <span>required · {NAME_MAX} characters at most</span></label>
          <input id="pew-name" className="pew-input" value={name} disabled={saving} aria-invalid={touched && Boolean(err)} onChange={(e) => setName(e.target.value)} data-testid="input-scenario-name" />
          <span className="pf-sm">{name.trim().length} / {NAME_MAX}</span>
          {(touched || name.trim().length > NAME_MAX) && err ? <span className="pew-error" role="alert" data-testid="scenario-name-error">{err}</span> : null}
        </div>
        <div className="pew-field">
          <label htmlFor="pew-desc">Description <span>optional</span></label>
          <textarea id="pew-desc" className="pew-input" rows={2} value={description} disabled={saving} onChange={(e) => setDescription(e.target.value)} data-testid="input-scenario-description" />
        </div>
        <h3 className="pf-eyebrow">It keeps these inputs and this result</h3>
        <dl className="pf-kv">
          <div><dt>Exit value</dt><dd>{dollars(body.exit_value)}</dd></div>
          <div><dt>Carry</dt><dd>{Math.round(body.carry_pct * 10000) / 100}% · {carry?.state === 'fund' || carry?.state === 'lp-record' ? 'from the fund’s terms' : 'assumption'}</dd></div>
          <div><dt>Hurdle · years · catch-up</dt><dd>{(body.hurdle_rate * 100).toFixed(1)}% · {Number(body.years_held).toFixed(1)} · {body.gp_catchup ? 'on' : 'off'} · assumptions</dd></div>
          <div><dt>Result</dt><dd>LPs {dollars(t.to_lps)} · GP {dollars(t.to_gp)} · {f[2].value} · {f[3].value}</dd></div>
        </dl>
        {error ? <p className="pf-failure" role="alert" data-testid="waterfall-save-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}

export default function WaterfallPage() {
  const { user } = useAuth() || {};
  const phone = usePhoneWidth();
  const [fundRead, setFundRead] = useState({ status: 'loading', items: [] });
  const [fundRetry, setFundRetry] = useState(0);
  const [selection, setSelection] = useState(null);
  const funds = fundRead.items;
  const fund = funds.find((f) => f.id === selection) ?? funds[0];
  const fundId = fund?.id;
  const relation = relationOf(fund);
  const canManage = fund?.can_manage === true;
  const isLp = relation === 'lp';

  const [portal, setPortal] = useState(null);
  const [portalRetry, setPortalRetry] = useState(0);
  const carry = carryOf(fund, portal);

  const [inputs, setInputs] = useState(() => startingInputs());
  const [seededFor, setSeededFor] = useState(null);
  const [view, setView] = useState('chart');
  const [mode, setMode] = useState('model');
  const [sim, setSim] = useState(null);
  const [lastGood, setLastGood] = useState(null);
  const [simRetry, setSimRetry] = useState(0);
  const [scenarioRead, setScenarioRead] = useState(null);
  const [scenarioRetry, setScenarioRetry] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const [cmp, setCmp] = useState({ a: null, b: null });
  const [sheet, setSheet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    let alive = true;
    setFundRead({ status: 'loading', items: [] });
    api.fundsList().then((res) => {
      if (!Array.isArray(res?.items)) throw new Error('Invalid fund list');
      if (alive) setFundRead({ status: 'ready', items: res.items });
    }).catch(() => { if (alive) setFundRead({ status: 'unreadable', items: [] }); });
    return () => { alive = false; };
  }, [fundRetry]);

  // An LP's carry is on their own fund record (the list leaves terms out, D4636).
  useEffect(() => {
    if (!isLp) return undefined;
    let alive = true;
    setPortal({ state: 'loading' });
    api.fundsLpPortal().then((data) => { if (alive) setPortal({ state: 'ready', data }); })
      .catch(() => { if (alive) setPortal({ state: 'unreadable' }); });
    return () => { alive = false; };
  }, [isLp, portalRetry]);

  // Each fund starts from its own terms; a loaded scenario's inputs replace them.
  const seedKey = fundId != null && carry && carry.state !== 'loading' ? `${fundId}:${carry.state}:${carry.pct}` : null;
  useEffect(() => {
    if (!seedKey || seedKey === seededFor) return;
    setSeededFor(seedKey);
    if (String(seededFor || '').split(':')[0] !== String(fundId)) {
      setInputs(startingInputs(carry.pct));
      setLoaded(null);
      setLastGood(null);
      setMode('model');
    } else {
      setInputs((cur) => ({ ...cur, carry: carry.pct }));
    }
  }, [seedKey, seededFor, fundId, carry]);

  const errors = inputErrors(inputs);
  const body = useMemo(() => (seedKey && seededFor === seedKey ? bodyOf(inputs) : null), [inputs, seedKey, seededFor]);
  const bodyKey = body ? `${fundId}|${JSON.stringify(body)}|${simRetry}` : null;

  useEffect(() => {
    if (!bodyKey) return undefined;
    let alive = true;
    api.fundSimWaterfall(fundId, body).then((result) => {
      if (!alive) return;
      const at = new Date();
      setSim({ key: bodyKey, status: 'ready', result, at });
      setLastGood({ fundId, body, result, at });
    }).catch(() => { if (alive) setSim({ key: bodyKey, status: 'failed' }); });
    return () => { alive = false; };
  }, [bodyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const showScenarios = Boolean(fundId) && !isLp;
  useEffect(() => {
    if (!showScenarios) return undefined;
    let alive = true;
    setScenarioRead(null);
    api.fundSimScenariosList(fundId, 'waterfall').then((res) => {
      if (!Array.isArray(res?.items)) throw new Error('Invalid scenario list');
      if (alive) setScenarioRead({ fundId, status: 'ready', items: res.items });
    }).catch(() => { if (alive) setScenarioRead({ fundId, status: 'unreadable', items: [] }); });
    return () => { alive = false; };
  }, [fundId, showScenarios, scenarioRetry]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const current = sim?.key === bodyKey && sim.status === 'ready' ? sim : null;
  const failed = sim?.key === bodyKey && sim.status === 'failed';
  const shown = current ? { result: current.result, body, at: current.at } : (lastGood?.fundId === fundId ? lastGood : null);
  const result = shown?.result || null;
  const exitTyped = inputs.exit !== '' && !errors.exit;
  const presets = presetsOf(result?.totals?.total_invested);
  const scenarios = scenarioRead && scenarioRead.fundId === fundId && scenarioRead.status === 'ready' ? scenarioRead.items : [];
  const changes = loaded && body ? changesSince(loaded.body, body) : [];
  const canSave = canManage && Boolean(current) && exitTyped;

  const setField = (k, v) => { setInputs((cur) => ({ ...cur, [k]: v })); };
  const chooseFund = (e) => {
    setSelection(funds.find((f) => String(f.id) === e.target.value)?.id ?? null);
    setDeleteTarget(null);
    setSheet(null);
  };
  const loadScenario = (s) => {
    const next = inputsFromScenario(s, inputs);
    setInputs(next);
    setLoaded({ uid: s.uid, name: s.name, savedDay: scenarioOf(s, user?.id).savedDay, body: bodyOf(next) });
    setMode('model');
  };
  const openCompare = (s) => {
    const a = loaded?.uid && loaded.uid !== s.uid ? loaded.uid : scenarios.find((x) => x.uid !== s.uid)?.uid;
    setCmp({ a, b: s.uid });
    setMode('compare');
  };
  const save = async (name, description) => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.fundSimScenarioCreate(fundId, { kind: 'waterfall', name, description: description || null, inputs: { ...body, carry_source: carry?.state }, result: current.result });
      setSheet(null);
      setToast(`Saved “${name}”`);
      if (saved?.uid) setLoaded({ uid: saved.uid, name, savedDay: scenarioOf(saved, user?.id).savedDay, body });
      setScenarioRetry((n) => n + 1);
    } catch (e) {
      setSaveError(refusalOf(e, 'save'));
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.fundSimScenarioDelete(deleteTarget.uid);
      if (loaded?.uid === deleteTarget.uid) setLoaded(null);
      setDeleteTarget(null);
      setMode('model');
      setScenarioRetry((n) => n + 1);
    } catch (e) {
      setDeleteError(refusalOf(e, 'delete'));
    } finally {
      setDeleting(false);
    }
  };
  const exportLps = () => {
    if (!result || !shown?.body) return;
    const f = lpsCsvOf({ fund, scenario: loaded?.name, body: shown.body, result });
    downloadCsv(f.filename, f.header, f.rows);
    const t = tiersCsvOf({ fund, scenario: loaded?.name, body: shown.body, carry, result, modelledAt: shown.at?.toISOString?.() });
    downloadCsv(t.filename, t.header, t.rows);
  };
  const print = () => { if (typeof window !== 'undefined' && typeof window.print === 'function') window.print(); };

  const tools = fundId ? (
    <>
      {shown?.at ? <span className="pf-context" data-testid="waterfall-modelled-at">Modelled {utcTime(shown.at)}</span> : null}
      <button type="button" className="pf-btn" onClick={() => setSheet('how')} data-testid="button-waterfall-how">How this is worked out</button>
      {canManage ? (
        <button type="button" className="pf-btn is-primary" onClick={() => { setSaveError(null); setSheet('save'); }} disabled={!canSave}
          title={canSave ? undefined : 'Type an exit value and let the model run first.'} data-testid="button-waterfall-save">Save scenario</button>
      ) : null}
    </>
  ) : null;

  const exitField = (
    <Field id="pew-exit" label="Exit value" hint="total the holdings return, in US dollars" error={errors.exit}>
      <input id="pew-exit" className="pew-input pew-big" inputMode="numeric" placeholder="Type an exit value" value={inputs.exit} aria-invalid={Boolean(errors.exit)}
        onChange={(e) => setField('exit', e.target.value)} data-testid="input-waterfall-exit" />
      {presets.length ? (
        <div className="pew-presets" role="group" aria-label="Starting points">
          {presets.map((p) => (
            <button key={p.multiple} type="button" aria-pressed={parseInt(String(inputs.exit).replace(/\D/g, ''), 10) === p.value}
              onClick={() => setField('exit', p.value.toLocaleString('en-US'))} data-testid={`button-preset-${p.multiple}x`}>{p.label}</button>
          ))}
          <em>Arithmetic on the recorded invested total, not a proposal</em>
        </div>
      ) : null}
    </Field>
  );

  return (
    <PortfolioFrame
      tab={null}
      title="Exit Waterfall"
      crumb="Exit Waterfall"
      docTitle="Exit Waterfall · Portfolio · Axal VC"
      description={DESCRIPTION}
      testid="exit-waterfall"
      tools={tools}
      rail={(
        <WorkerRail workspace="Portfolio" role="investor" className="pf-rail" data-testid="waterfall-rail"
          note="The Exit Waterfall is a model of a split, not a distribution. Its figures come from the fund's recorded commitments and the inputs you type." />
      )}
    >
      <p className="pew-print-banner" aria-hidden="true">Model, not a distribution · provisional · nothing here is recorded</p>
      {fundRead.status === 'loading' ? <section className="pf-card" aria-label="Loading the model"><Skeleton rows={3} /></section> : null}
      {fundRead.status === 'unreadable' ? (
        <SourceFailure what="Your funds" claim="Exit Waterfall needs the fund list first. Nothing else is shown until it loads." onRetry={() => setFundRetry((n) => n + 1)}
          testid="status-waterfall-funds-unreadable" retryTestid="button-retry-waterfall-funds" />
      ) : null}
      {fundRead.status === 'ready' && !funds.length ? (
        <section className="pf-card" data-testid="waterfall-no-fund">
          <p className="pf-note"><b>No fund is visible to you yet.</b> {user?.role === 'admin'
            ? <>Funds you manage appear here once they exist. <Link to="/admin/fund-admin/funds" data-testid="link-waterfall-fund-admin">Open Fund Admin</Link></>
            : 'Funds you manage, or are an LP of, appear here.'}</p>
        </section>
      ) : null}

      {fundId != null ? (
        <>
          <div className="pew-row pew-top">
            <label className="pf-select" htmlFor="pew-fund">
              <span className="pew-lbl">Fund</span>
              <select id="pew-fund" value={fundId} onChange={chooseFund} disabled={saving || deleting} data-testid="select-waterfall-fund">
                {funds.map((f) => <option key={f.id} value={f.id}>{fundLabel(f)}</option>)}
              </select>
            </label>
            <span className="pf-sm" data-testid="waterfall-relation">{RELATION_LINE[relation]}</span>
            <span className="pew-spacer" />
            {!canManage ? <span className="pew-chip is-none" data-testid="waterfall-read-only">Read only: only the fund’s GP of record or an admin can save scenarios</span> : null}
            {mode === 'compare' ? <span className="pew-loaded">Comparing 2 saved scenarios</span> : null}
            {mode === 'model' && loaded ? (
              changes.length ? (
                <span className="pew-loaded is-changed" data-testid="waterfall-changed">
                  Changed since loaded · {changes.join(' · ')}
                  {canManage ? <button type="button" className="pf-btn is-primary" disabled={!canSave} onClick={() => { setSaveError(null); setSheet('save'); }} data-testid="button-save-as-new">Save as new…</button> : null}
                </span>
              ) : <span className="pew-loaded" data-testid="waterfall-loaded">Loaded: {loaded.name}{loaded.savedDay ? ` · saved ${loaded.savedDay}` : ''}</span>
            ) : null}
          </div>
          {toast ? <p className="pew-toast" role="status" data-testid="waterfall-toast">{toast}</p> : null}
          {isLp && portal?.state === 'unreadable' ? (
            <SourceFailure what="Your fund record" claim={`Carry uses ${carry?.pct}% as an assumption until it loads.`} onRetry={() => setPortalRetry((n) => n + 1)}
              testid="status-waterfall-portal-unreadable" retryTestid="button-retry-waterfall-portal" />
          ) : null}

          {mode === 'compare' ? (
            <Compare items={scenarios} a={cmp.a} b={cmp.b} setA={(a) => setCmp((c) => ({ ...c, a }))} setB={(b) => setCmp((c) => ({ ...c, b }))} onBack={() => setMode('model')} />
          ) : (
            <>
              <div className="pew-ws">
                <section className="pf-card" aria-labelledby="pew-in-title" data-testid="waterfall-inputs">
                  <div className="pf-card-head"><h2 id="pew-in-title">Inputs</h2><span className="pf-sm">Limits: carry 0–50% · hurdle 0–50% · years 0–20</span></div>
                  <div className="pew-inputs">
                    {exitField}
                    {carry?.state === 'loading' ? <Skeleton rows={2} /> : (phone ? (
                      <button type="button" className="pf-btn pew-terms-button" onClick={() => setSheet('terms')} data-testid="button-waterfall-terms">Terms and assumptions <span className="pf-sm">4 inputs ›</span></button>
                    ) : <Terms inputs={inputs} setField={setField} errors={errors} carry={carry} />)}
                  </div>
                </section>

                <section className="pf-card" aria-labelledby="pew-res-title" data-testid="waterfall-result">
                  <div className="pf-card-head">
                    <div className="pew-col">
                      <h2 id="pew-res-title">{exitTyped && result ? `Modelled split at ${dollars(result.exit_value)}` : 'Modelled split'}</h2>
                      {shown?.body ? <span className="pf-sm">{termsLine(shown.body)}</span> : null}
                    </div>
                    <div className="pew-row">
                      <ModelChip />
                      <div className="pew-seg" role="radiogroup" aria-label="View">
                        <button type="button" role="radio" aria-checked={view === 'chart'} onClick={() => setView('chart')} data-testid="button-view-chart">Chart</button>
                        <button type="button" role="radio" aria-checked={view === 'table'} onClick={() => setView('table')} data-testid="button-view-table">Table</button>
                      </div>
                    </div>
                  </div>
                  {failed ? (
                    <div className="pf-failure" role="alert" data-testid="status-waterfall-model-unreadable">
                      <span><b>Not current · the model could not be run.</b> Your inputs are kept.{lastGood?.fundId === fundId && lastGood?.at ? ` The figures below are from ${utcTime(lastGood.at)}.` : ' No figure is shown in its place.'}</span>
                      <button type="button" onClick={() => setSimRetry((n) => n + 1)} data-testid="button-retry-waterfall-model">Try again</button>
                    </div>
                  ) : null}
                  {!result && !failed ? <Skeleton rows={3} /> : null}
                  {result && !exitTyped ? (
                    <p className="pf-note" data-testid="waterfall-type-exit">Type an exit value{presets.length ? ', or start from 1×, 2× or 3× invested' : ''}. Nothing is modelled until you do.</p>
                  ) : null}
                  {result && exitTyped ? (
                    <div className={failed ? 'pew-stale' : ''} data-testid="waterfall-figures-block">
                      {view === 'table' ? <TierTable result={result} /> : <><TierBar result={result} grey={failed} /><Legend result={result} /></>}
                      <div className="pew-figs">{figuresOf(result).map((m) => <FinancialMetric key={m.key} metric={m} />)}</div>
                      <div className="pew-source" data-testid="waterfall-source-line">{sourceLineOf(result).map((s) => <span key={s}>{s}</span>)}</div>
                    </div>
                  ) : null}
                </section>
              </div>

              {result && exitTyped ? <LpRows result={result} readOnly={isLp} onExport={exportLps} onPrint={print} /> : null}
              {showScenarios ? (
                <Scenarios read={scenarioRead?.fundId === fundId ? scenarioRead : null} items={scenarios} me={user?.id} loadedUid={loaded?.uid}
                  onRetry={() => setScenarioRetry((n) => n + 1)} onLoad={loadScenario} onCompare={openCompare} onDelete={(s) => { setDeleteError(null); setDeleteTarget(s); }} busy={saving || deleting} />
              ) : (
                <p className="pf-foot" data-testid="waterfall-no-scenario-list">No scenario list: an LP cannot save or load scenarios. Carry is read from your own fund record (LP portal).</p>
              )}
              <p className="pf-foot">Not modelled: {NOT_MODELLED} Nothing here changes a fund’s records.</p>
            </>
          )}
        </>
      ) : null}

      {sheet === 'how' ? <HowItWorks fund={fund} body={shown?.body || body} carry={carry} result={result} onClose={() => setSheet(null)} /> : null}
      {sheet === 'save' && canSave ? (
        <SaveSheet fund={fund} body={body} result={current.result} carry={carry} saving={saving} error={saveError} onSave={save} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'terms' ? (
        <Sheet label="Terms and assumptions" title="Terms and assumptions" onClose={() => setSheet(null)} width={480} phone="sheet" testId="waterfall-terms"
          footer={<div className="pew-foot"><button type="button" className="pf-btn is-primary" onClick={() => setSheet(null)} data-testid="button-terms-done">Show the result</button></div>}>
          <div className="pf-sheet"><Terms inputs={inputs} setField={setField} errors={errors} carry={carry} /></div>
        </Sheet>
      ) : null}
      {deleteTarget ? (
        <Lightbox testId="waterfall-delete-scenario" label="Delete saved scenario" title="Delete saved scenario?" onClose={() => { if (!deleting) setDeleteTarget(null); }}
          footer={(
            <div className="pew-foot">
              <button type="button" className="pf-btn" disabled={deleting} onClick={() => setDeleteTarget(null)} data-testid="button-delete-cancel">Cancel</button>
              <button type="button" className="pf-btn pew-danger" disabled={deleting} onClick={confirmDelete} data-testid="button-delete-confirm">{deleting ? 'Deleting…' : 'Delete scenario'}</button>
            </div>
          )}>
          <div className="pf-sheet">
            <p>Delete “{deleteTarget.name}” from this fund’s saved scenarios? It cannot be restored.</p>
            {deleteError ? <p className="pf-failure" role="alert" data-testid="waterfall-delete-error">{deleteError}</p> : null}
          </div>
        </Lightbox>
      ) : null}
    </PortfolioFrame>
  );
}
