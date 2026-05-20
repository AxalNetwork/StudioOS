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
 *  - Mobile (`< md`): inline card in the dashboard slot, with the chat
 *    column capped at `max-h-[60vh]` so the transcript scrolls inside
 *    the widget instead of taking over the viewport. Floating bubble
 *    when minimised. (Previously this was a `fixed inset-0` full-screen
 *    takeover; removed because it hid the rest of the dashboard.)
 *  - Desktop (`md+`): pinned card in the dashboard slot when open,
 *    fixed-position floating bubble in the bottom-right when
 *    minimised. Right rail (section focus + per-page rings) is
 *    desktop-only.
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
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Send, X, Minus, HelpCircle, Loader2, CheckCircle2,
  ArrowRight, MessageSquare, SkipForward, BookOpen,
} from 'lucide-react';
import { api, spinoutLab as spinoutLabApi } from '../../lib/api';
import { safeReadJSON, safeWriteJSON } from '../../lib/storage';
import { useAuth } from '../../hooks/useAuthSync';
import { useEscapeClose } from '../useEscapeClose';
import { predictTarget } from '../../lib/advisor/router';
import { useWebSocket } from '../../hooks/useWebSocket';
import AdvisorProgressWidget from './AdvisorProgressWidget';

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
  // Value is write-only — `setAnsweredIds` feeds an internal cache used by
  // the server for ring computation; the local array is never read back.
  const [, setAnsweredIds] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Some environments (the dev FastAPI backend, older worker deploys)
  // don't expose /api/advisor at all. We hide the whole card on 404 so
  // the dashboard doesn't surface a scary "Not found" panel — the
  // Personal Advisor is genuinely unavailable in those environments.
  const [unavailable, setUnavailable] = useState(false);

  // Task #2 (AR) — server-driven per-page / per-section progress
  // and Spin-Out week banner state. Refreshed after every answer
  // so the right-rail bars stay in sync with the writeRouter.
  const [progressDetail, setProgressDetail] = useState({ by_page: [], by_section: [], overall: null, spinout_lab: null });
  const [labState, setLabState] = useState(null); // { active, week, ... } from /api/spinout-lab/state
  const [focusSection, setFocusSection] = useState(null);
  // Task #3 (AS) — when the server returns `needs_evidence`/`invalid`,
  // we pin the original value here so the user's next reply is sent
  // as `evidence` for the same question instead of a new answer.
  const [pendingEvidence, setPendingEvidence] = useState(null);

  // Task #2 (CC) — bump token incremented every time the OnboardingChat
  // WebSocket emits an `advisor-progress` or `page-fill` frame. The
  // right-rail progress widget watches this token and re-fetches its
  // queue + sources without polling.
  const [progressBumpToken, setProgressBumpToken] = useState(0);
  const bumpProgress = useCallback(() => setProgressBumpToken((n) => n + 1), []);

  // Tutor mode state.
  const [tutor, setTutor] = useState(null); // { topic, text, doc_anchor, page_target, streaming }
  const tutorAbortRef = useRef(null);
  const scrollerRef = useRef(null);
  const isDesktop = useIsDesktop();

  // ---------- Persistence -------------------------------------------------
  useEffect(() => {
    safeWriteJSON(STORAGE_KEY, { minimised, conversation_id: conversationId });
  }, [minimised, conversationId]);

  // ---------- Server-driven progress (by_page / by_section / overall) ----
  const refreshProgress = useCallback(async () => {
    try {
      const p = await api.advisor.progress();
      setProgressDetail({
        by_page: Array.isArray(p?.by_page) ? p.by_page : [],
        by_section: Array.isArray(p?.by_section) ? p.by_section : [],
        overall: p?.overall || null,
        spinout_lab: p?.spinout_lab || null,
      });
    } catch { /* non-fatal — rings will hide */ }
  }, []);

  // Pull spin-out lab state for the week banner. Hidden silently
  // when the endpoint isn't mounted (older worker / FastAPI dev).
  const refreshLabState = useCallback(async () => {
    try {
      const s = await spinoutLabApi.state();
      setLabState(s || null);
    } catch { setLabState(null); }
  }, []);

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
      // 404 → endpoint not mounted in this environment (dev FastAPI
      // backend doesn't host the advisor; worker-only feature). Hide
      // the card silently rather than rendering a confusing error.
      if (e?.status === 404) {
        setUnavailable(true);
        return;
      }
      setLoadError(e?.message || 'Could not load advisor');
    }
  }, []);

  useEffect(() => { if (user) bootstrap(); }, [user, bootstrap]);
  // Server-driven progress + lab state.
  useEffect(() => {
    if (!user) return;
    refreshProgress();
    refreshLabState();
  }, [user, refreshProgress, refreshLabState]);

  // Task #2 (CC) — subscribe to the per-user OnboardingChat DO so
  // milestone unlocks and tier changes re-order the right-rail widget
  // without a manual refresh. `notifyAdvisorProgress` and
  // `notifyAdvisorPageFill` post system frames whose JSON-encoded
  // content carries `kind: 'advisor-progress' | 'page-fill'`.
  const wsPath = user?.id ? `/api/onboarding/ws/${user.id}` : null;
  useWebSocket(wsPath, {
    enabled: !!user?.id && !minimised,
    onMessage: (msg) => {
      if (!msg) return;
      // The DO wraps payloads as chat_message frames with role='system'
      // and a JSON body in `content`. We also accept top-level kind in
      // case the DO is upgraded to forward decoded payloads later.
      let body = null;
      if (msg.type === 'chat_message' && msg.message?.role === 'system') {
        try { body = JSON.parse(msg.message.content || '{}'); } catch { /* ignore */ }
      } else if (msg.kind) {
        body = msg;
      }
      if (!body) return;
      if (body.kind === 'advisor-progress' || body.kind === 'page-fill') {
        bumpProgress();
        // Also reconcile the dashboard ring percentage immediately.
        if (body.kind === 'advisor-progress' && typeof body.percent === 'number') {
          setProgress((p) => ({
            ...p,
            total: body.total ?? p.total,
            answered: body.answered ?? p.answered,
            skipped: body.skipped ?? p.skipped,
            percent: body.percent,
          }));
        }
      }
    },
  });

  // Auto-scroll the transcript on new messages / streaming tokens.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, question, tutor]);

  // ---------- Send answer -------------------------------------------------
  const submit = useCallback(async (rawValue, evidenceArg) => {
    const userText = String(rawValue ?? input ?? '').trim();
    if (!userText || !conversationId || !question || busy) return;
    // Task #3 (AS) — if the previous turn returned needs_evidence
    // for this same question, treat this reply as the evidence and
    // re-submit the original value.
    let value = userText;
    let evidence = evidenceArg;
    if (pendingEvidence && pendingEvidence.qid === question.id && evidenceArg == null) {
      value = pendingEvidence.value;
      evidence = userText;
    }
    setBusy(true);
    // Optimistic transcript update + ring update.
    const qid = question.id;
    const qPrompt = question.prompt;
    const qPage = question.page_target || null;
    setMessages((m) => [
      ...m,
      ...(m.find((x) => x.question_id === qid && x.role === 'assistant') ? [] : [{ role: 'assistant', content: qPrompt, question_id: qid }]),
      { role: 'user', content: value, question_id: qid },
    ]);
    setAnsweredIds((ids) => (ids.includes(qid) ? ids : [...ids, qid]));
    setInput('');
    try {
      const r = await api.advisor.answer(conversationId, qid, value, evidence);
      // Server is the source of truth — reconcile. Roll back the
      // optimistic ring add for any non-saved status.
      if (r.status !== 'saved') {
        setAnsweredIds((ids) => ids.filter((x) => x !== qid));
      }
      // Task #1 (CD) — broadcast a same-tab DOM event so any page
      // currently rendering the AdvisorFilledBanner / sparkle icons
      // re-fetches /api/advisor/sources without waiting for navigation.
      // Mirrors the worker-side `page-fill:{user_id}:{page}` DO event
      // for the in-tab case (the cross-tab path uses the OnboardingChat
      // WebSocket); broadcasting both is harmless because subscribers
      // dedupe by question_id + filled_at.
      if (r.status === 'saved') {
        try {
          window.dispatchEvent(new CustomEvent('advisor:page-fill', {
            detail: {
              question_id: qid,
              page: qPage,
              saved_to: r.saved_to || null,
              ts: Date.now(),
            },
          }));
        } catch { /* SSR / non-DOM env — ignore */ }
      }
      // Task #3 (AS) — evidence gate / schema-invalid: re-prompt
      // inline. Stash the pending value so the next submit() call
      // re-uses it, attaching the user's evidence reply.
      if (r.status === 'needs_evidence' || r.status === 'invalid') {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: r.hint || 'I need a quick clarification before saving that.',
          question_id: qid,
          needs_evidence: r.status === 'needs_evidence',
          pending_value: value,
          open_url: r.open_url || qPage || null,
        }]);
        // Keep the same question pinned — the next user reply is
        // treated as evidence for the same value.
        setPendingEvidence({ qid, value, open_url: r.open_url || qPage || null });
        return;
      }
      if (r.status === 'paywalled') {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `${r.hint || 'This question is part of a paid tier.'}${r.upgrade_link ? `\n\nUpgrade: ${r.upgrade_link}` : ''}`,
        }]);
      } else if (r.status === 'failed' && r.error) {
        setMessages((m) => [...m, { role: 'assistant', content: `I couldn't save that — ${r.error}` }]);
      }
      setPendingEvidence(null);
      const next = r.next_question || r.next || null;
      setQuestion(next);
      setProgress(r.progress || progress);
      if (next) setMessages((m) => [...m, { role: 'assistant', content: next.prompt, question_id: next.id }]);
      refreshProgress();
      refreshLabState();
      bumpProgress();
    } catch (e) {
      // Task #3 (AS) — request() throws on non-2xx. The /answer
      // endpoint returns 422 with a structured payload for the
      // evidence gate / schema-invalid path; surface it as an
      // inline retry instead of a generic error toast.
      const data = e?.data || null;
      const is422 = e?.status === 422 && data && (data.status === 'needs_evidence' || data.status === 'invalid');
      setAnsweredIds((ids) => ids.filter((x) => x !== qid));
      if (is422) {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: data.hint || 'I need a quick clarification before saving that.',
          question_id: qid,
          needs_evidence: data.status === 'needs_evidence',
          pending_value: value,
          open_url: data.open_url || null,
        }]);
        setPendingEvidence({ qid, value, open_url: data.open_url || null });
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e?.message || 'send failed'}` }]);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, conversationId, input, question, progress, refreshProgress, refreshLabState, pendingEvidence]);

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
      refreshProgress();
      bumpProgress();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e?.message || 'skip failed'}` }]);
    } finally {
      setBusy(false);
    }
  }, [question, conversationId, busy, refreshProgress, bumpProgress]);

  // ---------- Section focus — fetch the next pinned question -------------
  const pickFocus = useCallback(async (section) => {
    const next = section === focusSection ? null : section;
    setFocusSection(next);
    if (busy) return;
    try {
      const r = await api.advisor.nextQuestion(next || undefined);
      const q = r?.next_question || r?.next || null;
      if (q) {
        setQuestion(q);
        setMessages((m) => [...m, { role: 'assistant', content: q.prompt, question_id: q.id }]);
      }
    } catch { /* non-fatal */ }
  }, [focusSection, busy]);

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
          } else if (event === 'provider') {
            // Task #16 — show a "(fallback)" badge when the Workers AI
            // primary missed and a smaller sibling or Anthropic answered.
            // `cached` and `provider` ('workers-ai' | 'anthropic') are
            // also surfaced so power users can see which model
            // produced the response.
            setTutor((t) => (t ? {
              ...t,
              provider: data.provider || null,
              model: data.model || null,
              fallback_used: !!data.fallback_used,
              cached: !!data.cached,
            } : t));
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

  // Task #5 (AV) — route a free-form message through the LLM tool-binding
  // endpoint and append the returned {result, cta} envelope as a
  // role='tool' message so <Bubble> renders inline CTA buttons.
  const submitToolAuto = useCallback(async (raw) => {
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: raw }]);
    setInput('');
    try {
      const r = await api.advisor.toolAuto(raw);
      setMessages((m) => [...m, {
        role: 'tool',
        content: JSON.stringify({ result: r.result, cta: r.cta }),
        cta: r.cta,
        tool: r.tool,
      }]);
    } catch (e) {
      const data = e?.data || null;
      setMessages((m) => [...m, {
        role: 'assistant',
        content: data?.error || `Couldn't route that — ${e?.message || 'request failed'}`,
      }]);
    } finally {
      setBusy(false);
    }
  }, []);

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
    // Route to the LLM tool-binding endpoint when the profile is
    // complete (no active question) or when the user opens with a
    // verb that strongly implies "do something" rather than "answer
    // the current profile question".
    const isToolish = /^\s*(?:\/(?:tool|find|open|book|schedule|draft|start)\b|find\b|show\b|search\b|book\b|schedule\b|draft\b|open\b|start\b|deep[- ]link\b)/i.test(raw);
    if (!question || isToolish) {
      submitToolAuto(raw);
      return;
    }
    submit(raw);
  }, [input, openTutor, submit, submitToolAuto, question]);

  const closeTutor = useCallback(() => {
    if (tutorAbortRef.current) tutorAbortRef.current.abort();
    setTutor(null);
  }, []);

  // Cleanup any in-flight stream on unmount.
  useEffect(() => () => { if (tutorAbortRef.current) tutorAbortRef.current.abort(); }, []);

  // ---------- Right rail (Task #2 CC) ------------------------------------
  // Section-focus chips still consume /progress.by_section directly. The
  // per-page progress bars were superseded by the AdvisorProgressWidget
  // (Proposed / Pending / Completed buckets driven off /api/advisor/queue).
  const sectionStats = useMemo(() => progressDetail.by_section || [], [progressDetail.by_section]);

  // Spin-Out Week banner: prefer dedicated lab state when available,
  // else fall back to /progress.spinout_lab snapshot.
  const weekBanner = useMemo(() => {
    const src = (labState && labState.active) ? labState : (progressDetail.spinout_lab && progressDetail.spinout_lab.active ? progressDetail.spinout_lab : null);
    if (!src || !src.active) return null;
    return { week: Number(src.week || 1), unlocked: src.unlockedFeatures || src.unlocked_features || null };
  }, [labState, progressDetail.spinout_lab]);

  // ---------- Render ------------------------------------------------------
  if (!user) return null; // anonymous: nothing to advise on yet
  // Endpoint missing in this environment — render nothing so the
  // dashboard slot collapses cleanly instead of showing a "Not found"
  // tile to the user.
  if (unavailable) return null;

  if (minimised) return <MinimisedBubble onOpen={() => setMinimised(false)} percent={progress.percent} />;

  // Mobile no longer takes over the viewport. The advisor renders as an
  // inline, height-capped card so the rest of the dashboard (Quick Stats,
  // Performance Analytics, etc.) stays scrollable around it. Users who
  // want it out of the way can tap Minimise to collapse to the floating
  // bubble (same UX as desktop).
  const containerClass =
    'bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-900/50 rounded-xl shadow-sm overflow-hidden flex flex-col';

  return (
    <div data-card className={containerClass}>
      <Header
        persona={persona}
        progress={progress}
        onMinimise={() => setMinimised(true)}
        isDesktop={isDesktop}
      />
      {weekBanner && <WeekBanner week={weekBanner.week} />}

      <div className={isDesktop ? 'grid grid-cols-1 lg:grid-cols-3' : 'flex flex-col'}>
        {/* Chat column. On mobile we cap the height to ~60vh so the chat
            transcript scrolls inside the card instead of pushing the rest
            of the dashboard off screen. */}
        <div className={isDesktop ? 'lg:col-span-2 flex flex-col border-r border-gray-100 dark:border-gray-800 min-h-[420px]' : 'flex flex-col min-h-0 max-h-[60vh]'}>
          <Transcript
            ref={scrollerRef}
            messages={messages}
            tutor={tutor}
            onCloseTutor={closeTutor}
            loadError={loadError}
            complete={progress.complete && !question}
            onCtaClick={async () => {
              // Task #5 (AV) — refresh /progress so the right-rail rings
              // pick up any tool-driven completion (e.g. opening a page
              // counts toward that page's profile section).
              try {
                const p = await api.advisor.progress();
                if (p) setProgress(p);
                refreshProgress();
              } catch { /* non-fatal */ }
            }}
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
            disabled={false}
            skipAllowed={question?.skip_allowed !== false}
            inputKind={question?.input_kind}
            options={question?.options}
            onPickOption={(opt) => submit(opt)}
          />
        </div>

        {/* Right rail — Task #2 (CC) progress widget. Sticky-on-scroll
            on desktop so the three buckets (Proposed / Pending /
            Completed) stay visible as the chat transcript grows. */}
        {isDesktop && (
          <aside className="p-4 bg-gray-50 dark:bg-gray-950/40 max-h-[640px] overflow-y-auto sticky top-4">
            {sectionStats.length > 1 && (
              <div className="mb-3">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-2">Focus a section</div>
                <div className="flex flex-wrap gap-1.5">
                  {sectionStats.map((s) => {
                    const active = focusSection === s.section;
                    return (
                      <button
                        key={s.section}
                        onClick={() => pickFocus(s.section)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          active
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-violet-400'
                        }`}
                        title={`${s.answered} / ${s.total} answered`}
                      >
                        {s.section} {s.percent > 0 ? `· ${s.percent}%` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <AdvisorProgressWidget
              focusSection={focusSection}
              pendingEvidence={pendingEvidence}
              currentQuestion={question}
              labState={labState}
              progressBumpToken={progressBumpToken}
              onPickQuestion={(q) => {
                // Set the chat to this exact question by id. The queue
                // item carries enough shape ({id, prompt, page_target,
                // section}) to drive the existing free-text input flow;
                // submit() reads question.id to attribute the answer.
                // focusSection is a SECTION key (e.g. "BUILD"), never a
                // route path — assigning a path here would poison the
                // /queue + /next-question focus filter downstream.
                if (!q || !q.id) return;
                setQuestion({
                  id: q.id,
                  prompt: q.prompt,
                  page_target: q.page_target || null,
                  section: q.section || null,
                  skip_allowed: q.skip_allowed !== false,
                });
                setMessages((m) => [...m, { role: 'assistant', content: q.prompt, question_id: q.id }]);
                if (q.section && q.section !== focusSection) {
                  setFocusSection(q.section);
                }
              }}
            />
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

const Transcript = React.forwardRef(function Transcript({ messages, tutor, onCloseTutor, loadError, complete, onCtaClick }, ref) {
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
      {messages.map((m, i) => <Bubble key={i} m={m} onCtaClick={onCtaClick} />)}
      {complete && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded p-2">
          <CheckCircle2 size={14} /> Profile complete — your dashboard is now tailored to you.
        </div>
      )}
      {tutor && <TutorPanel tutor={tutor} onClose={onCloseTutor} />}
    </div>
  );
});

function Bubble({ m, onCtaClick }) {
  const isUser = m.role === 'user';
  // Task #5 (AV) — render the inline CTA block produced by /advisor/tool.
  // The envelope can arrive on `m.cta` (live tool turn) or be embedded in
  // `m.content` as JSON when /conversations/:id rehydrates a role='tool'
  // message from the audit log.
  let cta = m.cta || null;
  let toolPreview = null;
  if (!cta && m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('{')) {
    try {
      const parsed = JSON.parse(m.content);
      cta = parsed?.cta || null;
      toolPreview = parsed?.result || null;
    } catch { /* leave content as-is */ }
  }
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
        isUser
          ? 'bg-violet-600 text-white rounded-br-sm'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
      }`}>
        {/* Tool messages: prefer rendering the human-readable CTA over the raw envelope. */}
        {m.role === 'tool' && cta ? (
          <ToolPreview preview={toolPreview} />
        ) : (
          m.content
        )}
        {/* Task #3 (AS) — single-link CTA for evidence-gate / paywall bubbles. */}
        {!isUser && m.open_url && !cta && (
          <div className="mt-2">
            <a
              href={m.open_url}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition"
            >
              Open the page →
            </a>
          </div>
        )}
        {/* Task #5 (AV) — inline tool CTA: primary + optional secondary. */}
        {!isUser && cta && <CtaButtons cta={cta} onCtaClick={onCtaClick} />}
      </div>
    </div>
  );
}

function ToolPreview({ preview }) {
  if (!preview || typeof preview !== 'object') return null;
  // Render the most common result shapes compactly. Falls back to a
  // truncated JSON dump for shapes we don't know about.
  const list =
    preview.mentors || preview.investors || preview.partners || preview.deals || preview.tasks;
  if (Array.isArray(list)) {
    if (list.length === 0) {
      return <div className="text-xs text-gray-500 dark:text-gray-400 italic">No matches yet.</div>;
    }
    return (
      <ul className="text-xs space-y-1">
        {list.slice(0, 5).map((row) => (
          <li key={row.id} className="leading-snug">
            <span className="font-medium">{row.title || row.name}</span>
            {row.snippet && <span className="text-gray-600 dark:text-gray-400"> — {row.snippet}</span>}
          </li>
        ))}
      </ul>
    );
  }
  if (preview.page) {
    return <div className="text-xs text-gray-700 dark:text-gray-300">Opening {preview.page}.</div>;
  }
  if (preview.gated) {
    return <div className="text-xs text-gray-700 dark:text-gray-300">{preview.feature} requires the {preview.required_tier} tier.</div>;
  }
  return null;
}

function CtaButtons({ cta, onCtaClick }) {
  // The CTA's `route` is always a relative app-router path. We use
  // <Link> for SPA navigation (no full reload) and fire the
  // onCtaClick side-effect so the host can refresh progress /
  // telemetry the moment the user routes.
  if (!cta || !cta.primary) return null;
  const fire = (which) => () => {
    // Some CTAs (surfacePaywall) request the global PaywallModal in
    // addition to navigating; the modal listens for `studioos:tier_required`.
    if (cta.action === 'open_paywall') {
      try {
        window.dispatchEvent(new CustomEvent('studioos:tier_required', {
          detail: { required: cta.required_tier || 'tier_required' },
        }));
      } catch { /* non-fatal */ }
    }
    try { onCtaClick && onCtaClick({ which, cta }); } catch { /* non-fatal */ }
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Link
        to={cta.primary.route}
        onClick={fire('primary')}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition"
      >
        {cta.primary.label} <ArrowRight size={12} />
      </Link>
      {cta.secondary && (
        <Link
          to={cta.secondary.route}
          onClick={fire('secondary')}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 text-xs font-medium hover:bg-violet-50 dark:hover:bg-violet-950/40 transition"
        >
          {cta.secondary.label}
        </Link>
      )}
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
          <div className="text-[11px] uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold flex items-center gap-1.5">
            <span>Tutor</span>
            {tutor.fallback_used && !tutor.streaming && (
              <span
                title={`Primary model unavailable — answered by ${tutor.model || 'fallback'}`}
                className="px-1 py-px rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[9px] font-medium normal-case tracking-normal"
              >
                fallback
              </span>
            )}
            {tutor.cached && !tutor.streaming && (
              <span
                title="Served from cache"
                className="px-1 py-px rounded bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 text-[9px] font-medium normal-case tracking-normal"
              >
                cached
              </span>
            )}
          </div>
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

function WeekBanner({ week }) {
  const w = Math.max(1, Math.min(4, Number(week) || 1));
  const labels = { 1: 'Customer Discovery', 2: 'Build', 3: 'Network', 4: 'Incorporate' };
  // Task #2 (AR) — explicit unlock copy so founders see what they
  // need to do to advance. Mirrors the MILESTONES catalog in
  // routes/spinout_lab.ts so the language stays in sync.
  const unlockCopy = {
    1: 'Brand basics & landing page unlock once you create your project and log 3 customer interviews.',
    2: 'Network features unlock once you fill in your brand basics.',
    3: 'Incorporation tools unlock once you complete your network milestones.',
    4: 'Finish incorporation to graduate from the Spin-Out Lab.',
  };
  return (
    <div className="px-4 py-2 border-b border-violet-100 dark:border-violet-900/40 bg-gradient-to-r from-violet-100/60 to-indigo-100/60 dark:from-violet-900/20 dark:to-indigo-900/20">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-semibold text-violet-800 dark:text-violet-200 flex-shrink-0">Spin-Out Lab · Week {w}</span>
          <span className="text-violet-700/80 dark:text-violet-300/80 truncate">{labels[w] || ''}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`w-6 h-1 rounded-full ${n <= w ? 'bg-violet-600' : 'bg-violet-200 dark:bg-violet-900/50'}`}
              title={`Week ${n}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-violet-700/80 dark:text-violet-300/80">
        {unlockCopy[w]}
      </div>
    </div>
  );
}

