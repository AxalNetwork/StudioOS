/**
 * D5897 (#5897, part 1 (b) of #5026) — the Axal VC package draft editor (board L29's "Create draft version…" and
 * "Edit draft"). One dialog, three modes:
 *   - `mode: 'new'`: a new package key's draft v1 (`POST /api/admin/licence-packages`), with its key;
 *   - `mode: 'next'`: the key's next draft version (`POST /:key/versions`), starting from its newest version;
 *   - `mode: 'edit'`: a draft's own fields and programs (`PUT /:key/versions/:version`).
 * The page opens it only on a Draft row for `edit`; the Worker also refuses an active or retired version, and that
 * refusal is shown here in its own words.
 *
 * Programs are typed as registry keys, one per line, in the order the version lists them: no client reads the
 * program registry's names yet (D5896 §2). A program already on the version keeps its default flag and metadata.
 *
 * A refusal keeps the dialog open with what was typed, and lists the Worker's sentence and each field it named.
 * Any other failure says the outcome is not known; the page reads the catalogue again either way.
 */
import React, { useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { bodyFrom, writeFailure } from './packageDraftModel';

const FIELD = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'block text-[12.5px] font-semibold text-gray-800 dark:text-gray-200';
const HINT = 'mt-0.5 block text-[11.5px] font-normal text-gray-500 dark:text-gray-400';

function Text({ label, hint, value, onChange, mono = false, type = 'text', rows }) {
  return (
    <label className={LABEL}>
      {label}
      {rows
        ? <textarea className={`${FIELD} ${mono ? 'font-mono' : ''}`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className={`${FIELD} ${mono ? 'font-mono' : ''}`} type={type} value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint ? <span className={HINT}>{hint}</span> : null}
    </label>
  );
}

const TITLES = { new: 'Create a new Axal VC package', next: 'Create draft version', edit: 'Edit draft' };

/**
 * `target`: `{ mode, packageKey?, version?, nextVersion?, name? }`. `initial`: the form (`formFrom`).
 * `save(body)` is the client call; `onSaved(pkg)` and `onClose()` are the page's.
 */
export default function PackageDraftEditor({ target, initial, save, onSaved, onClose }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const title = TITLES[target.mode];
  const which = target.mode === 'edit' ? `${target.name} v${target.version}`
    : target.mode === 'next' ? `${target.name} v${target.nextVersion}` : 'v1 of a new package key';

  async function submit() {
    const built = bodyFrom(form, { withKey: target.mode === 'new' });
    if (!built.ok) { setProblem({ refused: true, title: 'Fix these before saving.', lines: Object.values(built.errors) }); return; }
    setBusy(true); setProblem(null);
    try {
      const r = await save(built.body);
      onSaved(r?.package || null);
    } catch (e) {
      setProblem(writeFailure(e, 'Saving the draft'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Lightbox
      label={title} title={title} onClose={onClose} width={560} testId="package-draft-editor"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} data-testid="package-draft-save"
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="package-draft-which">
          {which}. A draft is not offered to anyone until it is published; once published it is frozen.
        </p>
        {problem ? (
          <div role="alert" data-testid="package-draft-problem"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <b>{problem.title}</b>
            <ul className="m-0 mt-1 list-disc pl-5">{problem.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        ) : null}
        {target.mode === 'new'
          ? <Text label="Package key" hint="Lower-case letters, digits, hyphens or underscores. It never changes." value={form.package_key} onChange={set('package_key')} mono />
          : null}
        <Text label="Name" hint="Copy says “Axal VC package”, never a bare “package plan”." value={form.name} onChange={set('name')} />
        <Text label="Description" value={form.description} onChange={set('description')} rows={2} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Text label="Currency" hint="ISO 4217, such as EUR." value={form.currency} onChange={set('currency')} mono />
          <Text label="Global base annual fee" hint="In the currency above, such as 10000." value={form.base} onChange={set('base')} />
          <Text label="Guidance from" hint="Optional." value={form.guidance_min} onChange={set('guidance_min')} />
          <Text label="Guidance to" hint="Optional." value={form.guidance_max} onChange={set('guidance_max')} />
          <Text label="Floor multiplier" hint="Optional, such as 0.8." value={form.floor} onChange={set('floor')} />
          <Text label="Ceiling multiplier" hint="Optional, such as 1.2." value={form.ceiling} onChange={set('ceiling')} />
          <Text label="Effective from" hint="YYYY-MM-DD." value={form.effective_from} onChange={set('effective_from')} mono />
          <Text label="Effective to" hint="Optional, YYYY-MM-DD." value={form.effective_to} onChange={set('effective_to')} mono />
        </div>
        <Text label="Programs" hint="Program keys, one per line, in the order the package lists them." value={form.programs} onChange={set('programs')} rows={5} mono />
      </div>
    </Lightbox>
  );
}
