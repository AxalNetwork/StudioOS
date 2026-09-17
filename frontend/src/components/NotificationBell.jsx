import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCheck, Settings as SettingsIcon, BellRing, BellOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import NotificationList from './NotificationList';
import {
  isPushSupported,
  getPushState,
  enablePush,
  disablePush,
  sendPushTest,
} from '../lib/pwa';

// Phase 0.2 — Notification bell (top-bar surface).
// Polls /unread-count every 30s and lazy-loads the dropdown list on open.
// Real-time push rides the existing pipeline overview WebSocket via the
// `notification` event-type filtered by user_id.

export default function NotificationBell({ userId }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const navigate = useNavigate();
  const popRef = useRef(null);
  const wsRef = useRef(null);
  const [pushState, setPushState] = useState({ supported: false, subscribed: false, permission: 'default' });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  const refreshPush = useCallback(async () => {
    try { setPushState(await getPushState()); } catch {}
  }, []);

  const togglePush = useCallback(async () => {
    setPushBusy(true);
    setPushMsg('');
    try {
      if (pushState.subscribed) {
        await disablePush();
        setPushMsg('Push disabled on this device.');
      } else {
        await enablePush();
        setPushMsg('Push enabled — sending a test…');
        try { await sendPushTest(); } catch {}
      }
      await refreshPush();
    } catch (err) {
      setPushMsg(err?.message || 'Could not change push setting');
    } finally {
      setPushBusy(false);
      setTimeout(() => setPushMsg(''), 4000);
    }
  }, [pushState.subscribed, refreshPush]);

  const refreshCount = useCallback(async () => {
    try {
      const r = await api.notificationsUnreadCount();
      setCount(r?.count || 0);
    } catch {}
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listNotifications();
      setItems(r?.notifications || []);
      setUnreadable(false);
    } catch {
      // A FAILED READ IS NOT AN EMPTY INBOX. This used to fall through to `[]`,
      // which renders "You're all caught up" — a claim about the store that
      // nothing measured. The list says which of the two it is.
      setItems([]);
      setUnreadable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 30s as a robust fallback.
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 30_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Real-time push: piggyback on the pipeline overview WS already used by
  // PipelinePage. Filter messages addressed to the current user.
  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url;
    try {
      // Both auth carriers: ?token= for FastAPI dev (Starlette WS doesn't
      // read subprotocols easily), and `bearer.<jwt>` subprotocol for the
      // Cloudflare worker / RFC-compliant path. Servers honor whichever
      // they support — the other is ignored.
      url = `${proto}//${window.location.host}/api/pipeline/ws/overview?token=${encodeURIComponent(token)}`;
    } catch {
      return;
    }
    let ws;
    try {
      ws = new WebSocket(url, ['bearer.' + token]);
    } catch {
      return;
    }
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'notification' && Number(msg.user_id) === Number(userId)) {
          setCount((c) => c + 1);
          setItems((prev) => [msg.notification, ...prev].slice(0, 50));
        }
      } catch {}
    };
    ws.onerror = () => {};
    return () => { try { ws.close(); } catch {} };
  }, [userId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      await loadList();
      if (isPushSupported()) await refreshPush();
    }
  };

  const onItemClick = async (n) => {
    if (!n.read_at) {
      try { await api.markNotificationsRead({ ids: [n.id] }); } catch {}
      setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      setCount((c) => Math.max(0, c - 1));
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const markAll = async () => {
    try { await api.markNotificationsRead({ all: true }); } catch {}
    setItems((prev) => prev.map((x) => x.read_at ? x : { ...x, read_at: new Date().toISOString() }));
    setCount(0);
  };

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed left-1/2 -translate-x-1/2 sm:absolute sm:left-auto sm:right-0 sm:translate-x-0 mt-2 w-[calc(100vw-1rem)] max-w-sm sm:w-96 max-h-[28rem] overflow-hidden bg-white border border-gray-200 rounded-xl shadow-xl z-50 flex flex-col dark:bg-gray-900 dark:border-gray-800">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</div>
            <div className="flex items-center gap-2">
              <button onClick={markAll} title="Mark all read"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500" disabled={!count}>
                <CheckCheck size={14} />
              </button>
              <button onClick={() => { setOpen(false); navigate('/account/notifications'); }} title="Notification settings"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                <SettingsIcon size={14} />
              </button>
            </div>
          </div>
          {pushState.supported && (
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
              <button
                onClick={togglePush}
                disabled={pushBusy}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md ${
                  pushState.subscribed
                    ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                } ${pushBusy ? 'opacity-50 cursor-wait' : ''}`}
                title={pushState.subscribed ? 'Disable push on this device' : 'Enable push on this device'}
              >
                {pushState.subscribed ? <BellRing size={12} /> : <BellOff size={12} />}
                {pushBusy ? 'Working…' : (pushState.subscribed ? 'Push enabled' : 'Enable push')}
              </button>
              <span className="text-[11px] text-gray-500 truncate">
                {pushMsg || (pushState.subscribed ? 'Notifications on this device.' : 'Get pushes when away.')}
              </span>
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            <NotificationList
              items={items}
              loading={loading}
              unreadable={unreadable}
              onItemClick={onItemClick}
            />
          </div>
          {/* The dropdown has no URL, so this is how someone reaches the page
              that does — the same page `notify.ts` links to from email. */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => { setOpen(false); navigate('/inbox'); }}
              className="w-full text-center text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
            >
              See all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
