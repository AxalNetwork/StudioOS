import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { draftFromScenario, inputsFromDraft, variantSaveErrors } from './raise/captable/scenariosModel';
import { VariantEditor } from './raise/captable/ScenarioModelEditor';

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

// D1024 (#2861): the form's rules and the editor moved into the Cap table tool's Scenarios,
// which draws them for a scenario that starts from the model; this page reads them from there until part 14 retires it.
export { draftFromScenario, inputsFromDraft, variantSaveErrors } from './raise/captable/scenariosModel';
export { VariantEditor } from './raise/captable/ScenarioModelEditor';

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
