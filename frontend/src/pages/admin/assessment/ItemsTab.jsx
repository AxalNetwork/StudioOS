// Task #3 — Items CRUD. The most involved editor: per-mechanic option payloads,
// a measures picker (which value/skill dimensions the item touches), optional
// item-level loads, and config. The *scored* per-option weights live inside the
// options JSON as `option.loads = { dimKey: number }` — the DimensionPalette
// gives the valid keys.
import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import {
  Field, TextInput, Textarea, Select, Button, Modal, SectionCard, JsonEditor,
} from './forms';
import {
  stringifyField, parseJsonField, normaliseMeasures,
  MECHANICS_LIST, MECHANIC_OPTION_TEMPLATES, MECHANIC_CONFIG_TEMPLATES,
  DIMENSION_KEYS, dimensionLabel,
} from './jsonFields';
import DimensionPalette from './DimensionPalette';

function MeasuresPicker({ value, onChange }) {
  const measures = normaliseMeasures(value);
  const toggle = (kind, key) => {
    const cur = new Set(measures[kind]);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    onChange({ ...measures, [kind]: [...cur] });
  };
  return (
    <div className="space-y-2">
      {(['values', 'skills']).map((kind) => (
        <div key={kind}>
          <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
            {kind === 'values' ? 'Value spectrums' : 'Skill axes'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DIMENSION_KEYS[kind].map((key) => {
              const on = measures[kind].includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(kind, key)}
                  className={`text-xs px-2 py-1 rounded-full border transition ${
                    on
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                  title={key}
                >
                  {dimensionLabel(kind, key)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemModal({ slug, chapters, editing, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    slug: editing?.slug ?? '',
    chapterId: editing?.chapter_id ?? (chapters[0]?.id ?? ''),
    mechanic: editing?.mechanic ?? 'dilemma',
    prompt: editing?.prompt ?? '',
    subprompt: editing?.subprompt ?? '',
    display_order: editing?.display_order ?? 0,
    is_active: editing ? !!editing.is_active : true,
  });
  const [measures, setMeasures] = useState(normaliseMeasures(editing?.measures));
  const [optionsText, setOptionsText] = useState(
    stringifyField(editing?.options ?? MECHANIC_OPTION_TEMPLATES.dilemma),
  );
  const [configText, setConfigText] = useState(
    stringifyField(editing?.config ?? MECHANIC_CONFIG_TEMPLATES.dilemma),
  );
  const [loadsText, setLoadsText] = useState(stringifyField(editing?.loads ?? {}));
  const [valid, setValid] = useState({ options: true, config: true, loads: true });
  const [busy, setBusy] = useState(false);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setV = (k) => (ok) => setValid((s) => (s[k] === ok ? s : { ...s, [k]: ok }));
  const slugOk = editing || /^[a-z0-9][a-z0-9_-]*$/.test(form.slug);
  const allValid = valid.options && valid.config && valid.loads;
  const canSave = slugOk && form.prompt.trim() && form.mechanic && (editing || form.chapterId) && allValid && !busy;

  const loadTemplate = () => {
    setOptionsText(stringifyField(MECHANIC_OPTION_TEMPLATES[form.mechanic] ?? {}));
    setConfigText(stringifyField(MECHANIC_CONFIG_TEMPLATES[form.mechanic] ?? {}));
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const payload = {
      mechanic: form.mechanic,
      prompt: form.prompt.trim(),
      subprompt: form.subprompt.trim() || null,
      display_order: Number(form.display_order) || 0,
      options: parseJsonField(optionsText).value ?? {},
      config: parseJsonField(configText).value ?? {},
      loads: parseJsonField(loadsText).value ?? {},
      measures,
    };
    try {
      if (editing) {
        await adminAssessment.updateItem(editing.id, { ...payload, is_active: form.is_active });
      } else {
        await adminAssessment.createItem(slug, {
          ...payload,
          slug: form.slug.trim(),
          chapterId: Number(form.chapterId),
        });
      }
      toast.success(editing ? 'Item updated' : 'Item created');
      onSaved();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Save failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit item · ${editing.slug}` : 'New item'}
      onClose={onClose}
      wide
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        {!editing && (
          <>
            <Field label="Slug" required hint="Create-only.">
              <TextInput value={form.slug} onChange={set('slug')} placeholder="q_risk_1" />
            </Field>
            <Field label="Chapter" required>
              <Select
                value={String(form.chapterId)}
                onChange={(v) => set('chapterId')(v)}
                options={chapters.map((c) => ({ value: String(c.id), label: c.title }))}
                includeBlank={!chapters.length}
                blankLabel="— no chapters —"
              />
            </Field>
          </>
        )}
        <Field label="Mechanic" required>
          <Select value={form.mechanic} onChange={set('mechanic')} options={MECHANICS_LIST} />
        </Field>
        <Field label="Display order">
          <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
        </Field>
      </div>
      <Field label="Prompt" required>
        <Textarea value={form.prompt} onChange={set('prompt')} rows={2} />
      </Field>
      <Field label="Subprompt">
        <TextInput value={form.subprompt} onChange={set('subprompt')} />
      </Field>

      <Field label="Measures" hint="Which dimensions this item informs (drives coverage analytics).">
        <MeasuresPicker value={measures} onChange={setMeasures} />
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Options payload</span>
        <Button variant="ghost" size="sm" onClick={loadTemplate} type="button">
          <Sparkles className="w-3.5 h-3.5" /> Load {form.mechanic} template
        </Button>
      </div>
      <JsonEditor
        hint='Each choice carries per-option weights: { "loads": { "founder_risk_appetite": 1 } }.'
        value={optionsText}
        onChange={setOptionsText}
        onValidityChange={setV('options')}
        rows={10}
        palette={<DimensionPalette />}
      />
      <JsonEditor
        label="Config payload"
        hint="Per-mechanic tunables (speed: timer_ms · allocation: total · card_sort: pick_n)."
        value={configText}
        onChange={setConfigText}
        onValidityChange={setV('config')}
        rows={4}
      />
      <JsonEditor
        label="Item-level loads (optional)"
        hint="Magnitude hints. The base scorer uses per-option loads above — leave {} unless needed."
        value={loadsText}
        onChange={setLoadsText}
        onValidityChange={setV('loads')}
        rows={3}
      />
      {editing && (
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active')(e.target.checked)} />
          Active (inactive items are skipped in play + preview)
        </label>
      )}
    </Modal>
  );
}

export default function ItemsTab({ slug, detail, reloadDetail, toast }) {
  const chapters = detail?.chapters || [];
  const items = detail?.items || [];
  const [modal, setModal] = useState(null);

  const onDelete = async (it) => {
    if (!window.confirm(`Delete item "${it.slug}"? If it has been answered it will be deactivated instead.`)) return;
    try {
      const res = await adminAssessment.deleteItem(it.id);
      toast.success(res?.deactivated ? 'Item deactivated (had answers)' : 'Item deleted');
      await reloadDetail();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Delete failed');
    }
  };

  const onSaved = async () => { setModal(null); await reloadDetail(); };

  // Group items by chapter, preserving chapter order then item order.
  const grouped = chapters.map((c) => ({
    chapter: c,
    items: items.filter((i) => i.chapter_id === c.id),
  }));
  const orphan = items.filter((i) => !chapters.some((c) => c.id === i.chapter_id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {chapters.length ? 'Add decision items to a chapter.' : 'Create a chapter first — items must belong to one.'}
        </p>
        <Button onClick={() => setModal({ editing: null })} disabled={!chapters.length} className="shrink-0">
          <Plus className="w-4 h-4" /> Add item
        </Button>
      </div>

      {!items.length ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center">
          No items yet.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.filter((g) => g.items.length).map(({ chapter, items: list }) => (
            <div key={chapter.id}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                {chapter.title}
              </div>
              <SectionCard className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((it) => (
                  <ItemRow key={it.id} it={it} onEdit={() => setModal({ editing: it })} onDelete={() => onDelete(it)} />
                ))}
              </SectionCard>
            </div>
          ))}
          {orphan.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                Unassigned chapter
              </div>
              <SectionCard className="divide-y divide-slate-100 dark:divide-slate-800">
                {orphan.map((it) => (
                  <ItemRow key={it.id} it={it} onEdit={() => setModal({ editing: it })} onDelete={() => onDelete(it)} />
                ))}
              </SectionCard>
            </div>
          )}
        </div>
      )}

      {modal && (
        <ItemModal
          slug={slug}
          chapters={chapters}
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={onSaved}
          toast={toast}
        />
      )}
    </div>
  );
}

function ItemRow({ it, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-8 text-right">{it.display_order}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{it.prompt}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{it.mechanic}</span>
          <code className="font-mono">{it.slug}</code>
          {!it.is_active && <span className="text-amber-600 dark:text-amber-400">inactive</span>}
        </div>
      </div>
      <button onClick={onEdit} className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Edit">
        <Pencil className="w-4 h-4" />
      </button>
      <button onClick={onDelete} className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Delete">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
