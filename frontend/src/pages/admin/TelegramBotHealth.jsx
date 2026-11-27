import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, RefreshCw, Loader2 } from 'lucide-react';
import { channelsAdminApi } from '../../lib/api/channels.js';
import { Unreadable } from '../../ui';
import { healthLines } from './telegramBotHealth';

/**
 * D756 (#1895) — "Telegram Business bot (interviews)" on /admin/telegram, for
 * Super Admins only (AdminTelegram.jsx renders it for them and no one else).
 *
 * It reads `GET /api/admin/channels/telegram/webhook` once on mount and on
 * Check again, and draws the answer as sentences (telegramBotHealth.js). The
 * Worker returns codes and numbers only, never the token, the secret or the
 * URL Telegram reports. Register webhook calls the existing POST, says the
 * address Axal registered (Axal's own), then reads again. A refusal shows the
 * Worker's sentence (`e.message`). Telegram's error text is drawn as text.
 */

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
  bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200',
};
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

export default function TelegramBotHealth({ api = channelsAdminApi }) {
  // { status: 'loading' | 'ready' | 'unreadable', health }
  const [read, setRead] = useState({ status: 'loading', health: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(async () => {
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const health = await api.telegramHealth();
      if (live.current) setRead({ status: 'ready', health });
    } catch (e) {
      if (!live.current) return;
      // Secrets unset: the Worker answers 503 with their NAMES, which is an answer, not a failure.
      if (e?.code === 'not_configured' && e?.data?.configured === false) {
        setRead({ status: 'ready', health: { configured: false, missing: Array.isArray(e.data.missing) ? e.data.missing : [] } });
      } else {
        setRead({ status: 'unreadable', health: null });
      }
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const register = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.registerTelegramWebhook();
      if (!live.current) return;
      setNotice({ kind: 'ok', text: `Webhook registered at ${r?.url || 'Axal’s address'}.` });
      await load();
    } catch (e) {
      if (live.current) setNotice({ kind: 'err', text: e?.message || 'The webhook could not be registered.' });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const lines = read.status === 'ready' ? healthLines(read.health) : [];
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
      aria-label="Telegram Business bot (interviews)" data-testid="telegram-bot-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Bot className="h-4 w-4 text-violet-600" aria-hidden="true" /> Telegram Business bot (interviews)
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            The bot members add in Telegram › Settings › Telegram Business › Chatbots, so Axal can read the chats they choose. It is a different bot from the news bot this page manages below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={load} disabled={read.status === 'loading' || busy}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Check again
          </button>
          <button type="button" className={btn} onClick={register} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Register webhook
          </button>
        </div>
      </div>

      {notice && (
        <p role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`mt-3 text-sm ${notice.kind === 'err' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {notice.text}
        </p>
      )}

      {read.status === 'loading' && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Reading the bot’s health…</p>}
      {read.status === 'unreadable' && (
        <div className="mt-3">
          <Unreadable what="The bot’s health" claim="This is not a claim that it is broken." onRetry={load} />
        </div>
      )}
      {lines.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="telegram-bot-health-lines">
          {lines.map((l, i) => (
            <li key={i} className={`rounded-md border px-3 py-2 text-sm ${TONE[l.tone] || TONE.warn}`}>{l.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
