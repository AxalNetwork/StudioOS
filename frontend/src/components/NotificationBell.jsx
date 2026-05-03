import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCheck, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

// Phase 0.2 — Notification bell (top-bar surface).
// Polls /unread-count every 30s and lazy-loads the dropdown list on open.
// Real-time push rides the existing pipeline overview WebSocket via the
// `notification` event-type filtered by user_id.

function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function NotificationBell({ userId }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const popRef = useRef(null);
  const wsRef = useRef(null);

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
    } catch {
      setItems([]);
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
    if (next) await loadList();
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
        <div className="absolute right-0 mt-2 w-96 max-h-[28rem] overflow-hidden bg-white border border-gray-200 rounded-xl shadow-xl z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Notifications</div>
            <div className="flex items-center gap-2">
              <button onClick={markAll} title="Mark all read"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500" disabled={!count}>
                <CheckCheck size={14} />
              </button>
              <button onClick={() => { setOpen(false); navigate('/settings/notifications'); }} title="Notification settings"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                <SettingsIcon size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && <div className="px-4 py-6 text-sm text-gray-500 text-center">Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="px-4 py-8 text-sm text-gray-500 text-center">You're all caught up.</div>
            )}
            {!loading && items.map((n) => (
              <button key={n.id} onClick={() => onItemClick(n)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${n.read_at ? '' : 'bg-violet-50/40'}`}>
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 w-2 h-2 rounded-full bg-violet-600 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.body}</div>}
                    <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide">
                      {n.type} · {timeAgo(n.created_at)} ago
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
