// Task #3 — Overview tab: edit game metadata + lifecycle actions.
import React, { useState, useEffect } from 'react';
import { Save, Send, Archive, GitBranch } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import {
  Field, TextInput, Textarea, Button, SectionCard, StatusBadge, JsonEditor,
} from './forms';
import { stringifyField, parseJsonField } from './jsonFields';

function seedForm(game) {
  return {
    title: game?.title ?? '',
    subtitle: game?.subtitle ?? '',
    description: game?.description ?? '',
    target_role: game?.target_role ?? '',
    track: game?.track ?? '',
    display_order: game?.display_order ?? 0,
  };
}

export default function GameEditor({ game, reloadDetail, reloadGames, toast }) {
  const [form, setForm] = useState(() => seedForm(game));
  const [themeText, setThemeText] = useState(() => stringifyField(game?.theme));
  const [themeValid, setThemeValid] = useState(true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setForm(seedForm(game));
    setThemeText(stringifyField(game?.theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.slug]);

  if (!game) return null;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!themeValid) { toast.error('Fix the theme JSON before saving'); return; }
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setBusy('save');
    try {
      await adminAssessment.updateGame(game.slug, {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        description: form.description.trim() || null,
        target_role: form.target_role.trim() || null,
        track: form.track.trim(),
        display_order: Number(form.display_order) || 0,
        theme: parseJsonField(themeText).value ?? {},
      });
      toast.success('Saved');
      await reloadDetail();
      await reloadGames();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Save failed');
    } finally {
      setBusy('');
    }
  };

  const action = (name, fn, okMsg) => async () => {
    setBusy(name);
    try {
      await fn(game.slug);
      toast.success(okMsg);
      await reloadDetail();
      await reloadGames();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Metadata</h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={game.status} />
            <span className="text-xs text-slate-500 dark:text-slate-400">v{game.version}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug" hint="Create-only — cannot be changed.">
            <TextInput value={game.slug} disabled />
          </Field>
          <Field label="Track">
            <TextInput value={form.track} onChange={set('track')} />
          </Field>
        </div>
        <Field label="Title" required>
          <TextInput value={form.title} onChange={set('title')} />
        </Field>
        <Field label="Subtitle">
          <TextInput value={form.subtitle} onChange={set('subtitle')} />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={set('description')} rows={3} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target role">
            <TextInput value={form.target_role} onChange={set('target_role')} />
          </Field>
          <Field label="Display order">
            <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
          </Field>
        </div>
        <JsonEditor
          label="Theme (JSON)"
          hint="Optional theming payload (colors, art). Leave empty for none."
          value={themeText}
          onChange={setThemeText}
          onValidityChange={setThemeValid}
          rows={5}
        />
        <div>
          <Button onClick={save} disabled={!!busy || !themeValid}>
            <Save className="w-4 h-4" /> {busy === 'save' ? 'Saving…' : 'Save metadata'}
          </Button>
        </div>
      </SectionCard>

      <SectionCard className="p-4 space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">Lifecycle</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Only published games are playable. Bump a version when you change scoring so historical
          results stay interpretable.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="emerald"
            onClick={action('publish', adminAssessment.publishGame, 'Published')}
            disabled={!!busy || game.status === 'published'}
          >
            <Send className="w-4 h-4" /> {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </Button>
          <Button
            variant="ghost"
            onClick={action('archive', adminAssessment.archiveGame, 'Archived')}
            disabled={!!busy || game.status === 'archived'}
          >
            <Archive className="w-4 h-4" /> {busy === 'archive' ? 'Archiving…' : 'Archive'}
          </Button>
          <Button
            variant="ghost"
            onClick={action('version', adminAssessment.versionGame, 'Version bumped')}
            disabled={!!busy}
          >
            <GitBranch className="w-4 h-4" /> {busy === 'version' ? 'Bumping…' : 'New version'}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
