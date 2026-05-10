/**
 * Task #5 — Pinned dashboard personal assistant.
 *
 * Floating bottom-right launcher → expands to a chat panel. Streams
 * replies via the worker's SSE endpoint at /api/assistant/message and
 * persists conversations server-side (see routes/assistant.ts).
 *
 * Mount once on the Dashboard. The component is hidden via CSS
 * @media print so it never appears on printed/exported pages.
 *
 * Markdown-lite rendering: paragraphs, **bold**, bullet lists, and
 * inline links. Links whose href starts with "/" are rendered as
 * react-router `<Link>` deep-link buttons; everything else opens in a
 * new tab.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare, X, Send, Loader2, Trash2, Edit3, Plus, ThumbsUp, ThumbsDown,
  ChevronLeft, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';

const STORAGE_LAST = 'assistant.lastConversationUid';
const STORAGE_OPEN = 'assistant.open';

// ── tiny markdown → JSX renderer (deliberately minimal). Supports:
//   **bold**, paragraphs, "- " bullets, and [label](url) links.
// Anything else is rendered as plain text. We DO NOT use dangerouslySetInnerHTML.
function renderInline(text) {
  const out = [];
  let i = 0;
  // Walk: links → bold → text. Order matters because bold can sit inside a link label.
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let lastIdx = 0;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(...renderBold(text.slice(lastIdx, m.index), `t${i++}`));
    const label = m[1]; const href = m[2];
    if (href.startsWith('/')) {
      out.push(
        <Link key={`l${i++}`} to={href}
          className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 text-xs font-medium rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700/40 hover:bg-violet-100">
          {label}
        </Link>
      );
    } else {
      out.push(
        <a key={`l${i++}`} href={href} target="_blank" rel="noreferrer noopener"
          className="text-violet-700 dark:text-violet-400 underline">{label}</a>
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(...renderBold(text.slice(lastIdx), `t${i++}`));
  return out;
}
function renderBold(text, keyBase) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, idx) => p.startsWith('**') && p.endsWith('**')
    ? <strong key={`${keyBase}-${idx}`}>{p.slice(2, -2)}</strong>
    : <React.Fragment key={`${keyBase}-${idx}`}>{p}</React.Fragment>);
}
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let buf = []; let inList = false; let listItems = [];
  const flushPara = () => { if (buf.length) { blocks.push({ kind: 'p', lines: buf }); buf = []; } };
  const flushList = () => { if (listItems.length) { blocks.push({ kind: 'ul', items: listItems }); listItems = []; } inList = false; };
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      inList = true;
      listItems.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flushPara(); flushList();
    } else {
      if (inList) flushList();
      buf.push(line);
    }
  }
  flushPara(); flushList();
  return blocks.map((b, i) => b.kind === 'ul'
    ? <ul key={i} className="list-disc pl-5 space-y-1 my-1.5">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
    : <p key={i} className="my-1.5 leading-relaxed">{renderInline(b.lines.join(' '))}</p>);
}

const STARTER_BY_ROLE = {
  founder: [
    { label: 'What\'s pending for me?', text: "What's pending for me right now? Show me anything I need to act on." },
    { label: 'How do I add a co-founder agreement?', text: 'How do I add a co-founder agreement?' },
    { label: 'Walk me through Spin-Out Lab', text: 'Walk me through the Spin-Out Lab.' },
  ],
  investor: [
    { label: 'Show top-scored deals', text: 'Show me the top-scored opportunities right now.' },
    { label: 'Where do I find Investor Signals?', text: 'Where do I find Investor Signals and how do I read them?' },
    { label: 'Upcoming meetings', text: 'What meetings do I have coming up?' },
  ],
  partner: [
    { label: 'Where can I see new deals?', text: 'Where can I see new deals coming through the network?' },
    { label: 'What\'s pending for me?', text: "What's pending for me?" },
    { label: 'Walk me through office hours', text: 'How do partner office hours work here?' },
  ],
  admin: [
    { label: 'Show admin analytics', text: 'How do I open the admin analytics dashboard?' },
    { label: 'What\'s pending across the platform?', text: 'Anything pending across the platform I should look at?' },
    { label: 'Recent platform activity', text: 'Show me recent platform activity.' },
  ],
};

export default function PersonalAssistant({ user }) {
  // Gate the entire component on the per-user enable flag, which the
  // worker flips to 1 at the end of role-detection onboarding (see
  // routes/onboarding.ts). Until that flips the user shouldn't see the
  // launcher at all.
  if (!user || user.assistant_enabled === 0 || user.assistant_enabled === false) return null;
  return <PersonalAssistantPanel user={user} />;
}

function PersonalAssistantPanel({ user }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_OPEN) === '1'; } catch { return false; }
  });
  const [conversations, setConversations] = useState([]);
  const [currentUid, setCurrentUid] = useState(() => {
    try { return localStorage.getItem(STORAGE_LAST) || null; } catch { return null; }
  });
  const [messages, setMessages] = useState([]);   // [{id?, role, content, model?, message_id?}]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState(null);
  const [view, setView] = useState('chat');       // 'chat' | 'list'
  const [renaming, setRenaming] = useState(null); // uid currently being renamed
  const [renameValue, setRenameValue] = useState('');
  const [feedbackSent, setFeedbackSent] = useState({}); // { [message_id]: 1 | -1 }
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const role = (user?.role || 'founder').toLowerCase();
  const firstName = (user?.name || '').split(' ')[0] || 'there';

  // Persist open state.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_OPEN, open ? '1' : '0'); } catch {}
  }, [open]);

  // Load conversation list when the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.assistant.listConversations();
        if (cancelled) return;
        setConversations(r.items || []);
      } catch (e) { if (!cancelled) setError(e.message); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Load the current conversation when uid changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (!currentUid) { setMessages([]); return; }
      try {
        const r = await api.assistant.getConversation(currentUid);
        if (cancelled) return;
        setMessages((r.messages || []).map(m => ({
          id: m.id, role: m.role, content: m.content, message_id: m.id, model: m.model,
        })));
      } catch (e) { if (!cancelled) { setError(e.message); setCurrentUid(null); } }
    })();
    return () => { cancelled = true; };
  }, [currentUid, open]);

  // Scroll to bottom on new content.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText, busy]);

  // Persist current uid.
  useEffect(() => {
    try {
      if (currentUid) localStorage.setItem(STORAGE_LAST, currentUid);
      else localStorage.removeItem(STORAGE_LAST);
    } catch {}
  }, [currentUid]);

  const roleLabel = useMemo(() => {
    const r = role || 'founder';
    return r.charAt(0).toUpperCase() + r.slice(1);
  }, [role]);
  const greeting = useMemo(() => (
    `Hi ${firstName} — I'm your StudioOS assistant for ${roleLabel}s. Here are a few things I can help you with right now:`
  ), [firstName, roleLabel]);

  const starters = STARTER_BY_ROLE[role] || STARTER_BY_ROLE.founder;

  async function sendMessage(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setError(null);
    setInput('');
    setBusy(true);
    setStreamingText('');
    // Optimistically append the user turn.
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    // SSE via fetch — same auth headers as the rest of the app. We can't
    // use the helper because it parses JSON.
    const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    const csrf = (() => {
      if (typeof document === 'undefined') return null;
      for (const part of (document.cookie || '').split(';')) {
        const t = part.trim(); const eq = t.indexOf('=');
        if (eq > 0 && t.slice(0, eq) === 'studioos_csrf') return t.slice(eq + 1);
      }
      return null;
    })();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/assistant/message', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ conversation_uid: currentUid, message: text }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`assistant ${res.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let assembled = '';
      let doneInfo = null;
      let convInfo = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const lines = chunk.split('\n');
          let event = 'message'; let dataStr = '';
          for (const ln of lines) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }
          if (event === 'conversation') {
            convInfo = data;
            if (!currentUid) setCurrentUid(data.uid);
          } else if (event === 'delta') {
            assembled += data.text || '';
            setStreamingText(assembled);
          } else if (event === 'tool_call') {
            // Surface a subtle inline status line — folded into the streaming text.
            assembled += '';
          } else if (event === 'done') {
            doneInfo = data;
          } else if (event === 'error') {
            throw new Error(data.message || 'assistant error');
          }
        }
      }
      // Commit final assistant turn.
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assembled,
        message_id: doneInfo?.message_id,
        model: doneInfo?.model,
      }]);
      setStreamingText('');
      // Refresh conversation list (title may have been seeded from first user msg).
      try {
        const r = await api.assistant.listConversations();
        setConversations(r.items || []);
        if (convInfo?.uid && !currentUid) setCurrentUid(convInfo.uid);
      } catch {}
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Send failed');
      // Roll back the optimistic user turn if we never got a stream.
      if (!streamingText) {
        setMessages(prev => prev.slice(0, -1));
        setInput(text);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function newConversation() {
    setCurrentUid(null);
    setMessages([]);
    setStreamingText('');
    setError(null);
    setView('chat');
  }

  async function deleteConversation(uid) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await api.assistant.deleteConversation(uid);
      setConversations(prev => prev.filter(c => c.uid !== uid));
      if (uid === currentUid) { setCurrentUid(null); setMessages([]); }
    } catch (e) { setError(e.message); }
  }

  async function commitRename(uid) {
    const t = renameValue.trim();
    if (!t) { setRenaming(null); return; }
    try {
      await api.assistant.renameConversation(uid, t);
      setConversations(prev => prev.map(c => c.uid === uid ? { ...c, title: t } : c));
    } catch (e) { setError(e.message); }
    setRenaming(null); setRenameValue('');
  }

  async function rate(messageId, rating) {
    if (!messageId) return;
    try {
      await api.assistant.feedback(messageId, rating);
      setFeedbackSent(prev => ({ ...prev, [messageId]: rating }));
    } catch (e) { setError(e.message); }
  }

  // ── Launcher (collapsed) ────────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open personal assistant"
        className="fixed bottom-6 right-6 z-40 print:hidden flex items-center gap-2 px-4 py-3 rounded-full shadow-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition"
      >
        <Sparkles className="w-4 h-4" />
        Assistant
      </button>
    );
  }

  // ── Expanded panel ──────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-label="Personal assistant"
      className="fixed bottom-4 right-4 z-40 print:hidden w-[min(420px,calc(100vw-2rem))] h-[min(620px,calc(100vh-2rem))] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        {view === 'list' ? (
          <button onClick={() => setView('chat')} aria-label="Back to chat" className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
            <ChevronLeft className="w-4 h-4" />
          </button>
        ) : (
          <Sparkles className="w-4 h-4 text-violet-600" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {view === 'list' ? 'Conversations' : 'StudioOS Assistant'}
          </div>
        </div>
        {view === 'chat' && (
          <>
            <button onClick={() => setView('list')} title="Conversations" className="p-1.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 rounded">
              {conversations.length}
            </button>
            <button onClick={newConversation} title="New conversation" className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 rounded">
              <Plus className="w-4 h-4" />
            </button>
          </>
        )}
        <button onClick={() => setOpen(false)} aria-label="Close assistant" className="p-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      {view === 'list' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No conversations yet.</div>
          )}
          {conversations.map(c => (
            <div key={c.uid} className={`group rounded-lg border ${c.uid === currentUid ? 'border-violet-300 dark:border-violet-700 bg-violet-50/40 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'} px-3 py-2 flex items-center gap-2`}>
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => { setCurrentUid(c.uid); setView('chat'); }}
              >
                {renaming === c.uid ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(c.uid)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(c.uid); if (e.key === 'Escape') setRenaming(null); }}
                    className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1"
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {c.message_count} msgs · {new Date(c.updated_at).toLocaleDateString()}
                    </div>
                  </>
                )}
              </button>
              <button onClick={() => { setRenaming(c.uid); setRenameValue(c.title); }} title="Rename" className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-0 group-hover:opacity-100">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => deleteConversation(c.uid)} title="Delete" className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm text-gray-800 dark:text-gray-200">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                <div className="text-sm">{greeting}</div>
                <ul className="mt-2 space-y-1.5">
                  {starters.map((s, i) => (
                    <li key={i}>
                      <button
                        onClick={() => sendMessage(s.text)}
                        className="text-left text-sm text-violet-700 dark:text-violet-300 hover:underline"
                      >• {s.label}</button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'}`}>
                {m.role === 'user'
                  ? <div className="whitespace-pre-wrap">{m.content}</div>
                  : <div>{renderMarkdown(m.content) || <span className="italic text-gray-500">No response.</span>}</div>}
                {m.role === 'assistant' && m.message_id && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
                    <button onClick={() => rate(m.message_id, 1)} className={`p-0.5 rounded ${feedbackSent[m.message_id] === 1 ? 'text-emerald-600' : 'hover:text-emerald-600'}`} aria-label="Helpful">
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => rate(m.message_id, -1)} className={`p-0.5 rounded ${feedbackSent[m.message_id] === -1 ? 'text-red-600' : 'hover:text-red-600'}`} aria-label="Not helpful">
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                {renderMarkdown(streamingText)}
                <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-gray-400" />
              </div>
            </div>
          )}
          {error && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5">{error}</div>
          )}
        </div>
      )}

      {/* Composer */}
      {view === 'chat' && (
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(); }}
          className="border-t border-gray-200 dark:border-gray-700 p-2 flex items-end gap-2"
        >
          <textarea
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about a feature, what's pending…"
            disabled={busy}
            className="flex-1 resize-none text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 max-h-32"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      )}
    </div>
  );
}
