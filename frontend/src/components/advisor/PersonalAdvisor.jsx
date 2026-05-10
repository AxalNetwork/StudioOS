/**
 * Task #12 (AC-3) — Personal Advisor chatbot UI.
 *
 * Persistent dashboard chatbot that profiles every user via Q&A,
 * streams LLM-powered "explain this" answers via SSE, and shows
 * per-page completion rings linking to the page each answer lands
 * on. Replaces the legacy "Tell us about yourself" PersonaTile slot
 * on the Dashboard.
 *
 * Behaviour:
 *  - Mobile (`< md`): full-screen takeover when open, floating bubble
 *    when minimised.
 *  - Desktop (`md+`): pinned card in the dashboard slot when open,
 *    fixed-position floating bubble in the bottom-right when
 *    minimised.
 *  - Conversation state persists across reloads via the
 *    `advisor:state` localStorage key (open/closed + last seen
 *    conversation_id) — the actual transcript lives server-side and
 *    is re-hydrated by GET `/advisor/conversations/:id`.
 *
 * Wire contract (mirrors AC-1):
 *   POST /advisor/start        → { conversation_id, persona, progress, next_question, complete }
 *   POST /advisor/answer       → answer envelope (also accepts SSE; we use JSON here)
 *   POST /advisor/skip
 *   POST /advisor/explain      → SSE  events: delta {text} | done | error
 *   GET  /advisor/progress     → { total, answered, skipped, percent, complete, conversation_id }
 *   GET  /advisor/conversations/:id → { messages, answers, progress }
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Send, X, Minus, HelpCircle, Loader2, CheckCircle2,
  ArrowRight, MessageSquare, ChevronRight, SkipForward, BookOpen,
} from 'lucide-react';
import { api } from '../../lib/api';
import { safeReadJSON, safeWriteJSON } from '../../lib/storage';
import { useAuth } from '../../hooks/useAuthSync';
import { useEscapeClose } from '../useEscapeClose';
import { pickPersonaBank, isSpinoutLabActive } from '../../lib/advisor/persona';
import { predictTarget, pagesForBank, pageLabel } from '../../lib/advisor/router';

const STORAGE_KEY = 'advisor:state';

/** Resolve auth + CSRF headers for raw fetch calls (SSE bypasses api.js). */
function authHeaders() {
  const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || null;
  let csrf = null;
  if (typeof document !== 'undefined') {
    for (const part of (document.cookie || '').split(';')) {
      const t = part.trim();
      const eq = t.indexOf('=');
      if (eq > 0 && t.slice(0, eq) === 'studioos_csrf') { csrf = t.slice(eq + 1); break; }
    }
  }
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
  };
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return desktop;
}

export default function PersonalAdvisor() {
  const { user } = useAuth();
  const persisted = useMemo(() => safeReadJSON(STORAGE_KEY, { minimised: false }) || { minimised: false }, []);
  const [minimised, setMinimised] = useState(!!persisted.minimised);
  const [conversationId, setConversationId] = useState(persisted.conversation_id || null);
  const [persona, setPersona] = useState(null);
  const [question, setQuestion] = useState(null);     // public_question shape from server
  const [progress, setProgress] = useState({ total: 0, answered: 0, skipped: 0, percent: 0, complete: false });
  const [messages, setMessages] = useState([]);       // [{role, content, question_id?}]
  const [answeredIds, setAnsweredIds] = useState([]); // for ring computation
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Tutor mode state.
  const [tutor, setTutor] = useState(null); // { topic, text, doc_anchor, page_target, streaming }
  const tutorAbortRef = useRef(null);
  const scrollerRef = useRef(null);
  const isDesktop = useIsDesktop();

  // ---------- Persistence -------------------------------------------------
  useEffect(() => {
    safeWriteJSON(STORAGE_KEY, { minimised, conversation_id: conversationId });
  }, [minimised, conversationId]);

  // ---------- Initial load ------------------------------------------------
  const bootstrap = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api.advisor.start();
      setConversationId(r.conversation_id || r.conversation_uid || null);
      setPersona(r.persona || null);
      setQuestion(r.next_question || r.next || null);
      setProgress(r.progress || { total: 0, answered: 0, skipped: 0, percent: 0, complete: !!r.complete });
      // Hydrate transcript so reloads show prior turns.
      const cid = r.conversation_id || r.conversation_uid;
      if (cid) {
        try {
          const hist = await api.advisor.conversation(cid);
          const msgs = (hist?.messages || []).map((m) => ({
            role: m.role,
            content: m.content,
            question_id: m.question_id || null,
          }));
          setMessages(msgs);
          setAnsweredIds((hist?.answers || []).filter((a) => a.saved_status === 'saved').map((a) => a.question_id));
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      setLoadError(e?.message || 'Could not load advisor');
    }
  }, []);

  useEffect(() => { if (user) bootstrap(); }, [user, bootstrap]);

  // Auto-scroll the transcript on new messages / streaming tokens.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, question, tutor]);

  // ---------- Send answer -------------------------------------------------
  const submit = useCallback(async (rawValue) => {
    const value = String(rawValue ?? input ?? '').trim();
    if (!value || !conversationId || !question || busy) return;
    setBusy(true);
    // Optimistic transcript update + ring update.
    const qid = question.id;
    const qPrompt = question.prompt;
    setMessages((m) => [
      ...m,
      // The question itself isn't in the transcript yet on first turn — add for context.
      ...(m.find((x) => x.question_id === qid && x.role === 'assistant') ? [] : [{ role: 'assistant', content: qPrompt, question_id: qid }]),
      { role: 'user', content: value, question_id: qid },
    ]);
    setAnsweredIds((ids) => (ids.includes(qid) ? ids : [...ids, qid]));
    setInput('');
    try {
      const r = await api.advisor.answer(conversationId, qid, value);
      // Server is the source of truth — reconcile.
      // Only `saved` answers belong in the per-page ring tally; roll
      // back the optimistic add for any other terminal status so the
      // ring doesn't overstate completion.
      if (r.status !== 'saved') {
        setAnsweredIds((ids) => ids.filter((x) => x !== qid));
      }
      if (r.status === 'paywalled') {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `${r.hint || 'This question is part of a paid tier.'}${r.upgrade_link ? `\n\nUpgrade: ${r.upgrade_link}` : ''}`,
        }]);
      } else if (r.status === 'failed' && r.error) {
        setMessages((m) => [...m, { role: 'assistant', content: `I couldn't save that — ${r.error}` }]);
      }
      const next = r.next_question || r.next || null;
      setQuestion(next);
      setProgress(r.progress || progress);
      if (next) setMessages((m) => [...m, { role: 'assistant', content: next.prompt, question_id: next.id }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e?.message || 'send failed'}` }]);
      // Roll back the optimistic answeredIds entry.
      setAnsweredIds((ids) => ids.filter((x) => x !== qid));
    } finally {
      setBusy(false);
    }
  }, [busy, conversationId, input, question, progress]);

  const skip = useCallback(async () => {
    if (!question || !conversationId || busy) return;
    if (question.skip_allowed === false) return;
    setBusy(true);
    try {
      const r = await api.advisor.skip(conversationId, question.id);
      const next = r.next || r.next_question || null;
      setQuestion(next);
      // Reconcile progress so the header / bubble percentage doesn't
      // drift after a skip. The skip endpoint returns the same
      // `progress` envelope shape as /answer; fall back to a fresh
      // /progress fetch if the server hasn't included it.
      if (r.progress) {
        setProgress(r.progress);
      } else {
        try { const p = await api.advisor.progress(); setProgress(p); } catch { /* non-fatal */ }
      }
      if (next) setMessages((m) => [...m, { role: 'assistant', content: next.prompt, question_id: next.id }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e?.message || 'skip failed'}` }]);
    } finally {
      setBusy(false);
    }
  }, [question, conversationId, busy]);

  // ---------- Tutor (SSE explain) -----------------------------------------
  const openTutor = useCallback(async (topic) => {
    if (!topic) return;
    // Cancel any in-flight stream.
    if (tutorAbortRef.current) tutorAbortRef.current.abort();
    const controller = new AbortController();
    tutorAbortRef.current = controller;
    const target = (question?.id && predictTarget(question.id)) || null;
    setTutor({ topic, text: '', doc_anchor: target?.doc_anchor || null, page_target: target?.page_target || null, streaming: true });
    try {
      const res = await fetch(api.advisor.explainUrl(), {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders() },
        body: JSON.stringify({ topic, conversation_id: conversationId }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`explain ${res.status}${errBody ? ': ' + errBody.slice(0, 160) : ''}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let assembled = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          let event = 'message'; let dataStr = '';
          for (const ln of chunk.split('\n')) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          let data; try { data = JSON.parse(dataStr); } catch { continue; }
          if (event === 'delta') {
            assembled += data.text || '';
            setTutor((t) => (t ? { ...t, text: assembled } : t));
          } else if (event === 'error') {
            throw new Error(data.message || 'explain stream error');
          }
        }
      }
      setTutor((t) => (t ? { ...t, streaming: false } : t));
    } catch (e) {
      if (e.name !== 'AbortError') {
        setTutor((t) => (t ? { ...t, text: t.text || `Couldn't explain: ${e?.message || 'stream error'}`, streaming: false } : t));
      }
    } finally {
      tutorAbortRef.current = null;
    }
  }, [conversationId, question]);

  // Detect "explain X" as user input — open tutor instead of answering.
  const handleSend = useCallback(() => {
    const raw = input.trim();
    if (!raw) return;
    const m = raw.match(/^\s*(?:explain|what is|what's|tell me about|help me with|huh\??)\s+(.{2,})$/i);
    if (m) {
      openTutor(m[1]);
      setInput('');
      return;
    }
    submit(raw);
  }, [input, openTutor, submit]);

  const closeTutor = useCallback(() => {
    if (tutorAbortRef.current) tutorAbortRef.current.abort();
    setTutor(null);
  }, []);

  // Cleanup any in-flight stream on unmount.
  useEffect(() => () => { if (tutorAbortRef.current) tutorAbortRef.current.abort(); }, []);

  // ---------- Right rail completion rings ---------------------------------
  // Pick the bank using the AC-2 dispatcher; falls back to an empty
  // list (e.g. role still being detected) and the rings just hide.
  const bankPages = useMemo(() => {
    const bank = pickPersonaBank(user);
    if (!bank) return [];
    // The persona dispatcher returns the bank object — find which key
    // it corresponds to so pagesForBank can look it up.
    const bankName = (() => {
      const role = String(user?.role || '').toLowerCase();
      if (role === 'investor') return 'investor';
      if (role === 'mentor') return 'mentor';
      if (role === 'partner') return 'partner';
      // Reuse the shared persona dispatcher's spin-out-lab rule so
      // graduated/incorporated founders don't get mis-grouped into
      // the New Founder bank for ring purposes.
      if (role === 'founder') return isSpinoutLabActive(user) ? 'newFounder' : 'existingFounder';
      return null;
    })();
    return bankName ? pagesForBank(bankName) : [];
  }, [user]);

  const ringStats = useMemo(() => {
    const answered = new Set(answeredIds);
    return bankPages.map((p) => {
      const total = p.ids.length;
      const done = p.ids.filter((id) => answered.has(id)).length;
      return { ...p, total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    });
  }, [bankPages, answeredIds]);

  // ---------- Render ------------------------------------------------------
  if (!user) return null; // anonymous: nothing to advise on yet

  if (minimised) return <MinimisedBubble onOpen={() => setMinimised(false)} percent={progress.percent} />;

  const containerClass = isDesktop
    ? 'bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-900/50 rounded-xl shadow-sm overflow-hidden'
    : 'fixed inset-0 z-50 bg-white dark:bg-gray-950 flex flex-col';

  return (
    <div data-card className={containerClass}>
      <Header
        persona={persona}
        progress={progress}
        onMinimise={() => setMinimised(true)}
        isDesktop={isDesktop}
      />

      <div className={isDesktop ? 'grid grid-cols-1 lg:grid-cols-3' : 'flex-1 flex flex-col overflow-hidden'}>
        {/* Chat column */}
        <div className={isDesktop ? 'lg:col-span-2 flex flex-col border-r border-gray-100 dark:border-gray-800 min-h-[420px]' : 'flex-1 flex flex-col min-h-0'}>
          <Transcript
            ref={scrollerRef}
            messages={messages}
            tutor={tutor}
            onCloseTutor={closeTutor}
            loadError={loadError}
            complete={progress.complete && !question}
          />

          {question && (
            <CurrentQuestion
              q={question}
              onExplain={() => openTutor(question.prompt || question.id)}
            />
          )}

          <Composer
            input={input}
            setInput={setInput}
            onSend={handleSend}
            onSkip={skip}
            busy={busy}
            disabled={!question}
            skipAllowed={question?.skip_allowed !== false}
            inputKind={question?.input_kind}
            options={question?.options}
            onPickOption={(opt) => submit(opt)}
          />
        </div>

        {/* Right rail — completion rings */}
        {isDesktop && (
          <aside className="p-4 bg-gray-50 dark:bg-gray-950/40 max-h-[600px] overflow-y-auto">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-3">Your progress</div>
            {ringStats.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">We'll show page-by-page progress here once we know your role.</div>
            ) : (
              <div className="space-y-2">
                {ringStats.map((r) => (
                  <Link
                    key={r.page}
                    to={r.page}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-900 border border-transparent hover:border-gray-200 dark:hover:border-gray-800 transition-colors"
                    title={`${r.done} of ${r.total} answered`}
                  >
                    <Ring percent={r.percent} done={r.done === r.total && r.total > 0} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{r.label || pageLabel(r.page)}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">{r.done} / {r.total}</div>
                    </div>
                    <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------- Subcomponents -----------------------------------------------

function MinimisedBubble({ onOpen, percent }) {
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-3 rounded-full shadow-lg print:hidden"
      title="Open Personal Advisor"
    >
      <Sparkles size={16} />
      <span className="text-sm font-medium">Advisor</span>
      {percent > 0 && percent < 100 && (
        <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{percent}%</span>
      )}
    </button>
  );
}

function Header({ persona, progress, onMinimise, isDesktop }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center flex-shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Personal Advisor</div>
          <div className="text-[11px] text-gray-600 dark:text-gray-400 truncate">
            {persona ? `${persona} • ` : ''}{progress.answered}/{progress.total} answered{progress.percent > 0 ? ` (${progress.percent}%)` : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onMinimise}
          className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-800/60"
          title={isDesktop ? 'Minimise to bubble' : 'Close'}
        >
          {isDesktop ? <Minus size={16} /> : <X size={16} />}
        </button>
      </div>
    </div>
  );
}

const Transcript = React.forwardRef(function Transcript({ messages, tutor, onCloseTutor, loadError, complete }, ref) {
  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[260px]">
      {loadError && (
        <div className="text-xs text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300 border border-red-200 dark:border-red-900 rounded p-2">
          {loadError}
        </div>
      )}
      {messages.length === 0 && !loadError && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-6">
          <MessageSquare size={20} className="mx-auto mb-2 text-gray-400" />
          Your advisor will guide you through a quick setup. Type your answer below — or ask "explain X" any time.
        </div>
      )}
      {messages.map((m, i) => <Bubble key={i} m={m} />)}
      {complete && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded p-2">
          <CheckCircle2 size={14} /> Profile complete — your dashboard is now tailored to you.
        </div>
      )}
      {tutor && <TutorPanel tutor={tutor} onClose={onCloseTutor} />}
    </div>
  );
});

function Bubble({ m }) {
  const isUser = m.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
        isUser
          ? 'bg-violet-600 text-white rounded-br-sm'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
      }`}>
        {m.content}
      </div>
    </div>
  );
}

function CurrentQuestion({ q, onExplain }) {
  return (
    <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-violet-50/30 dark:bg-violet-950/10 flex items-start gap-2">
      <div className="text-xs text-violet-700 dark:text-violet-300 font-medium flex-1 min-w-0 truncate">
        Currently: <span className="text-gray-700 dark:text-gray-200 font-normal">{q.prompt}</span>
      </div>
      <button
        onClick={onExplain}
        className="flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300 hover:text-violet-900 dark:hover:text-violet-100"
        title="Explain this question"
      >
        <HelpCircle size={12} /> Explain
      </button>
    </div>
  );
}

function Composer({ input, setInput, onSend, onSkip, busy, disabled, skipAllowed, inputKind, options, onPickOption }) {
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && (inputKind === 'short' || !inputKind)) {
      e.preventDefault();
      onSend();
    }
  };
  // Render the option chips for select/multiselect kinds.
  const showOptions = Array.isArray(options) && options.length > 0 && (inputKind === 'select' || inputKind === 'choice');
  return (
    <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 bg-white dark:bg-gray-900">
      {showOptions && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => onPickOption(opt)}
              disabled={busy || disabled}
              className="text-xs px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={inputKind === 'long' ? 3 : 1}
          placeholder={disabled ? 'All caught up — nothing more to ask.' : 'Type your answer, or "explain ..."'}
          disabled={busy || disabled}
          data-density-target
          className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-[var(--app-input-bg,#fff)] dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        {skipAllowed && !disabled && (
          <button
            onClick={onSkip}
            disabled={busy}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
            title="Skip this question"
          >
            <SkipForward size={16} />
          </button>
        )}
        <button
          onClick={onSend}
          disabled={busy || disabled || !input.trim()}
          className="p-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
          title="Send"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

function TutorPanel({ tutor, onClose }) {
  useEscapeClose(onClose);
  return (
    <div className="border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20 rounded-lg p-3 text-sm">
      <div className="flex items-start gap-2 mb-1">
        <BookOpen size={14} className="text-violet-700 dark:text-violet-300 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">Tutor</div>
          <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{tutor.topic}</div>
        </div>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100" title="Close">
          <X size={14} />
        </button>
      </div>
      <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap min-h-[40px]">
        {tutor.text || (tutor.streaming ? <span className="text-gray-400 italic">Thinking…</span> : <span className="text-gray-400 italic">No reply.</span>)}
        {tutor.streaming && tutor.text && <span className="inline-block w-1.5 h-3 bg-violet-500 ml-0.5 animate-pulse align-middle" />}
      </div>
      {(tutor.doc_anchor || tutor.page_target) && (
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          {tutor.doc_anchor && (
            <Link to={`/docs#${tutor.doc_anchor}`} className="text-violet-700 dark:text-violet-300 hover:underline flex items-center gap-1">
              Read more in docs <ArrowRight size={10} />
            </Link>
          )}
          {tutor.page_target && (
            <Link to={tutor.page_target} className="text-gray-600 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 flex items-center gap-1">
              Open page <ArrowRight size={10} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Ring({ percent, done }) {
  const size = 32;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
  const color = done ? 'stroke-emerald-500' : percent > 0 ? 'stroke-violet-500' : 'stroke-gray-300 dark:stroke-gray-700';
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} className="stroke-gray-200 dark:stroke-gray-800 fill-none" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        className={color}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 3} textAnchor="middle" className="fill-gray-700 dark:fill-gray-200 text-[9px] font-bold">
        {done ? '✓' : `${percent}`}
      </text>
    </svg>
  );
}
