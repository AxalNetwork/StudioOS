import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Upload, Sparkles, Save, Download, Trash2,
  RefreshCw, AlertCircle, Check, ChevronRight, ArrowUp, ArrowDown, Plus,
  Clipboard, ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';

// Pitch Deck Reviewer — upload a PDF/DOC/DOCX/PPTX, extract text via Cloudflare
// document conversion, map into standard deck sections, and generate an honest
// investor-style review. Everything is editable; the review can be regenerated.
// Backend: cloudflare-worker/src/routes/deck_reviewer.ts + services/deckExtract.ts.

const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl';
const INPUT = 'w-full border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-400/40';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const BTN_GHOST = 'inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-sm px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';

const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md';
const MAX_MB = 20;

function getCsrf() {
  const cookie = typeof document !== 'undefined' ? document.cookie || '' : '';
  for (const part of cookie.split(';')) {
    const t = part.trim();
    const eq = t.indexOf('=');
    if (eq > -1 && t.slice(0, eq) === 'studioos_csrf') return t.slice(eq + 1);
  }
  return '';
}

// XHR upload so we can show real upload progress (the fetch-based api helper
// can't report upload progress).
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const token = localStorage.getItem('token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const csrf = getCsrf();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid server response')); }
      } else {
        let msg = 'Upload failed';
        try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || msg; } catch { /* noop */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const link = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = link; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(link);
}

async function fetchMarkdown(url) {
  const token = localStorage.getItem('token');
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  return res.text();
}

export default function DeckReviewerPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [past, setPast] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [review, setReview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [projs, list] = await Promise.all([
        api.listProjects().catch(() => []),
        api.deckReviewer.list().catch(() => ({ reviews: [] })),
      ]);
      if (!alive) return;
      const ps = Array.isArray(projs) ? projs : projs?.projects || [];
      setProjects(ps);
      if (ps.length) setProjectId(String(ps[0].id));
      setPast(list?.reviews || []);
    })();
    return () => { alive = false; };
  }, []);

  async function refreshList() {
    const list = await api.deckReviewer.list().catch(() => null);
    if (list) setPast(list.reviews || []);
  }

  function validate(file) {
    if (!file) return 'No file selected.';
    if (file.size > MAX_MB * 1024 * 1024) return `File exceeds the ${MAX_MB} MB limit.`;
    const ok = /\.(pdf|docx?|pptx?|txt|md)$/i.test(file.name);
    if (!ok) return 'Unsupported file type. Use PDF, DOC, DOCX, PPT or PPTX.';
    return '';
  }

  async function handleFile(file) {
    const v = validate(file);
    if (v) { setError(v); return; }
    setError(''); setStatus(''); setReview(null);
    setPhase('uploading'); setProgress(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (projectId) fd.append('project_id', projectId);
      const result = await uploadWithProgress('/api/deck-reviewer/upload', fd, (p) => {
        setProgress(p);
        if (p >= 100) setPhase('processing');
      });
      setReview(result);
      setDirty(false);
      if (result.extraction_status === 'failed' || result.status === 'needs_manual') {
        setError('Automatic text extraction failed (scanned or unsupported PDF). Paste your deck text below to continue.');
        setShowPaste(true);
      } else {
        setStatus('Review generated.');
      }
      refreshList();
    } catch (e) {
      setError(e.message || 'Upload failed.');
    } finally {
      setPhase('idle'); setProgress(0);
    }
  }

  async function handlePaste() {
    if (!pasteText.trim()) { setError('Paste some deck text first.'); return; }
    setError(''); setStatus(''); setPhase('processing');
    try {
      const result = await api.deckReviewer.paste({ text: pasteText, project_id: projectId || undefined, filename: 'Pasted deck' });
      setReview(result);
      setShowPaste(false);
      setPasteText('');
      setDirty(false);
      setStatus('Review generated from pasted text.');
      refreshList();
    } catch (e) {
      setError(e.message || 'Could not process pasted text.');
    } finally {
      setPhase('idle');
    }
  }

  async function loadReview(id) {
    setError('');
    try {
      const full = await api.deckReviewer.get(id);
      setReview(full);
      setDirty(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message || 'Failed to load review.'); }
  }

  async function onSave() {
    if (!review) return;
    setSaving(true); setError('');
    try {
      const full = await api.deckReviewer.save(review.id, { title: review.title, sections: review.sections, review: review.review });
      setReview(full); setDirty(false); setStatus('Saved.');
    } catch (e) { setError(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  }

  async function onRegenerate() {
    if (!review) return;
    setPhase('processing'); setError('');
    try {
      const full = await api.deckReviewer.regenerate(review.id);
      setReview(full); setDirty(false); setStatus('Review regenerated.');
    } catch (e) { setError(e.message || 'Regenerate failed.'); }
    finally { setPhase('idle'); }
  }

  async function onPurgeRaw() {
    if (!review) return;
    try {
      await api.deckReviewer.purgeRaw(review.id);
      setReview((p) => ({ ...p, raw_retained: false }));
      setStatus('Raw file purged from storage.');
    } catch (e) { setError(e.message || 'Could not purge raw file.'); }
  }

  const busy = phase !== 'idle';

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-3">
        <ArrowLeft size={16} /> Back
      </button>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Pitch deck reviewer</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 max-w-2xl">
        Upload your existing pitch deck (PDF, DOC, DOCX or PPTX, max {MAX_MB}MB). Our AI plays a seed-stage VC and gives you blunt, specific feedback grounded in your startup&apos;s data.
      </p>

      {!projects.length && (
        <div className={`${CARD} p-4 mb-4 text-center text-sm text-gray-700 dark:text-gray-300`}>
          You don&apos;t have a startup yet — reviews are sharper with one.{' '}
          <Link to="/projects" className="text-orange-600 dark:text-orange-400 font-semibold">Create one →</Link>
          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-1">You can still upload a deck below without a startup.</span>
        </div>
      )}

      {projects.length > 0 && !review && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Ground the review in a startup (optional)</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${INPUT} max-w-sm`}>
            <option value="">No startup</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      )}

      {/* Upload zone */}
      {!review && (
        <div className={`${CARD} p-6`}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }}
            onClick={() => !busy && fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30' : 'border-gray-300 dark:border-gray-700 hover:border-orange-300'}`}
          >
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {busy ? (
              <div>
                <Loader2 size={28} className="animate-spin text-orange-500 mx-auto mb-2" />
                <div className="text-sm text-gray-700 dark:text-gray-300">{phase === 'uploading' ? `Uploading… ${progress}%` : 'Extracting text & generating review…'}</div>
                {phase === 'uploading' && (
                  <div className="mt-3 h-1.5 w-48 mx-auto rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="h-11 w-11 rounded-full bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center mx-auto mb-2">
                  <Upload size={20} className="text-orange-600 dark:text-orange-400" />
                </div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Drop your deck here or click to browse</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">PDF, DOC, DOCX, PPT, PPTX · max {MAX_MB}MB</div>
              </div>
            )}
          </div>

          <div className="mt-3 text-center">
            <button onClick={() => setShowPaste((v) => !v)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 inline-flex items-center gap-1">
              <Clipboard size={14} /> Paste deck text instead
            </button>
          </div>

          {showPaste && (
            <div className="mt-3">
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} placeholder="Paste your full pitch deck text here…" className={INPUT} />
              <div className="mt-2 flex justify-end">
                <button onClick={handlePaste} disabled={busy || !pasteText.trim()} className={BTN_PRIMARY}>
                  {phase === 'processing' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Review pasted text
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {status && !error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check size={16} /> {status}
        </div>
      )}

      {review && review.status !== 'needs_manual' && (
        <ReviewView
          review={review}
          setReview={(r) => { setReview(r); setDirty(true); }}
          dirty={dirty}
          saving={saving}
          busy={busy}
          onSave={onSave}
          onRegenerate={onRegenerate}
          onPurgeRaw={onPurgeRaw}
          onReset={() => { setReview(null); setError(''); setStatus(''); }}
        />
      )}

      {/* Manual paste fallback surfaced after a failed extraction */}
      {review && review.status === 'needs_manual' && showPaste && (
        <div className={`${CARD} p-5 mt-4`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Paste your deck text</div>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} placeholder="Paste the text from your deck…" className={INPUT} />
          <div className="mt-2 flex justify-end">
            <button onClick={handlePaste} disabled={busy || !pasteText.trim()} className={BTN_PRIMARY}>
              {phase === 'processing' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Review pasted text
            </button>
          </div>
        </div>
      )}

      {/* Past reviews */}
      {past.length > 0 && !review && (
        <div className={`${CARD} p-5 mt-6`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Past reviews</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {past.map((r) => (
              <button key={r.id} onClick={() => loadReview(r.id)} className="w-full flex items-center justify-between py-2.5 text-left group">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{r.title || r.filename || 'Untitled'}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{r.source} · {new Date(r.updated_at + 'Z').toLocaleDateString()}{r.edited ? ' · edited' : ''}</div>
                </div>
                <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 group-hover:text-orange-500" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function scoreColor(s) {
  if (s >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function ReviewView({ review, setReview, dirty, saving, busy, onSave, onRegenerate, onPurgeRaw, onReset }) {
  const rv = review.review || {};
  const sections = review.sections || [];

  const setRv = (patch) => setReview({ ...review, review: { ...rv, ...patch } });
  const setSections = (next) => setReview({ ...review, sections: next });

  function exportJson() {
    download(`deck-review-${review.id.slice(0, 8)}.json`, JSON.stringify(review, null, 2), 'application/json');
  }
  async function exportMd() {
    const md = await fetchMarkdown(api.deckReviewer.exportUrl(review.id, 'md'));
    download(`deck-review-${review.id.slice(0, 8)}.md`, md, 'text/markdown');
  }

  function moveSection(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  }
  function updateSection(i, patch) {
    setSections(sections.map((s, si) => (si === i ? { ...s, ...patch } : s)));
  }
  function addSection() {
    setSections([...sections, { key: 'other', label: 'New section', content: '' }]);
  }
  function removeSection(i) {
    setSections(sections.filter((_, si) => si !== i));
  }

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={review.title || ''}
          onChange={(e) => setReview({ ...review, title: e.target.value })}
          className="flex-1 min-w-[180px] text-lg font-semibold bg-transparent text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none py-1"
        />
        <button onClick={onSave} disabled={saving || !dirty} className={BTN_PRIMARY}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</button>
        <button onClick={onRegenerate} disabled={busy} className={BTN_GHOST}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Regenerate review</button>
        <button onClick={exportJson} className={BTN_GHOST}><Download size={15} /> JSON</button>
        <button onClick={exportMd} className={BTN_GHOST}><Download size={15} /> Markdown</button>
        <button onClick={onReset} className={BTN_GHOST}>New deck</button>
      </div>

      {/* Score + summary */}
      <div className={`${CARD} p-5 mb-4 flex items-start gap-5`}>
        <div className="text-center shrink-0">
          <div className={`text-4xl font-bold ${scoreColor(rv.overall_score || 0)}`}>{rv.overall_score ?? '—'}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">/ 100</div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">What to fix first</div>
          <textarea value={rv.fix_first || ''} onChange={(e) => setRv({ fix_first: e.target.value })} rows={2} className={INPUT} />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">{rv.summary}</div>
        </div>
      </div>

      {/* Raw file retention notice */}
      {review.source === 'upload' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-gray-400" /> Raw file {review.raw_retained ? 'archived privately in R2 (never served publicly)' : 'purged from storage'} · extracted text retained.</span>
          {review.raw_retained && <button onClick={onPurgeRaw} className="text-red-500 hover:underline inline-flex items-center gap-1"><Trash2 size={12} /> Delete raw</button>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <ReviewList title="Strengths" tone="emerald" items={rv.strengths || []} onChange={(strengths) => setRv({ strengths })} />
        <ReviewList title="Weaknesses" tone="amber" items={rv.weaknesses || []} onChange={(weaknesses) => setRv({ weaknesses })} />
        <ReviewList title="Missing sections" tone="gray" items={rv.missing_sections || []} onChange={(missing_sections) => setRv({ missing_sections })} />
        <ReviewList title="Red flags" tone="red" items={rv.red_flags || []} onChange={(red_flags) => setRv({ red_flags })} />
      </div>

      <div className={`${CARD} p-5 my-4`}>
        <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Priority fixes</div>
        <ReviewList bare items={rv.priority_fixes || []} onChange={(priority_fixes) => setRv({ priority_fixes })} tone="orange" />
      </div>

      {rv.section_suggestions?.length > 0 && (
        <div className={`${CARD} p-5 mb-4`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Section-by-section suggestions</div>
          <ul className="space-y-2">
            {rv.section_suggestions.map((s, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-gray-800 dark:text-gray-200">{s.section}:</span>{' '}
                <span className="text-gray-600 dark:text-gray-400">{s.suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rv.improved_wording?.length > 0 && (
        <div className={`${CARD} p-5 mb-4`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Suggested improved wording</div>
          <div className="space-y-3">
            {rv.improved_wording.map((w, i) => (
              <div key={i} className="text-sm">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{w.section}</div>
                {w.before && <div className="text-gray-400 dark:text-gray-500 line-through">{w.before}</div>}
                <div className="text-gray-800 dark:text-gray-200">{w.after}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mapped sections — editable, reorderable */}
      <div className={`${CARD} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-gray-900 dark:text-gray-100">Mapped deck content</div>
          <button onClick={addSection} className={BTN_GHOST}><Plus size={14} /> Add section</button>
        </div>
        <div className="space-y-3">
          {sections.map((s, i) => (
            <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={s.label}
                  onChange={(e) => updateSection(i, { label: e.target.value })}
                  className="font-medium text-sm text-gray-900 dark:text-gray-100 bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none flex-1"
                />
                <button onClick={() => moveSection(i, -1)} disabled={i === 0} className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"><ArrowUp size={15} /></button>
                <button onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"><ArrowDown size={15} /></button>
                <button onClick={() => removeSection(i)} className="text-gray-300 dark:text-gray-600 hover:text-red-500"><Trash2 size={15} /></button>
              </div>
              <textarea
                value={s.content || ''}
                onChange={(e) => updateSection(i, { content: e.target.value })}
                rows={s.content ? 4 : 2}
                placeholder="(empty — deck didn't cover this)"
                className="w-full text-sm bg-transparent text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-800 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewList({ title, items, onChange, tone = 'gray', bare = false }) {
  const [draft, setDraft] = useState('');
  const dot = {
    emerald: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400', orange: 'bg-orange-400', gray: 'bg-gray-400',
  }[tone];
  const body = (
    <>
      <ul className="space-y-1.5 mb-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 group">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
            <input
              value={it}
              onChange={(e) => onChange(items.map((x, xi) => (xi === i ? e.target.value : x)))}
              className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-300 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none"
            />
            <button onClick={() => onChange(items.filter((_, xi) => xi !== i))} className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-red-500"><Trash2 size={13} /></button>
          </li>
        ))}
        {!items.length && <li className="text-sm text-gray-400 dark:text-gray-500">None.</li>}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }}
          placeholder="Add…"
          className="flex-1 text-sm border border-gray-200 dark:border-gray-800 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
        />
        <button onClick={() => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }} className={BTN_GHOST}><Plus size={13} /></button>
      </div>
    </>
  );
  if (bare) return body;
  return (
    <div className={`${CARD} p-4`}>
      <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</div>
      {body}
    </div>
  );
}
