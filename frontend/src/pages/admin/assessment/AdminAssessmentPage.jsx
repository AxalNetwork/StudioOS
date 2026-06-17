// Task #3 — Assessment authoring + analytics studio (admin-only).
//
// This whole surface talks ONLY to the worker's /api/admin/assessment routes
// (see lib/api.js::adminAssessment). The dev FastAPI backend does not implement
// them, so expect 404s in the dev preview — the studio is validated by the
// build / drift / dark-mode gates and runs for real on the prod worker.
import React, { useState, useEffect, useCallback } from 'react';
import { Gamepad2, Plus, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import { useToast } from '../../../components/useToast';
import PageExplainer from '../../../components/PageExplainer';
import {
  Field, TextInput, Textarea, Button, Modal, StatusBadge, inputCls,
} from './forms';
import { ASSESSMENT_TRACKS } from './jsonFields';
import GameEditor from './GameEditor';
import ChaptersTab from './ChaptersTab';
import ItemsTab from './ItemsTab';
import ArchetypesTab from './ArchetypesTab';
import BadgesTab from './BadgesTab';
import PreviewTab from './PreviewTab';
import AnalyticsTab from './AnalyticsTab';

const TABS = [
  { id: 'overview', label: 'Overview', scoped: true },
  { id: 'chapters', label: 'Chapters', scoped: true },
  { id: 'items', label: 'Items', scoped: true },
  { id: 'archetypes', label: 'Archetypes', scoped: true },
  { id: 'preview', label: 'Preview', scoped: true },
  { id: 'analytics', label: 'Analytics', scoped: true },
  { id: 'badges', label: 'Badges', scoped: false },
];

function ToastHost({ toast, onDismiss }) {
  if (!toast?.msg) return null;
  const ok = toast.kind === 'success';
  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm">
      <div
        className={`flex items-start gap-2 rounded-lg px-4 py-3 shadow-lg text-sm ${
          ok
            ? 'bg-emerald-600 text-white'
            : 'bg-red-600 text-white'
        }`}
        role="status"
      >
        <span className="flex-1">{toast.msg}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const BLANK_GAME = { slug: '', track: '', title: '', subtitle: '', description: '', target_role: '', display_order: 0 };

function CreateGameModal({ onClose, onCreated, toast }) {
  const [form, setForm] = useState(BLANK_GAME);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const slugOk = /^[a-z0-9][a-z0-9_-]*$/.test(form.slug);
  const canSave = slugOk && form.track.trim() && form.title.trim() && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await adminAssessment.createGame({
        slug: form.slug.trim(),
        track: form.track.trim(),
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        description: form.description.trim() || null,
        target_role: form.target_role.trim() || null,
        display_order: Number(form.display_order) || 0,
      });
      toast.success('Game created');
      onCreated(res?.game?.slug || form.slug.trim());
    } catch (e) {
      toast.error(e?.data?.message || e?.message || 'Create failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New assessment game"
      onClose={onClose}
      wide
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{busy ? 'Creating…' : 'Create game'}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug" required hint="Lowercase, create-only — cannot change later.">
          <TextInput value={form.slug} onChange={set('slug')} placeholder="founder_origin_v1" />
          {!slugOk && form.slug && (
            <div className="text-xs text-red-600 dark:text-red-400 mt-1">a–z, 0–9, - and _ only</div>
          )}
        </Field>
        <Field label="Track" required hint="Stable track key — drives result routing.">
          <input
            list="assessment-tracks"
            value={form.track}
            onChange={(e) => set('track')(e.target.value)}
            className={inputCls}
            placeholder="founder_origin_v1"
          />
          <datalist id="assessment-tracks">
            {ASSESSMENT_TRACKS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Field>
      </div>
      <Field label="Title" required>
        <TextInput value={form.title} onChange={set('title')} placeholder="Founder Origin Story" />
      </Field>
      <Field label="Subtitle">
        <TextInput value={form.subtitle} onChange={set('subtitle')} placeholder="A 5-minute founder profile" />
      </Field>
      <Field label="Description">
        <Textarea value={form.description} onChange={set('description')} rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target role" hint="Optional — who this game is for.">
          <TextInput value={form.target_role} onChange={set('target_role')} placeholder="founder" />
        </Field>
        <Field label="Display order">
          <TextInput type="number" value={form.display_order} onChange={set('display_order')} />
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminAssessmentPage() {
  const toast = useToast();
  const [games, setGames] = useState([]);
  const [gamesErr, setGamesErr] = useState('');
  const [loadingGames, setLoadingGames] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);

  const reloadGames = useCallback(async () => {
    setLoadingGames(true);
    setGamesErr('');
    try {
      const res = await adminAssessment.listGames();
      const list = res?.games || res || [];
      setGames(Array.isArray(list) ? list : []);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      setGamesErr(e?.data?.message || e?.message || 'Failed to load games');
      return [];
    } finally {
      setLoadingGames(false);
    }
  }, []);

  const reloadDetail = useCallback(async (slug) => {
    const s = slug || selectedSlug;
    if (!s) { setDetail(null); return; }
    setLoadingDetail(true);
    setDetailErr('');
    try {
      const res = await adminAssessment.getGame(s);
      setDetail(res);
    } catch (e) {
      setDetailErr(e?.data?.message || e?.message || 'Failed to load game');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    reloadGames().then((list) => {
      if (list.length && !selectedSlug) setSelectedSlug(list[0].slug);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Clear stale detail immediately so scoped tabs never render (or mutate, via
    // id-keyed PUT/DELETE) the previous game's chapters/items/archetypes while
    // the picker already shows a newly-selected slug.
    setDetail(null);
    if (selectedSlug) reloadDetail(selectedSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlug]);

  const onCreated = async (slug) => {
    setShowCreate(false);
    await reloadGames();
    setSelectedSlug(slug);
    setTab('overview');
  };

  // Detail is only usable once it belongs to the current selection — otherwise a
  // game switch would show/mutate the prior game's data through the new slug.
  const detailReady = !!detail?.game && detail.game.slug === selectedSlug;
  const game = detailReady ? detail.game : (games.find((g) => g.slug === selectedSlug) || null);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Gamepad2 className="w-6 h-6 text-violet-600" /> Assessment Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Author the gamified assessments players take — chapters, items, archetypes and badges —
            preview a run without saving, then publish and watch the analytics.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus className="w-4 h-4" /> New game
        </Button>
      </header>

      <PageExplainer pageKey="assessment_admin" />

      {/* Game picker */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400">Game</span>
          <select
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            className={`${inputCls} w-auto min-w-[16rem]`}
            disabled={loadingGames || !games.length}
          >
            {!games.length && <option value="">{loadingGames ? 'Loading…' : 'No games yet'}</option>}
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>{g.title} ({g.slug})</option>
            ))}
          </select>
        </div>
        {game && <StatusBadge status={game.status} />}
        {game?.track && (
          <span className="text-xs text-slate-500 dark:text-slate-400">track: <code className="font-mono">{game.track}</code> · v{game.version}</span>
        )}
        <button
          type="button"
          onClick={() => { reloadGames(); if (selectedSlug) reloadDetail(selectedSlug); }}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 p-1"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loadingGames || loadingDetail ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {gamesErr && (
        <div className="flex items-center gap-2 text-sm rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {gamesErr}
        </div>
      )}

      {/* Tabs */}
      <nav className="border-b border-slate-200 dark:border-slate-700 flex gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id
                ? 'border-violet-600 text-violet-700 dark:text-violet-300 font-medium'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {detailErr && (
        <div className="flex items-center gap-2 text-sm rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {detailErr}
        </div>
      )}

      {tab === 'badges' ? (
        <BadgesTab toast={toast} />
      ) : !selectedSlug || !games.length ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-10 text-center">
          {games.length ? 'Select a game to begin.' : 'No games yet — create your first assessment game.'}
        </div>
      ) : !detailReady ? (
        detailErr ? null : <div className="text-sm text-slate-500 dark:text-slate-400 px-4 py-10 text-center">Loading…</div>
      ) : (
        <>
          {tab === 'overview' && (
            <GameEditor game={detail.game} reloadDetail={() => reloadDetail(selectedSlug)} reloadGames={reloadGames} toast={toast} />
          )}
          {tab === 'chapters' && (
            <ChaptersTab slug={selectedSlug} detail={detail} reloadDetail={() => reloadDetail(selectedSlug)} toast={toast} />
          )}
          {tab === 'items' && (
            <ItemsTab slug={selectedSlug} detail={detail} reloadDetail={() => reloadDetail(selectedSlug)} toast={toast} />
          )}
          {tab === 'archetypes' && (
            <ArchetypesTab slug={selectedSlug} detail={detail} reloadDetail={() => reloadDetail(selectedSlug)} toast={toast} />
          )}
          {tab === 'preview' && (
            <PreviewTab key={selectedSlug} slug={selectedSlug} detail={detail} toast={toast} />
          )}
          {tab === 'analytics' && (
            <AnalyticsTab key={selectedSlug} slug={selectedSlug} toast={toast} />
          )}
        </>
      )}

      {showCreate && (
        <CreateGameModal onClose={() => setShowCreate(false)} onCreated={onCreated} toast={toast} />
      )}

      <ToastHost toast={toast.toast} onDismiss={toast.dismissToast} />
    </div>
  );
}
