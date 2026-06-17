// Task #3 — Chapters CRUD. Chapters group items; the worker 409s a delete when
// the chapter still has items, which we surface verbatim.
import React, { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import { Field, TextInput, Textarea, Button, Modal, SectionCard } from './forms';

function ChapterModal({ slug, editing, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    slug: editing?.slug ?? '',
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    display_order: editing?.display_order ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const slugOk = editing || /^[a-z0-9][a-z0-9_-]*$/.test(form.slug);
  const canSave = slugOk && form.title.trim() && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      if (editing) {
        await adminAssessment.updateChapter(editing.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          display_order: Number(form.display_order) || 0,
        });
      } else {
        await adminAssessment.createChapter(slug, {
          slug: form.slug.trim(),
          title: form.title.trim(),
          description: form.description.trim() || null,
          display_order: Number(form.display_order) || 0,
        });
      }
      toast.success(editing ? 'Chapter updated' : 'Chapter created');
      onSaved();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Save failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit chapter · ${editing.slug}` : 'New chapter'}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      )}
    >
      {!editing && (
        <Field label="Slug" required hint="Unique within this game. Create-only.">
          <TextInput value={form.slug} onChange={set('slug')} placeholder="warmup" />
        </Field>
      )}
      <Field label="Title" required>
        <TextInput value={form.title} onChange={set('title')} />
      </Field>
      <Field label="Description">
        <Textarea value={form.description} onChange={set('description')} rows={3} />
      </Field>
      <Field label="Display order">
        <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
      </Field>
    </Modal>
  );
}

export default function ChaptersTab({ slug, detail, reloadDetail, toast }) {
  const chapters = detail?.chapters || [];
  const items = detail?.items || [];
  const [modal, setModal] = useState(null); // { editing } | { editing: null }

  const itemCount = (chapterId) => items.filter((i) => i.chapter_id === chapterId).length;

  const onDelete = async (ch) => {
    if (!window.confirm(`Delete chapter "${ch.title}"? This cannot be undone.`)) return;
    try {
      await adminAssessment.deleteChapter(ch.id);
      toast.success('Chapter deleted');
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
          <Plus className="w-4 h-4" /> Add chapter
        </Button>
      </div>

      {!chapters.length ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center">
          No chapters yet — add the first one.
        </div>
      ) : (
        <SectionCard className="divide-y divide-slate-100 dark:divide-slate-800">
          {chapters.map((ch) => (
            <div key={ch.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-8 text-right">{ch.display_order}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{ch.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <code className="font-mono">{ch.slug}</code> · {itemCount(ch.id)} item{itemCount(ch.id) === 1 ? '' : 's'}
                  {ch.description ? ` · ${ch.description}` : ''}
                </div>
              </div>
              <button
                onClick={() => setModal({ editing: ch })}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Edit"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(ch)}
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
        <ChapterModal slug={slug} editing={modal.editing} onClose={() => setModal(null)} onSaved={onSaved} toast={toast} />
      )}
    </div>
  );
}
