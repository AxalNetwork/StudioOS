import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { eadwynApi } from '../lib/api/eadwyn';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';

/**
 * D652 (#1464) — asking Eadwyn, with connectors. The canvas is
 * `Connectors Page.dc.html`, screens `rail` and `railList`.
 *
 * WHAT IT ADDS TO THE RAIL. Until this the rail could only read its page back.
 * This is the composer under it: a question box with a "+" that opens "Add a
 * file" and "Connectors ›", the conversation above it, and, when Eadwyn
 * proposes a write, a card with Send and Cancel.
 *
 * THE SWITCHES ARE THE CONVERSATION'S. Each conversation starts with every
 * connector off; turning one on is stored on that conversation in the Worker
 * (`PUT /api/eadwyn/conversations/:uid/connectors`), so a reload keeps it and
 * a new conversation does not inherit it. The rail remembers which
 * conversation was open per workspace, and nothing else.
 *
 * NOTHING IS SENT WITHOUT SEND. A run never writes. A write Eadwyn would make
 * comes back as an action, drawn as the card below with the exact payload the
 * Worker stored; Send calls confirm with no body, so what goes out is what the
 * card showed.
 */

const CONNECTORS_PAGE = '/account/connectors';
const MAX_FILE_CHARS = 8000;
const FILE_TYPES = '.txt,.md,.csv,.json';

const convKeyFor = (workspace) => `eadwyn.conversation.${workspace}`;

/** "12 min ago", from an ISO or D1 timestamp; '' when it cannot be read. */
export function freshness(asOf, now = Date.now()) {
  if (!asOf) return '';
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(asOf) ? asOf : `${String(asOf).replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The line under an answer that used a connector: "From Stripe · 12 min ago". */
export function sourceLine(source, now = Date.now()) {
  const when = freshness(source?.as_of, now);
  return `From ${source?.name || source?.key || 'a connector'} · ${when || 'time not recorded'}`;
}

const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function RouteLink({ to, children, ...rest }) {
  // The rail is rendered outside a router in some tests and previews.
  const inRouter = useInRouterContext();
  return inRouter ? <Link to={to} {...rest}>{children}</Link> : <a href={to} {...rest}>{children}</a>;
}

/** The "Connectors ›" list: each connection with its switch; greyed, with its reason, when it needs attention. */
export function ConnectorList({ connectors, enabled, onToggle, busy = false, error = '' }) {
  return (
    <div className="ead-list" data-testid="eadwyn-connector-list">
      <div className="ead-list-head">
        <RouteLink to={`${CONNECTORS_PAGE}?tab=discover`} data-testid="link-eadwyn-browse-connectors">Browse connectors</RouteLink>
        <RouteLink to={CONNECTORS_PAGE} data-testid="link-eadwyn-manage-connectors">Manage connectors</RouteLink>
      </div>
      {error && <p className="ead-note">{error}</p>}
      {!error && connectors.length === 0 && (
        <p className="ead-note">No connectors yet. Browse connectors to add one.</p>
      )}
      {connectors.map((c) => {
        const on = enabled.includes(c.key);
        const blocked = !!c.reason;
        return (
          <div key={c.key} className={`ead-conn${blocked ? ' is-blocked' : ''}`} data-testid={`eadwyn-connector-${c.key}`}>
            <span className="ead-conn-name">
              <span className="ead-conn-icon" aria-hidden="true">{initials(c.name)}</span>
              <span className="ead-conn-text">
                <span>{c.name}</span>
                {blocked && <span className="ead-conn-why">{c.reason}</span>}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on && !blocked}
              aria-label={`Use ${c.name} in this conversation`}
              className={`ead-switch${on && !blocked ? ' is-on' : ''}`}
              disabled={blocked || busy}
              onClick={() => onToggle(c.key, !on)}
              data-testid={`switch-eadwyn-${c.key}`}
            >
              <span className="ead-knob" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The card for a write Eadwyn proposed. Send and Cancel only while it is pending. */
export function ActionCard({ action, onSend, onCancel, busy = false }) {
  const name = action.connector_name || action.connector;
  const payload = JSON.stringify(action.payload);
  const done = {
    sent: `Sent to ${name}.${action.result_summary ? ` ${action.result_summary}` : ''}`,
    cancelled: 'Cancelled. Nothing was sent.',
    failed: `Not sent: ${action.result_summary || 'the connector refused it.'}`,
    expired: 'This expired before it was sent. Ask again for a fresh one.',
    sending: 'Sending…',
  }[action.status];
  return (
    <div className={`ead-action is-${action.status}`} data-testid={`eadwyn-action-${action.uid}`}>
      <span className="ead-action-title">{action.status === 'pending' ? `Ready to send to ${name}` : name}</span>
      <span className="ead-action-what">
        {action.target}{action.summary ? ` · ${action.summary}` : ''}
      </span>
      <code className="ead-action-payload" data-testid="text-eadwyn-action-payload">{payload}</code>
      {action.status === 'pending' ? (
        <div className="ead-action-buttons">
          <button type="button" className="ead-send" disabled={busy} onClick={() => onSend(action.uid)} data-testid="button-eadwyn-send">Send</button>
          <button type="button" className="ead-cancel" disabled={busy} onClick={() => onCancel(action.uid)} data-testid="button-eadwyn-cancel">Cancel</button>
        </div>
      ) : (
        <span className="ead-action-done">{done}</span>
      )}
    </div>
  );
}

/** The conversation: each turn, the source lines under an answer, and its action card. */
export function EadwynThread({ messages, actions, onSend, onCancel, busyAction = '', now = Date.now() }) {
  const byUid = new Map((actions || []).map((a) => [a.uid, a]));
  return (
    <div className="ead-thread" data-testid="eadwyn-thread">
      {messages.map((m) => (
        <div key={m.id} className={`ead-msg ead-msg-${m.role}`} data-testid={`eadwyn-message-${m.role}`}>
          <p>{m.content}</p>
          {m.role === 'assistant' && (m.sources || []).map((s) => (
            <span key={s.key} className="ead-source" data-testid="text-eadwyn-source">{sourceLine(s, now)}</span>
          ))}
          {m.action_uid && byUid.has(m.action_uid) && (
            <ActionCard action={byUid.get(m.action_uid)} onSend={onSend} onCancel={onCancel} busy={busyAction === m.action_uid} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function EadwynComposer({ workspace, model, page, onRan }) {
  const [uid, setUid] = useState(() => safeReadJSON(convKeyFor(workspace), null));
  const [conv, setConv] = useState({ messages: [], actions: [], connectors: [] });
  const [connectors, setConnectors] = useState(null);
  const [connectorsError, setConnectorsError] = useState('');
  const [menu, setMenu] = useState('closed'); // closed | menu | list
  const [question, setQuestion] = useState('');
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ asking: false, note: '', receipt: null });
  const [busyAction, setBusyAction] = useState('');
  const [switching, setSwitching] = useState(false);
  const fileInput = useRef(null);

  const remember = useCallback((next) => {
    setUid(next);
    safeWriteJSON(convKeyFor(workspace), next);
  }, [workspace]);

  // Reopen the conversation this workspace had open. Gone (deleted, or
  // another account's) means start fresh, not an error.
  useEffect(() => {
    if (!uid) return;
    let live = true;
    eadwynApi.conversation(uid)
      .then((r) => {
        if (!live) return;
        setConv({ messages: r.messages || [], actions: r.actions || [], connectors: r.conversation?.connectors || [] });
      })
      .catch(() => { if (live) remember(null); });
    return () => { live = false; };
  }, [uid, remember]);

  const loadConnectors = useCallback(() => {
    setConnectorsError('');
    eadwynApi.connectors()
      .then((r) => setConnectors(r.connectors || []))
      .catch(() => { setConnectors([]); setConnectorsError('Your connectors could not be read.'); });
  }, []);

  const ensureConversation = useCallback(async () => {
    if (uid) return uid;
    const r = await eadwynApi.start(workspace);
    const next = r?.conversation?.uid;
    if (!next) throw new Error('The conversation could not be started.');
    remember(next);
    setConv({ messages: [], actions: [], connectors: [] });
    return next;
  }, [uid, workspace, remember]);

  const toggle = useCallback(async (key, on) => {
    setSwitching(true);
    try {
      const id = await ensureConversation();
      const keys = on ? [...new Set([...conv.connectors, key])] : conv.connectors.filter((k) => k !== key);
      const r = await eadwynApi.setConnectors(id, keys);
      setConv((c) => ({ ...c, connectors: r?.connectors || [] }));
    } catch (e) {
      setConnectorsError(e?.message || 'That switch could not be saved.');
    } finally {
      setSwitching(false);
    }
  }, [conv.connectors, ensureConversation]);

  const pickFile = useCallback(async (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    const text = await f.text().catch(() => '');
    setFile({ name: f.name, text: text.slice(0, MAX_FILE_CHARS), cut: text.length > MAX_FILE_CHARS });
  }, []);

  const ask = useCallback(async (ev) => {
    ev?.preventDefault?.();
    const q = question.trim();
    if (!q || state.asking) return;
    setState({ asking: true, note: '', receipt: null });
    try {
      const id = await ensureConversation();
      const r = await eadwynApi.ask(id, { question: q, model: model || undefined, page: page || undefined, file: file ? { name: file.name, text: file.text } : undefined });
      const fresh = await eadwynApi.conversation(id);
      setConv({ messages: fresh.messages || [], actions: fresh.actions || [], connectors: fresh.conversation?.connectors || [] });
      setQuestion('');
      setFile(null);
      setState({ asking: false, note: '', receipt: r?.usage || null });
      onRan?.();
    } catch (e) {
      setState({ asking: false, note: e?.message || 'The model could not be reached. Nothing was run.', receipt: null });
    }
  }, [question, state.asking, ensureConversation, model, page, file, onRan]);

  const decide = useCallback(async (actionUid, send) => {
    setBusyAction(actionUid);
    try {
      const r = send ? await eadwynApi.confirmAction(actionUid) : await eadwynApi.cancelAction(actionUid);
      if (r?.action) setConv((c) => ({ ...c, actions: c.actions.map((a) => (a.uid === actionUid ? r.action : a)) }));
    } catch (e) {
      setState((s) => ({ ...s, note: e?.message || 'That could not be done.' }));
      if (uid) {
        eadwynApi.conversation(uid).then((fresh) => setConv((c) => ({ ...c, actions: fresh.actions || c.actions }))).catch(() => {});
      }
    } finally {
      setBusyAction('');
    }
  }, [uid]);

  const startOver = useCallback(() => {
    remember(null);
    setConv({ messages: [], actions: [], connectors: [] });
    setState({ asking: false, note: '', receipt: null });
  }, [remember]);

  const removeConversation = useCallback(async () => {
    if (!uid) return;
    await eadwynApi.remove(uid).catch(() => {});
    startOver();
  }, [uid, startOver]);

  const openList = () => {
    setMenu('list');
    if (connectors === null) loadConnectors();
  };

  return (
    <section className="fwr-block ead" data-testid="eadwyn-composer">
      <span>Ask Eadwyn</span>
      {conv.messages.length > 0 && (
        <>
          <EadwynThread
            messages={conv.messages}
            actions={conv.actions}
            onSend={(id) => decide(id, true)}
            onCancel={(id) => decide(id, false)}
            busyAction={busyAction}
          />
          <div className="ead-thread-tools">
            <button type="button" className="ead-link" onClick={startOver} data-testid="button-eadwyn-new">New conversation</button>
            <button type="button" className="ead-link" onClick={removeConversation} data-testid="button-eadwyn-delete">Delete this conversation</button>
          </div>
        </>
      )}
      {state.receipt && (
        <p className="fwr-foot-note" data-testid="text-eadwyn-receipt">
          {state.receipt.connectors_read?.length
            ? `Read: ${state.receipt.connectors_read.join(', ')}`
            : 'Read no connector'}
        </p>
      )}
      {state.note && <p className="fwr-absent" data-testid="text-eadwyn-note">{state.note}</p>}

      <form className="ead-compose" onSubmit={ask}>
        {menu !== 'closed' && (
          <div className="ead-menu" data-testid="eadwyn-plus-menu">
            {menu === 'menu' ? (
              <>
                <button type="button" className="ead-menu-item" onClick={() => { setMenu('closed'); fileInput.current?.click(); }} data-testid="button-eadwyn-add-file">Add a file</button>
                <button type="button" className="ead-menu-item ead-menu-sub" onClick={openList} data-testid="button-eadwyn-connectors">Connectors <span aria-hidden="true">›</span></button>
              </>
            ) : (
              <ConnectorList
                connectors={connectors || []}
                enabled={conv.connectors}
                onToggle={toggle}
                busy={switching}
                error={connectorsError}
              />
            )}
          </div>
        )}
        {file && (
          <span className="ead-file" data-testid="text-eadwyn-file">
            {file.name}{file.cut ? ' (first 8,000 characters)' : ''}
            <button type="button" className="ead-link" onClick={() => setFile(null)} aria-label="Remove the file">×</button>
          </span>
        )}
        <div className="ead-compose-row">
          <button
            type="button"
            className="ead-plus"
            aria-label="Add a file or a connector"
            aria-expanded={menu !== 'closed'}
            onClick={() => setMenu((m) => (m === 'closed' ? 'menu' : 'closed'))}
            data-testid="button-eadwyn-plus"
          >+</button>
          <textarea
            className="ead-input"
            rows={2}
            maxLength={2000}
            placeholder="Ask Eadwyn…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) ask(e); }}
            data-testid="input-eadwyn-question"
          />
          <button type="submit" className="fwr-run ead-ask" disabled={!question.trim() || state.asking} data-testid="button-eadwyn-ask">
            {state.asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <input ref={fileInput} type="file" accept={FILE_TYPES} hidden onChange={pickFile} data-testid="input-eadwyn-file" />
      </form>
      <p className="ead-note">Eadwyn never sends anything on its own. A change for a connector waits for your Send.</p>
    </section>
  );
}
