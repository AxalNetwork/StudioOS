import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

/**
 * D632 — a cap table's draft variants, each edited in place (Ops canvas
 * `ct-variants`), at `/raise/cap-table/variants/:variant`.
 *
 * A variant is a `cap_table_scenarios` row with `is_variant = 1`. This page
 * renames it and edits its founders, option pool, SAFEs, rounds and exit
 * value through `PUT /api/captable/scenarios/:uid`, which re-simulates and
 * records the actor. The main cap table is never written here: it is one per
 * company, and its tab only links back to the cap table page.
 *
 * `/raise/cap-table/variants?project=<id>` is the same page before a variant
 * is chosen. States: loading; empty ("No draft variants yet."); "Not recorded"
 * where the stored inputs hold no value (vesting, granted options, an exit
 * value never set); "Unreadable" with Try again.
 */

const CAP_TABLE_HREF = '/raise/capital/cap-table';
export const variantHref = (uid) => `/raise/cap-table/variants/${encodeURIComponent(uid)}`;

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** The editable form of a scenario's stored inputs. Discounts read as percent. */
export function draftFromScenario(s) {
  const i = s?.inputs || {};
  return {
    name: str(s?.name),
    founders: (i.founders || []).map((f) => ({ name: str(f.name), shares: str(f.shares) })),
    option_pool_pct: str(i.option_pool_pct),
    safes: (i.safes || []).map((x) => ({
      ...x,
      name: str(x.name), amount: str(x.amount), cap: str(x.cap),
      discount: x.discount == null ? '' : String(Math.round(Number(x.discount) * 10000) / 100),
    })),
    rounds: (i.rounds || []).map((r) => ({ ...r, name: str(r.name), investment: str(r.investment), pre_money: str(r.pre_money) })),
    exit_value: str(i.exit_value),
  };
}

/**
 * The inputs the route takes, from the form. A field left blank is left out
 * (or `null` for the exit value), never sent as zero. Fields this page does not
 * edit — a SAFE's basis or instrument, a round's pool top-up — ride along
 * unchanged. A value that is not a number is reported here, in a sentence.
 */
export function inputsFromDraft(d) {
  const errors = [];
  const need = (v, label) => {
    const n = num(v);
    if (Number.isNaN(n)) errors.push(`${label} is not a number.`);
    return n;
  };
  const founders = d.founders.map((f, k) => ({ name: f.name.trim(), shares: need(f.shares, `Founder ${k + 1} shares`) }));
  const safes = d.safes.map((s, k) => {
    const { name, amount, cap, discount, ...rest } = s;
    const out = { ...rest, name: name.trim(), amount: need(amount, `SAFE ${k + 1} amount`) };
    const c = need(cap, `SAFE ${k + 1} cap`);
    const pct = need(discount, `SAFE ${k + 1} discount`);
    if (c != null) out.cap = c;
    if (pct != null) out.discount = Math.round(pct * 100) / 10000;
    return out;
  });
  const rounds = d.rounds.map((r, k) => ({
    ...r,
    name: r.name.trim(),
    investment: need(r.investment, `Round ${k + 1} raise`),
    pre_money: need(r.pre_money, `Round ${k + 1} pre-money`),
  }));
  const pool = need(d.option_pool_pct, 'Option pool');
  const exit = need(d.exit_value, 'Exit value');
  return {
    errors,
    inputs: {
      founders,
      ...(pool == null ? {} : { option_pool_pct: pool }),
      safes,
      rounds,
      exit_value: exit,
    },
  };
}

/** The route's refusal, as the sentences it carries. */
export function variantSaveErrors(e) {
  const list = e?.data?.errors;
  if (Array.isArray(list) && list.length) return list.map(String);
  if (e?.status === 402) return ['Editing a variant needs the Growth plan.'];
  if (e?.status === 403) return ['You can read this cap table, but not change it.'];
  return [e?.message || 'The variant could not be saved.'];
}

const fmt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v) !== '' ? n.toLocaleString('en-US') : '';
};

const INPUT = 'w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const NR = 'text-xs text-gray-400 dark:text-gray-500';

function Group({ title, cols, children, onAdd, addLabel }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid={`variant-group-${title}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {onAdd ? (
          <button type="button" onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300 dark:hover:underline">
            <Plus size={12} aria-hidden="true" /> {addLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-2 hidden grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:grid">
        {cols.map((c) => <div key={c}>{c}</div>)}<div className="w-6" />
      </div>
      <div className="mt-1 space-y-2">{children}</div>
    </section>
  );
}

function Row({ children, onRemove, label }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
      {children}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}
          className="justify-self-start text-gray-400 hover:text-rose-600 dark:text-gray-500 dark:hover:text-rose-400 sm:justify-self-center">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : <div className="w-6" />}
    </div>
  );
}

/** One variant's editor. Pure over its props, so tests render it directly. */
export function VariantEditor({ draft, setDraft, onSave, saving = false, errors = [], saved = false }) {
  const put = (key, k, field) => (e) => setDraft((d) => ({ ...d, [key]: d[key].map((r, j) => (j === k ? { ...r, [field]: e.target.value } : r)) }));
  const drop = (key, k) => () => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== k) }));
  const add = (key, row) => () => setDraft((d) => ({ ...d, [key]: [...d[key], row] }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave?.(); }} className="space-y-4" data-testid="variant-editor">
      <label className="block">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Variant name</span>
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={`mt-1 ${INPUT}`} maxLength={200} />
      </label>

      <Group title="Founders" cols={['Name', 'Shares', 'Vesting']} onAdd={add('founders', { name: '', shares: '' })} addLabel="Add founder">
        {draft.founders.map((f, k) => (
          <Row key={k} onRemove={drop('founders', k)} label={`founder ${k + 1}`}>
            <input aria-label={`Founder ${k + 1} name`} value={f.name} onChange={put('founders', k, 'name')} className={INPUT} />
            <input aria-label={`Founder ${k + 1} shares`} inputMode="numeric" value={f.shares} onChange={put('founders', k, 'shares')} className={INPUT} />
            <span className={NR}>Not recorded · vesting is not part of a variant</span>
          </Row>
        ))}
        {!draft.founders.length ? <p className={NR}>No founder yet. A variant needs at least one.</p> : null}
      </Group>

      <Group title="Option pool" cols={['Pool', 'Size', 'Granted']}>
        <Row>
          <span className="text-sm text-gray-700 dark:text-gray-300">Option pool</span>
          <label className="flex items-center gap-1">
            <input aria-label="Option pool size, percent" inputMode="decimal" value={draft.option_pool_pct}
              onChange={(e) => setDraft((d) => ({ ...d, option_pool_pct: e.target.value }))} className={INPUT} />
            <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
          </label>
          <span className={NR}>Not recorded · grants are not part of a variant</span>
        </Row>
      </Group>

      <Group title="SAFEs" cols={['Investor', 'Amount', 'Cap · discount']} onAdd={add('safes', { name: '', amount: '', cap: '', discount: '' })} addLabel="Add SAFE">
        {draft.safes.map((s, k) => (
          <Row key={k} onRemove={drop('safes', k)} label={`SAFE ${k + 1}`}>
            <input aria-label={`SAFE ${k + 1} investor`} value={s.name} onChange={put('safes', k, 'name')} className={INPUT} />
            <input aria-label={`SAFE ${k + 1} amount`} inputMode="numeric" value={s.amount} onChange={put('safes', k, 'amount')} className={INPUT} />
            <div className="grid grid-cols-2 gap-2">
              <input aria-label={`SAFE ${k + 1} cap`} placeholder="Cap" inputMode="numeric" value={s.cap} onChange={put('safes', k, 'cap')} className={INPUT} />
              <input aria-label={`SAFE ${k + 1} discount, percent`} placeholder="Discount %" inputMode="decimal" value={s.discount} onChange={put('safes', k, 'discount')} className={INPUT} />
            </div>
          </Row>
        ))}
        {!draft.safes.length ? <p className={NR}>No SAFE in this variant.</p> : null}
      </Group>

      <Group title="Rounds" cols={['Round', 'Raise', 'Pre-money']} onAdd={add('rounds', { name: '', investment: '', pre_money: '' })} addLabel="Add round">
        {draft.rounds.map((r, k) => (
          <Row key={k} onRemove={drop('rounds', k)} label={`round ${k + 1}`}>
            <input aria-label={`Round ${k + 1} name`} value={r.name} onChange={put('rounds', k, 'name')} className={INPUT} />
            <input aria-label={`Round ${k + 1} raise`} inputMode="numeric" value={r.investment} onChange={put('rounds', k, 'investment')} className={INPUT} />
            <input aria-label={`Round ${k + 1} pre-money`} inputMode="numeric" value={r.pre_money} onChange={put('rounds', k, 'pre_money')} className={INPUT} />
          </Row>
        ))}
        {!draft.rounds.length ? <p className={NR}>No priced round in this variant.</p> : null}
      </Group>

      <Group title="Exit value" cols={['Scenario', 'Value', '']}>
        <Row>
          <span className="text-sm text-gray-700 dark:text-gray-300">Exit</span>
          <input aria-label="Exit value" inputMode="numeric" value={draft.exit_value}
            onChange={(e) => setDraft((d) => ({ ...d, exit_value: e.target.value }))} className={INPUT} />
          <span className={NR} data-testid="variant-exit-note">
            {draft.exit_value.trim() === '' ? 'Exit value: none has been set for this variant.' : fmt(draft.exit_value)}
          </span>
        </Row>
      </Group>

      {errors.length ? (
        <ul data-testid="variant-errors" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          {errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving}
          className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500 sm:w-auto">
          {saving ? 'Saving…' : 'Save variant'}
        </button>
        {saved ? <span className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="variant-saved">Saved. The main cap table did not change.</span> : null}
      </div>
    </form>
  );
}

/** The page body, from a finished read. Pure, so each state renders in a test. */
export function CapTableVariantsView({ read, selectedUid, onRetry, onNew, creating = false, newError = '', editor = null }) {
  const head = (
    <div className="space-y-2">
      <Link to={CAP_TABLE_HREF} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 underline dark:text-violet-300">
        <ArrowLeft size={13} aria-hidden="true" /> Cap table
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Draft variants</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Model alternatives without touching the main cap table. The main table stays one per company.</p>
        </div>
        {read.kind === 'ready' && read.projectId != null ? (
          <button type="button" onClick={onNew} disabled={creating} data-testid="variant-new"
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500">
            <Plus size={14} aria-hidden="true" /> {creating ? 'Creating…' : 'New variant'}
          </button>
        ) : null}
      </div>
      {newError ? <p className="text-sm text-rose-700 dark:text-rose-300" data-testid="variant-new-error">{newError}</p> : null}
    </div>
  );

  let body;
  if (read.kind === 'loading') {
    body = <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="variants-loading">Loading variants…</p>;
  } else if (read.kind === 'unreadable') {
    body = (
      <div data-testid="variants-unreadable" className="rounded-xl border border-dashed border-rose-300 p-4 dark:border-rose-800">
        <p className="text-sm text-rose-700 dark:text-rose-300">Variants could not be read just now.</p>
        {read.message ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{read.message}</p> : null}
        <button type="button" onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  } else if (read.kind === 'missing') {
    body = <p className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="variants-missing">{read.message}</p>;
  } else {
    const variants = read.variants || [];
    body = (
      <div className="space-y-4">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Variants" data-testid="variant-tabs">
          {variants.map((v) => (
            <Link key={v.uid} to={variantHref(v.uid)} aria-current={v.uid === selectedUid ? 'page' : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[12.5px] font-semibold ${v.uid === selectedUid ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`}>
              {v.name}
            </Link>
          ))}
          <Link to={CAP_TABLE_HREF} className="whitespace-nowrap rounded-lg px-3 py-2 text-[12.5px] font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
            Main cap table
          </Link>
        </nav>
        {!variants.length ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700" data-testid="variants-empty">
            <p className="text-sm text-gray-600 dark:text-gray-400">No draft variants yet. The main cap table is the only table.</p>
          </div>
        ) : editor || (
          <p className="text-sm text-gray-600 dark:text-gray-400">Choose a variant above to edit it.</p>
        )}
      </div>
    );
  }
  return <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6" data-testid="cap-table-variants">{head}{body}</div>;
}

export default function CapTableVariantsPage({ client = api }) {
  const { variant } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [read, setRead] = useState({ kind: 'loading' });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newError, setNewError] = useState('');

  const load = useCallback(async () => {
    setRead({ kind: 'loading' });
    try {
      let projectId = params.get('project') != null ? Number(params.get('project')) : null;
      let current = null;
      if (variant) {
        current = await client.getCapTableScenario(variant);
        if (!current?.is_variant) {
          setRead({ kind: 'missing', message: 'This is the main cap table, not a draft variant. Edit it on the cap table page.' });
          return;
        }
        projectId = current.project_id;
      }
      if (projectId == null || !Number.isFinite(projectId)) {
        setRead({ kind: 'missing', message: 'Open variants from a startup’s cap table, so this page knows which company they belong to.' });
        return;
      }
      const cmp = await client.getCapTableCompare(projectId);
      setRead({ kind: 'ready', projectId, canonical: cmp?.canonical || null, variants: cmp?.variants || [] });
      if (current) setDraft(draftFromScenario(current));
    } catch (e) {
      if (e?.status === 404) setRead({ kind: 'missing', message: 'This variant does not exist. It may have been deleted.' });
      else setRead({ kind: 'unreadable', message: e?.message || '' });
    }
  }, [client, variant, params]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaved(false);
    const { errors: local, inputs } = inputsFromDraft(draft);
    const name = draft.name.trim();
    if (!name) local.unshift('A variant needs a name.');
    if (local.length) { setErrors(local); return; }
    setSaving(true); setErrors([]);
    try {
      const fresh = await client.updateCapTableScenario(variant, { name, inputs });
      setDraft(draftFromScenario(fresh));
      setRead((r) => (r.kind === 'ready'
        ? { ...r, variants: r.variants.map((v) => (v.uid === fresh.uid ? fresh : v)) }
        : r));
      setSaved(true);
    } catch (e) {
      setErrors(variantSaveErrors(e));
    } finally { setSaving(false); }
  };

  const createVariant = async () => {
    if (read.kind !== 'ready') return;
    if (!read.canonical?.inputs) { setNewError('Record the cap table first'); return; }
    setCreating(true); setNewError('');
    try {
      // A new variant starts from the main table, so it begins as a copy to change.
      const inputs = read.canonical.inputs;
      const made = await client.createCapTableVariant(read.projectId, { name: `Draft variant ${read.variants.length + 1}`, inputs });
      navigate(variantHref(made.uid));
    } catch (e) {
      setNewError(variantSaveErrors(e).join(' '));
    } finally { setCreating(false); }
  };

  const editor = draft && variant ? (
    <VariantEditor draft={draft} setDraft={(f) => { setSaved(false); setDraft(f); }} onSave={save} saving={saving} errors={errors} saved={saved} />
  ) : null;
  return (
    <CapTableVariantsView read={read} selectedUid={variant} onRetry={load} onNew={createVariant}
      creating={creating} newError={newError} editor={editor} />
  );
}
