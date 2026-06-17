// Task #3 — Badges CRUD. Badges are GLOBAL (not scoped to one game), so this tab
// loads its own list. `criteria` is a free-form JSON rule the engine matches.
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import {
  Field, TextInput, Textarea, Select, Button, Modal, SectionCard, JsonEditor,
} from './forms';
import { stringifyField, parseJsonField, BADGE_KINDS } from './jsonFields';

function BadgeModal({ editing, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    slug: editing?.slug ?? '',
    label: editing?.label ?? '',
    description: editing?.description ?? '',
    kind: editing?.kind ?? 'milestone',
    icon: editing?.icon ?? '',
    xp_reward: editing?.xp_reward ?? 0,
    display_order: editing?.display_order ?? 0,
    is_active: editing ? !!editing.is_active : true,
  });
  const [criteriaText, setCriteriaText] = useState(stringifyField(editing?.criteria ?? {}));
  const [criteriaValid, setCriteriaValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const slugOk = editing || /^[a-z0-9][a-z0-9_-]*$/.test(form.slug);
  const canSave = slugOk && form.label.trim() && criteriaValid && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const criteria = parseJsonField(criteriaText).value ?? {};
    try {
      if (editing) {
        await adminAssessment.updateBadge(editing.slug, {
          label: form.label.trim(),
          description: form.description.trim() || null,
          kind: form.kind,
          icon: form.icon.trim() || null,
          xp_reward: Number(form.xp_reward) || 0,
          display_order: Number(form.display_order) || 0,
          is_active: form.is_active,
          criteria,
        });
      } else {
        await adminAssessment.createBadge({
          slug: form.slug.trim(),
          label: form.label.trim(),
          description: form.description.trim() || null,
          kind: form.kind,
          icon: form.icon.trim() || null,
          xp_reward: Number(form.xp_reward) || 0,
          display_order: Number(form.display_order) || 0,
          criteria,
        });
      }
      toast.success(editing ? 'Badge updated' : 'Badge created');
      onSaved();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Save failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit badge · ${editing.slug}` : 'New badge'}
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
            <TextInput value={form.slug} onChange={set('slug')} placeholder="first_play" />
          </Field>
        )}
        <Field label="Label" required>
          <TextInput value={form.label} onChange={set('label')} />
        </Field>
        <Field label="Kind" required>
          <Select value={form.kind} onChange={set('kind')} options={BADGE_KINDS} />
        </Field>
        <Field label="Icon" hint="lucide icon name (e.g. trophy).">
          <TextInput value={form.icon} onChange={set('icon')} placeholder="trophy" />
        </Field>
        <Field label="XP reward">
          <TextInput type="number" value={form.xp_reward} onChange={set('xp_reward')} />
        </Field>
        <Field label="Display order">
          <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
        </Field>
      </div>
      <Field label="Description">
        <Textarea value={form.description} onChange={set('description')} rows={2} />
      </Field>
      <JsonEditor
        label="Criteria (JSON)"
        hint='Award rule, e.g. { "archetype": "fo_rocketeer" } or { "event": "first_play" }.'
        value={criteriaText}
        onChange={setCriteriaText}
        onValidityChange={setCriteriaValid}
        rows={5}
      />
      {editing && (
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active')(e.target.checked)} />
          Active
        </label>
      )}
    </Modal>
  );
}

export default function BadgesTab({ toast }) {
  const [badges, setBadges] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await adminAssessment.listBadges();
      setBadges(res?.badges || []);
    } catch (e) {
      setErr(e?.data?.message || e?.message || 'Failed to load badges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const onDelete = async (b) => {
    if (!window.confirm(`Delete badge "${b.label}"?`)) return;
    try {
      await adminAssessment.deleteBadge(b.slug);
      toast.success('Badge deleted');
      await reload();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Delete failed');
    }
  };

  const onSaved = async () => { setModal(null); await reload(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Badges are shared across every game. Archetype badges are awarded by an archetype's
          <code className="font-mono mx-1">badge_slug</code>; milestone/event badges by their criteria.
        </p>
        <Button onClick={() => setModal({ editing: null })} className="shrink-0">
          <Plus className="w-4 h-4" /> Add badge
        </Button>
      </div>

      {err && (
        <div className="flex items-center gap-2 text-sm rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 px-4 py-8 text-center">Loading…</div>
      ) : !badges.length ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center">
          No badges yet.
        </div>
      ) : (
        <SectionCard className="divide-y divide-slate-100 dark:divide-slate-800">
          {badges.map((b) => (
            <div key={b.slug} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-8 text-right">{b.display_order}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                  {b.label}
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{b.kind}</span>
                  {!b.is_active && <span className="text-[11px] text-amber-600 dark:text-amber-400">inactive</span>}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  <code className="font-mono">{b.slug}</code>
                  {b.xp_reward ? ` · ${b.xp_reward} XP` : ''}
                  {b.icon ? ` · ${b.icon}` : ''}
                </div>
              </div>
              <button
                onClick={() => setModal({ editing: b })}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Edit"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(b)}
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
        <BadgeModal editing={modal.editing} onClose={() => setModal(null)} onSaved={onSaved} toast={toast} />
      )}
    </div>
  );
}
