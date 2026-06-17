// Task #3 — Archetypes CRUD. An archetype's `centroid` is the target vector the
// scorer matches a player's result against:
//   { "values": { "founder_risk_appetite": 1.5 }, "skills": { "product": 4 } }
import React, { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import {
  Field, TextInput, Textarea, Button, Modal, SectionCard, JsonEditor,
} from './forms';
import { stringifyField, parseJsonField } from './jsonFields';
import DimensionPalette from './DimensionPalette';

function ArchetypeModal({ slug, editing, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    slug: editing?.slug ?? '',
    label: editing?.label ?? '',
    tagline: editing?.tagline ?? '',
    description: editing?.description ?? '',
    badge_slug: editing?.badge_slug ?? '',
    display_order: editing?.display_order ?? 0,
  });
  const [centroidText, setCentroidText] = useState(
    stringifyField(editing?.centroid ?? { values: {}, skills: {} }),
  );
  const [centroidValid, setCentroidValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const slugOk = editing || /^[a-z0-9][a-z0-9_-]*$/.test(form.slug);
  const canSave = slugOk && form.label.trim() && centroidValid && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const centroid = parseJsonField(centroidText).value ?? {};
    try {
      if (editing) {
        await adminAssessment.updateArchetype(editing.id, {
          label: form.label.trim(),
          tagline: form.tagline.trim() || null,
          description: form.description.trim() || null,
          badge_slug: form.badge_slug.trim() || null,
          display_order: Number(form.display_order) || 0,
          centroid,
        });
      } else {
        await adminAssessment.createArchetype(slug, {
          slug: form.slug.trim(),
          label: form.label.trim(),
          tagline: form.tagline.trim() || null,
          description: form.description.trim() || null,
          badge_slug: form.badge_slug.trim() || null,
          display_order: Number(form.display_order) || 0,
          centroid,
        });
      }
      toast.success(editing ? 'Archetype updated' : 'Archetype created');
      onSaved();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Save failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit archetype · ${editing.slug}` : 'New archetype'}
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
          <Field label="Slug" required hint="Create-only.">
            <TextInput value={form.slug} onChange={set('slug')} placeholder="fo_rocketeer" />
          </Field>
        )}
        <Field label="Label" required>
          <TextInput value={form.label} onChange={set('label')} placeholder="The Rocketeer" />
        </Field>
        <Field label="Badge slug" hint="Optional badge to award.">
          <TextInput value={form.badge_slug} onChange={set('badge_slug')} />
        </Field>
      </div>
      <Field label="Tagline">
        <TextInput value={form.tagline} onChange={set('tagline')} />
      </Field>
      <Field label="Description">
        <Textarea value={form.description} onChange={set('description')} rows={3} />
      </Field>
      <Field label="Display order">
        <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
      </Field>
      <JsonEditor
        label="Centroid (JSON)"
        hint='Target vector — { "values": { dim: −2..2 }, "skills": { axis: 0..5 } }.'
        value={centroidText}
        onChange={setCentroidText}
        onValidityChange={setCentroidValid}
        rows={8}
        palette={<DimensionPalette />}
      />
    </Modal>
  );
}

export default function ArchetypesTab({ slug, detail, reloadDetail, toast }) {
  const archetypes = detail?.archetypes || [];
  const [modal, setModal] = useState(null);

  const onDelete = async (a) => {
    if (!window.confirm(`Delete archetype "${a.label}"?`)) return;
    try {
      await adminAssessment.deleteArchetype(a.id);
      toast.success('Archetype deleted');
      await reloadDetail();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Delete failed');
    }
  };

  const onSaved = async () => { setModal(null); await reloadDetail(); };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setModal({ editing: null })}>
          <Plus className="w-4 h-4" /> Add archetype
        </Button>
      </div>

      {!archetypes.length ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center">
          No archetypes yet. Players need at least one to be assigned an outcome.
        </div>
      ) : (
        <SectionCard className="divide-y divide-slate-100 dark:divide-slate-800">
          {archetypes.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-8 text-right">{a.display_order}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {a.label} <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{a.slug}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {a.tagline || a.description || '—'}
                  {a.badge_slug ? ` · badge: ${a.badge_slug}` : ''}
                </div>
              </div>
              <button
                onClick={() => setModal({ editing: a })}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Edit"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(a)}
                className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </SectionCard>
      )}

      {modal && (
        <ArchetypeModal slug={slug} editing={modal.editing} onClose={() => setModal(null)} onSaved={onSaved} toast={toast} />
      )}
    </div>
  );
}
