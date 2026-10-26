import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * D632, moved here by D1024 (#2861) — the editor for a scenario that starts
 * from the model (a draft variant typed by hand: founders, option pool, SAFEs,
 * rounds and an exit value), edited in place and saved through
 * `PUT /api/captable/scenarios/:uid`. A scenario that starts from Today edits
 * its rounds, the instruments that convert and its exits instead
 * (`ScenarioPage.jsx`). The draft's rules live in `scenariosModel.js`.
 */

const INPUT = 'w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200';
const NR = 'text-xs text-gray-400 dark:text-gray-500';

const fmt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v) !== '' ? n.toLocaleString('en-US') : '';
};


function Group({ title, cols, children, onAdd, addLabel }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`variant-group-${title}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-200">{title}</h2>
        {onAdd ? (
          <button type="button" onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-400 dark:hover:underline">
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
          className="justify-self-start text-gray-400 hover:text-rose-600 dark:text-gray-500 dark:hover:text-red-400 sm:justify-self-center">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : <div className="w-6" />}
    </div>
  );
}

/** One variant's editor. Pure over its props, so tests render it directly. */
/** `naming: false` leaves the name out: Scenarios renames in a dialog (D1024). */
export function VariantEditor({ draft, setDraft, onSave, saving = false, errors = [], saved = false, naming = true }) {
  const put = (key, k, field) => (e) => setDraft((d) => ({ ...d, [key]: d[key].map((r, j) => (j === k ? { ...r, [field]: e.target.value } : r)) }));
  const drop = (key, k) => () => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== k) }));
  const add = (key, row) => () => setDraft((d) => ({ ...d, [key]: [...d[key], row] }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave?.(); }} className="space-y-4" data-testid="variant-editor">
      {naming ? (
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Variant name</span>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={`mt-1 ${INPUT}`} maxLength={200} />
        </label>
      ) : null}

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
        <ul data-testid="variant-errors" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-red-400/50 dark:bg-red-400/10 dark:text-red-400">
          {errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving}
          className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:hover:bg-violet-500 sm:w-auto">
          {saving ? 'Saving…' : naming ? 'Save variant' : 'Save scenario'}
        </button>
        {saved ? <span className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="variant-saved">Saved. The main cap table did not change.</span> : null}
      </div>
    </form>
  );
}

