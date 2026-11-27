import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded, Unreadable } from '../../ui';
import { LoadingRows, BTN } from './AccountCenter';
import { Group, Row } from './ConnectorSheet';
import { MEMBER_GROUPS, READS_ROW, USE_DOORS, landsWords, neverRows, usesRows, viaRow } from './mercuryModel';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';

// ── A member's own Mercury (D715 PR 3, decision 8) ────────────────────────────
//
// `ConnectorPanel` draws these for the personal row (`isPersonalMercury`) in
// its `pre`, `pro` and `detail` views, in place of what a syncing connector
// shows: what it pulls in and sends out, the companies it serves, and Sync.
// No canvas covers them yet; they use the sheet's own `Group` and `Row`.

/**
 * "What StudioOS uses it for" and "What it never does" (PR 3b). The uses come
 * from one `GET /api/mercury/personal/status` when the group mounts: a row per
 * use the caller's profile holds, in decision 8's words. With none left it
 * reads Not recorded with its reason; a failed read is Unreadable, and the
 * never rows still draw, in the viewer's role's words (`neverRows(role)`,
 * D752). Each row links the screen where that use happens (`USE_DOORS`,
 * #1780's canvas PR, on #1778's screens); a use with no screen has no door.
 */
export function MercuryUsesGroups({ api = mercuryPersonalApi, role = null }) {
  const [read, setRead] = useState({ status: 'loading', uses: null });
  const load = useCallback(() => {
    let live = true;
    setRead({ status: 'loading', uses: null });
    api.status().then(
      (r) => { if (live) setRead({ status: 'ready', uses: usesRows(r) }); },
      () => { if (live) setRead({ status: 'unreadable', uses: null }); },
    );
    return () => { live = false; };
  }, [api]);
  useEffect(() => load(), [load]);
  return (
    <>
      <Group label={MEMBER_GROUPS.uses}>
        {read.status === 'loading' && <div className="px-3 py-2"><LoadingRows lines={2} /></div>}
        {read.status === 'unreadable' && (
          <div className="px-3 py-2" data-testid="mercury-uses-unreadable">
            <Unreadable what="Which uses your profile allows" claim="This is not a claim that it allows none." onRetry={load} />
          </div>
        )}
        {read.status === 'ready' && (read.uses.rows.length
          ? read.uses.rows.map((u) => {
            const door = Object.hasOwn(USE_DOORS, u.key) ? USE_DOORS[u.key] : null;
            return <Row key={u.key} a={u.text} action={door ? <Link className={BTN.link} to={door.href} data-testid={`mercury-door-${u.key}`}>{door.text}</Link> : null} />;
          })
          : <Row a={<Unrecorded reason={read.uses.reason}>Not recorded</Unrecorded>} />)}
      </Group>
      <Group label={MEMBER_GROUPS.never}>
        {neverRows(role).map((t) => <Row key={t} a={t} />)}
      </Group>
    </>
  );
}

/** "Where it lands", in the viewer's role's words; in place of the company ticks, which gate nothing for Mercury. */
export function MercuryLandsGroup({ role }) {
  const words = landsWords(role);
  return (
    <Group label={MEMBER_GROUPS.lands}>
      <Row a={words || <Unrecorded reason="Your profile has no Mercury of its own.">Not recorded</Unrecorded>} />
    </Group>
  );
}

/**
 * "How it reads", in place of the Sync group: a member's Mercury never syncs,
 * so there is no Sync now. D840 (#2346): a connected row also says how it
 * connected, a sign-in through Mercury's MCP server or a pasted token.
 */
export function MercuryReadsGroup({ conn = null }) {
  const via = viaRow(conn);
  return (
    <Group label={MEMBER_GROUPS.reads}>
      <Row a={READS_ROW} />
      {via && <div data-testid="mercury-via"><Row a={via} /></div>}
    </Group>
  );
}
