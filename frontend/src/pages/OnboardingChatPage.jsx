import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send } from 'lucide-react';
import { api } from '../lib/api';
import { track } from '../lib/funnel';
import { useAuth } from '../hooks/useAuthSync';

/**
 * Onboarding chatbot for fresh Google signups (Task #51 follow-up).
 *
 * Mirrors the chat panel in RegisterPage step 2 but for users who already
 * have a session (Google OAuth) — no email/turnstile/TOTP front-step. Uses
 * the same Workers AI Llama 3.1 8B endpoint (`/api/profiling/chat` →
 * `@cf/meta/llama-3.1-8b-instruct`) and on save flips the user's role from
 * 'pending' to the inferred persona, releasing the pending-gate in
 * App.jsx and landing them on the dashboard.
 */
export default function OnboardingChatPage() {
  const { user } = useAuth();
  const email = user?.email || '';

  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Welcome to Axal VC. To help us match you with the right partnership agreement, could you tell me which best describes your interest — are you a founder, investor, operator, or service partner?" },
  ]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, chatLoading]);

  // Task #2 — funnel: onboarding chat reached (post-auth profiling gate).
  useEffect(() => {
    track('onboarding_chat_view');
  }, []);

  const sendChat = async () => {
    const text = input.trim();
    if (!text || chatLoading || !email) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setChatLoading(true);
    setError('');
    try {
      const res = await api.profilingChat({ email, messages: next });
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(e.message);
      setMessages([...next, { role: 'assistant', content: "I'm having trouble reaching the AI assistant right now — but no problem, your answers are saved. You can keep going and click 'Save & continue' whenever you're ready, and an Axal VC admin will review your profile and follow up." }]);
    }
    setChatLoading(false);
  };

  const finish = async () => {
    if (messages.filter((m) => m.role === 'user').length < 1) {
      setError('Please answer at least one question before continuing.');
      return;
    }
    if (!email) {
      setError('Session expired. Please sign in again.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await api.profilingSave({ email, messages });
      // Task #2 — funnel: completed = saved with ≥1 user answer. Flushed by
      // the tracker's pagehide hook as the hard redirect below unloads.
      track('onboarding_chat_complete', {
        user_turns: messages.filter((m) => m.role === 'user').length,
      });
      // Task #66 — full-page redirect (not SPA navigate). RequireAuth in
      // App.jsx fetches `onboarding_progress` inside a useEffect keyed on
      // `[user?.id]`; after save the user id hasn't changed, so a soft
      // `navigate('/dashboard')` keeps the stale `onboardingComplete=false`
      // state and the chatbot gate immediately bounces the user back to
      // /onboarding/chat — re-mounting this component with an empty chat.
      // A hard reload remounts App.jsx so the effect re-runs and sees the
      // freshly-flipped `completed_at`.
      //
      // Task #9 — /save now returns the user's ACTUAL post-save role.
      // Fresh signups land in the 'exploring' holding state → route them
      // to the exploring dashboard, not /studio (which their role can't see).
      window.location.assign(
        saved?.role === 'exploring' ? '/exploring' : '/studio?profile_pending=1'
      );
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  // Task #1 — the chat is skippable. Saves whatever partial answers exist
  // (zero user turns is fine — /api/profiling/save only requires a messages
  // array) so the gate releases, then drops the user on the dashboard. They
  // can finish profiling later; admins see the partial transcript meanwhile.
  const skipForNow = async () => {
    if (!email) {
      setError('Session expired. Please sign in again.');
      return;
    }
    setSkipping(true);
    setError('');
    try {
      const saved = await api.profilingSave({ email, messages });
      // Task #2 — funnel: skipped (partial/zero answers still persisted).
      track('onboarding_chat_skip', {
        user_turns: messages.filter((m) => m.role === 'user').length,
      });
      // Same hard-reload rationale as finish() above. Task #9 — skip also
      // enters the 'exploring' holding state (suggested_role may be null;
      // the Personal Advisor's role detector fills it in later).
      window.location.assign(
        saved?.role === 'exploring' ? '/exploring' : '/dashboard'
      );
    } catch (e) {
      setError(e.message);
      setSkipping(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-start justify-center px-4 py-8 bg-[var(--app-bg)]">
      <div className="w-full max-w-xl bg-[var(--app-surface)] dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} className="text-violet-600" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Tell us about yourself</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Our AI assistant will profile your interest so an Axal VC admin can propose the right partnership agreement. Answer 5–8 quick questions, then save.
        </p>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <div ref={scrollRef} className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3 mb-3 h-80 overflow-y-auto space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white rounded-br-sm'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm'
              }`}>{m.content}</div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-500 text-xs px-3 py-2 rounded-lg rounded-bl-sm">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="Type your reply..."
            disabled={chatLoading || saving}
            className="flex-1 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendChat}
            disabled={chatLoading || saving || !input.trim()}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-3 text-white transition-colors"
          >
            <Send size={14} />
          </button>
        </div>

        <button
          onClick={finish}
          disabled={saving || skipping || chatLoading}
          className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors"
        >
          {saving ? 'Saving profile...' : 'Save & continue'}
        </button>
        {/* Task #1 — skippable onboarding: never trap an invited user in the
            chatbot. Partial answers are persisted; they can finish later. */}
        <button
          type="button"
          onClick={skipForNow}
          disabled={saving || skipping || chatLoading}
          className="w-full mt-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50 py-1.5 transition-colors"
        >
          {skipping ? 'Taking you to your dashboard…' : "Skip for now — I'll do this later"}
        </button>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center mt-2">
          Your answers help us tailor your workspace — you can update them anytime.
        </p>
      </div>
    </div>
  );
}
