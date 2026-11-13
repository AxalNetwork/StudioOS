/**
 * Task #7 (IG) — Customer chat panel (paid tiers only).
 *
 * Thin floating panel that posts to `/api/customer-chat/send`. The worker
 * forwards to the Axal VC team Slack channel and stores the thread mapping
 * so replies (Slack Events API → /api/customer-chat/slack-reply) land back
 * on the user's history. Polls /thread every 20s while open.
 *
 * The Help Center help panel enforces tier eligibility and only mounts this
 * for Studio / Institutional / Partner / admin / advisor.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, X, Loader2, MessageSquare } from 'lucide-react';
import { api } from '../lib/api';

const POLL_MS = 20 * 1000;

export default function CustomerChatWidget({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [delivered, setDelivered] = useState(true);
  const pollRef = useRef(null);
  const endRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCustomerChatThread();
      const items = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(items);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load chat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [open, refresh]);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    // Optimistic append.
    const optimistic = { id: `local-${Date.now()}`, direction: 'in', body: text, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft('');
    try {
      const res = await api.sendCustomerChat(text);
      setDelivered(res?.slack_delivered !== false);
      // Pull canonical state so server-assigned ids replace the optimistic row.
      refresh();
    } catch (e) {
      setError(e?.message || 'Failed to send.');
      // Roll back the optimistic message on hard failure.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[170] flex justify-end items-end p-4 sm:p-6 print:hidden" role="dialog" aria-modal="true" aria-label="Chat with the Axal VC team">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm h-[70vh] sm:h-[600px] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-violet-600 dark:text-violet-300" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Chat with the Axal VC team</h3>
          </div>
          <button onClick={onClose} aria-label="Close chat" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50 dark:bg-gray-950/40">
          {loading && messages.length === 0 && (
            <div className="flex items-center justify-center py-10 text-gray-400 text-xs">
              <Loader2 size={14} className="animate-spin mr-1.5" /> Loading…
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="text-center text-xs text-gray-500 py-8 px-3">
              Send a message and the team will reply in this thread. Replies sync from Slack in near real-time.
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                m.direction === 'in'
                  ? 'ml-auto bg-violet-600 text-white rounded-br-sm'
                  : 'mr-auto bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-sm'
              }`}
            >
              {m.body}
              <div className={`mt-1 text-[10px] ${m.direction === 'in' ? 'text-violet-100' : 'text-gray-400'}`}>
                {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {error && (
          <div className="px-3 py-1.5 text-[11px] text-red-700 bg-red-50 border-t border-red-200">{error}</div>
        )}
        {!delivered && (
          <div className="px-3 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-t border-amber-200">
            Queued — Slack delivery is currently offline; the team will follow up by email.
          </div>
        )}

        <div className="border-t border-gray-200 dark:border-gray-800 p-2 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Type your message — Enter to send, Shift+Enter for newline"
            rows={2}
            maxLength={4000}
            className="flex-1 resize-none text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-100 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() || sending}
            className="h-9 px-3 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
