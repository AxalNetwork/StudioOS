/**
 * D1250 (#3265, DDL13) — Templates, from D1249's store (`GET /api/dd/templates`).
 * A card per depth (Lite, Standard, Deep) with its version, sections and
 * items; the chosen depth's table: each section's weight and its share of the
 * total, whether it blocks, and the items it seeds at each depth.
 *
 * WHO EDITS. The Worker says (`can_edit`): a Super Admin on HQ edits weights
 * and blocking and saves the next version (`POST /api/dd/templates`), which
 * applies to new cases only. Anyone else reads the same table, with the
 * canvas's one sentence: "HQ edits templates. You choose one when you open a
 * case." No disabled control stands in for the editor.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ddDeskApi } from '../../lib/api';
import { reportError } from '../../lib/log';
import { TEMPLATES_NOTE, depthWord, templateBody, templateCard, templateDraftState, weightShares } from './ddListModel.js';
import { Dialog, Note, Refusal, btnCls, cardCls, eyebrowCls, inputCls, muted, primaryCls, useSend } from './DdUi.jsx';

function SaveDialog({ depth, current, draft, changes, onClose, onSaved }) {
  const { busy, error, send } = useSend();
  const next = current.built_in ? 1 : Number(current.version) + 1;
  const submit = () => send(async () => {
    const r = await ddDeskApi.saveTemplate(depth, templateBody(depth, current, draft).sections);
    onSaved(r?.template);
  }, 'The template could not be saved.');
  return (
    <Dialog title={`Save ${depthWord(depth)} as version v${next}`} testId="dd-template-save" onClose={onClose} onSubmit={submit} action="Save as new version" busy={busy}>
      <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] text-gray-800 dark:text-gray-200" data-testid="dd-template-changes">
        {changes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p className={`m-0 text-[12.5px] ${muted}`}>A new version applies to new cases. Open cases keep theirs. Every studio opens {depthWord(depth)} cases with it from now on.</p>
      <Refusal text={error} testId="dd-template-save-error" />
    </Dialog>
  );
}

export default function DdTemplates() {
  const [read, setRead] = useState(null);
  const [depth, setDepth] = useState('standard');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(null);

  const load = useCallback(async () => {
    setRead(null);
    try { setRead(await ddDeskApi.templates()); } catch (e) {
      reportError('DdTemplates:read', e);
      setRead({ failed: true });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const t = read?.templates?.find((x) => x.depth === depth);
  const current = t?.current || null;
  useEffect(() => {
    setDraft(current ? current.sections.map((s) => ({ key: s.key, title: s.title, weight: String(s.weight), blocking: s.blocking })) : null);
    setProblem(null);
  }, [current]);

  if (!read) return <p className={`m-0 text-[13px] ${muted}`} data-testid="dd-templates-loading">Reading the templates…</p>;
  if (read.failed) {
    return (
      <div className={`${cardCls} flex flex-col items-start gap-2 p-5`} data-testid="dd-templates-failed">
        <p className="m-0 text-[14px] font-bold text-gray-900 dark:text-gray-100">The templates could not be read.</p>
        <p className={`m-0 text-[12.5px] ${muted}`}>This is not an empty store: the built-in catalog still opens cases.</p>
        <button type="button" className={btnCls} onClick={load}>Try again</button>
      </div>
    );
  }
  const edit = read.can_edit === true;
  const rows = edit && draft ? draft : (current?.sections || []);
  const shares = weightShares(rows);
  const state = edit && draft && current ? templateDraftState(current, draft) : null;
  const sum = (k) => (current?.sections || []).reduce((a, s) => a + (s.by_depth?.[k] || 0), 0);

  return (
    <div className="flex flex-col gap-4" data-testid="dd-templates">
      {edit
        ? <p className={`m-0 text-[13px] ${muted}`} data-testid="dd-templates-hq">The diligence checklists every studio uses. Weights and blocking sections drive the indicative risk.</p>
        : <Note testId="dd-templates-readonly">{TEMPLATES_NOTE}</Note>}
      <div className="grid gap-3 md:grid-cols-3">
        {read.templates.map((x) => {
          const c = templateCard(x);
          const on = x.depth === depth;
          return (
            <button key={x.depth} type="button" aria-pressed={on} onClick={() => setDepth(x.depth)} data-testid={`dd-template-card-${x.depth}`}
              className={`${cardCls} p-4 text-left ${on ? 'ring-2 ring-violet-500 dark:ring-violet-400' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <span className="flex items-baseline justify-between">
                <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100">{c.name}</span>
                <span className={`font-mono text-[12px] ${muted}`}>{c.version}</span>
              </span>
              <span className={`mt-1 block text-[12.5px] ${muted}`}>{c.counts}</span>
              <span className={`block text-[12.5px] ${muted}`}>{c.blurb}</span>
            </button>
          );
        })}
      </div>

      {current ? (
        <section className={`${cardCls} p-4`} data-testid="dd-template-table">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-[15px] font-bold text-gray-900 dark:text-gray-100">{depthWord(depth)} · {current.built_in ? 'the built-in version' : `version v${current.version}`}</h3>
            {current.created_by_name ? <span className={`text-[12.5px] ${muted}`}>Saved by {current.created_by_name}</span> : null}
            {edit && state && !state.error ? <span className={`text-[12.5px] ${muted}`} data-testid="dd-template-draft">Editing a draft of v{current.built_in ? 1 : Number(current.version) + 1}</span> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-[#faf9fc] dark:bg-gray-800/60">
                  {['Section', 'Weight', 'Share', 'Blocking', 'Lite items', 'Standard items', 'Deep items'].map((h) => <th key={h} scope="col" className={`px-3 py-2.5 ${eyebrowCls}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const src = current.sections.find((x) => x.key === s.key) || {};
                  return (
                    <tr key={s.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`dd-template-row-${s.key}`}>
                      <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-gray-100">{s.title}</td>
                      <td className="px-3 py-2.5">
                        {edit ? (
                          <input aria-label={`Weight of ${s.title}`} inputMode="decimal" className={`${inputCls.replace('w-full', 'w-20')} font-mono`} value={s.weight}
                            onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                        ) : <span className="font-mono">{s.weight}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono">{shares[i] == null ? '—' : `${shares[i]}%`}</td>
                      <td className="px-3 py-2.5">
                        {edit ? (
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" role="switch" aria-checked={Boolean(s.blocking)} checked={Boolean(s.blocking)}
                              onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, blocking: e.target.checked } : x)))} />
                            <span className="sr-only">{s.title} blocks</span>
                          </label>
                        ) : (s.blocking ? <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">Blocking</span> : <span className={muted}>—</span>)}
                      </td>
                      <td className="px-3 py-2.5 font-mono">{src.by_depth?.lite ?? 0}</td>
                      <td className="px-3 py-2.5 font-mono">{src.by_depth?.standard ?? 0}</td>
                      <td className="px-3 py-2.5 font-mono">{src.by_depth?.deep ?? 0}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-axal-hairline font-bold dark:border-gray-800">
                  <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100">Total</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-mono">{shares.some((x) => x == null) ? '—' : '100%'}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-mono">{sum('lite')}</td>
                  <td className="px-3 py-2.5 font-mono">{sum('standard')}</td>
                  <td className="px-3 py-2.5 font-mono">{sum('deep')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={`m-0 mt-2 text-[12px] ${muted}`}>The items a template seeds are the catalog’s; a template chooses them and never rewrites them.</p>
          {edit ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className={`text-[12.5px] ${muted}`}>A new version applies to new cases. Open cases keep theirs.</span>
              <button type="button" className={primaryCls} data-testid="dd-template-save-open"
                onClick={() => { const st = templateDraftState(current, draft); if (st.error) setProblem(st.error); else { setProblem(null); setSaving(true); } }}>
                Save as new version
              </button>
            </div>
          ) : null}
          <Refusal text={problem} testId="dd-template-problem" />
          {saved ? <p className="m-0 mt-2 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="dd-template-saved">{saved}</p> : null}
          {t?.versions?.length ? (
            <p className={`m-0 mt-3 text-[12px] ${muted}`} data-testid="dd-template-versions">
              Versions: {t.versions.map((v) => (v.built_in ? 'built-in' : `v${v.version}${v.created_by_name ? ` by ${v.created_by_name}` : ''}`)).join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {saving && current && state ? (
        <SaveDialog depth={depth} current={current} draft={draft} changes={state.changed} onClose={() => setSaving(false)}
          onSaved={(tpl) => { setSaving(false); setSaved(`${depthWord(depth)} version v${tpl?.version ?? ''} is saved. New cases open with it.`); load(); }} />
      ) : null}
    </div>
  );
}
