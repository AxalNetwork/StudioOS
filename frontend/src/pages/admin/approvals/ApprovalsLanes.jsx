/**
 * D5882 (#5882): Lanes (D4814, AP-06), moved out of AdminApprovals.jsx unchanged: each group's lane table and the page that maps them.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { HQ_LANES, LANE_FAILED, NOT_A_QUEUE, NOT_YET } from './approvalsModel';
import { hqBandLine, hqLaneViews, notifiesOf } from './inboxModel';
import { laneGroups, lanesBanner } from './lanesDecidedModel';
import { CARD, EYE, H2, LINK, MONO, NEW_PILL, PILL, SUB, TD, TH, WaitingCell } from './approvalsUi';
import { DressedDoor, HqDoor } from './approvalDoors';

/**
 * D4814 (AP-06): one group of the operations map — Lane · Waiting · Oldest ·
 * Notifies / owner · Reviewed in. A native board is tagged "Approvals board";
 * an unread lane says so with Try again, a lane not counted says why.
 */
export function LaneTable({ group, glanceLanes, onRetry }) {
  return (
    <section className={`${CARD} overflow-x-auto`} aria-labelledby={`approvals-lanes-${group.key}-h`} data-testid={`approvals-lanes-${group.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-3.5 py-3 dark:border-gray-700">
        <h2 id={`approvals-lanes-${group.key}-h`} className={H2}>{group.label}</h2>
        <span className={`${SUB} ${MONO}`} data-testid={`approvals-lanes-${group.key}-count`}>{group.waiting == null ? '…' : `${group.waiting} · ${group.lanes}`}</span>
      </div>
      <table className="w-full min-w-[760px]">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th scope="col" className={TH}>Lane</th><th scope="col" className={TH}>Waiting</th><th scope="col" className={TH}>Oldest</th><th scope="col" className={TH}>Notifies / owner</th><th scope="col" className={TH}>Reviewed in</th></tr></thead>
        <tbody>
          {group.rows.map((v) => {
            const notifies = notifiesOf(glanceLanes.find((l) => l.key === v.glance));
            return (
              <tr key={v.key} className={`border-b border-axal-hairline last:border-0 dark:border-gray-700 ${v.state === 'unreadable' ? 'bg-axal-destructive-tint/40 dark:bg-red-950/20' : ''}`} data-testid={`approvals-lane-${v.key}`}>
                <td className={TD}>
                  <b>{v.label}</b>
                  {v.native ? <span className={NEW_PILL} data-testid={`approvals-lane-native-${v.key}`}>Approvals board</span> : null}
                  {v.isNew ? <span className={NEW_PILL}>New</span> : null}
                  {v.note ? <div className={SUB}>{v.note}</div> : null}
                </td>
                <td className={TD}>
                  {v.state === 'ready' ? (
                    <>
                      <span className={MONO} data-testid={`approvals-lane-count-${v.key}`}>{v.count.toLocaleString('en-US')}</span> waiting
                      {v.overdue ? <span className={`ml-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL.bad}`} data-testid={`approvals-lane-overdue-${v.key}`}>{`${v.overdue.toLocaleString('en-US')} overdue`}</span> : null}
                    </>
                  ) : <WaitingCell v={v} onRetry={onRetry} />}
                </td>
                <td className={TD}>
                  {v.state === 'unreadable' ? <span className={SUB}>— not read</span>
                    : v.state === 'ready' && v.count > 0 ? (v.age ? <span className={MONO}>{`oldest ${v.age}`}</span> : <><span className={SUB}>Not recorded</span><div className={SUB}>arrival time not kept</div></>)
                      : <span className={SUB}>—</span>}
                </td>
                <td className={TD} data-testid={`approvals-notifies-${v.key}`}>
                  {notifies.warn ? <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL.warn}`}>{notifies.text}</span>
                    : <span className={notifies.state === 'ready' ? '' : SUB}>{notifies.text}</span>}
                </td>
                <td className={TD}><DressedDoor lane={v.key} after=" →" className={LINK} plain={SUB} testId={`approvals-lane-door-${v.key}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Lanes (APR2). D4814 (AP-06): an operations map — the banner when a lane
 * could not be read, the groups with their totals, HQ decides (a Super
 * Admin's table, a locked line for an Admin), and the five places that are
 * not approval queues, collapsed at the bottom.
 */
export function Lanes({ views, glance, inbox, superAdmin }) {
  const ap = glance.hq?.approvals;
  const glanceLanes = ap?.kind === 'ready' ? ap.lanes : [];
  const hq = hqLaneViews(ap?.hqDecides ?? null);
  const groups = laneGroups(views, inbox.status === 'ready' ? inbox.reply : null);
  const banner = lanesBanner(views);
  return (
    <div className="flex flex-col gap-3.5" data-testid="approvals-lanes">
      <div className="flex flex-col gap-0.5">
        <h2 className={H2}>Approval lanes</h2>
        <p className={`m-0 ${SUB}`}>Where admin decisions enter the platform and where each one is reviewed.</p>
      </div>
      {banner ? (
        <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 border-axal-destructive-edge px-4 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:text-red-300`} data-testid="approvals-lanes-banner">
          <span><b>{banner.text}</b> {banner.names}</span>
          <button type="button" className="font-bold underline" onClick={glance.reload}>Try again</button>
        </div>
      ) : null}
      {groups.map((g) => <LaneTable key={g.key} group={g} glanceLanes={glanceLanes} onRetry={glance.reload} />)}
      {superAdmin ? (
        <section className={`${CARD} overflow-x-auto`} data-testid="approvals-hq-lanes">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-3.5 py-3 dark:border-gray-700">
            <h2 className={H2}>HQ decides — Super Admin only</h2>
            <span className={SUB}>{hqBandLine(ap?.hqDecides ?? null) || 'Only Super Admins see this group.'}</span>
          </div>
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th scope="col" className={TH}>Lane</th><th scope="col" className={TH}>Waiting</th><th scope="col" className={TH}>Oldest</th><th scope="col" className={TH}>Notifies / owner</th><th scope="col" className={TH}>Reviewed in</th></tr></thead>
            <tbody>
              {hq.map((l) => (
                <tr key={l.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-hq-${l.key}`}>
                  <td className={TD}><b>{l.label}</b></td>
                  <td className={TD} data-testid={`approvals-hq-count-${l.key}`}>
                    {l.state === 'ready' ? <><span className={MONO}>{l.count.toLocaleString('en-US')}</span> waiting</>
                      : l.state === 'unreadable' ? <span title={l.reason} className="cursor-help text-axal-destructive dark:text-red-300">{LANE_FAILED}</span>
                        : <span title={l.reason} className={`cursor-help ${SUB}`}>{NOT_YET}</span>}
                  </td>
                  <td className={TD}>{l.state === 'ready' && l.count > 0 ? <span className={MONO}>{l.age ? `oldest ${l.age}` : 'Not recorded'}</span> : <span className={SUB}>—</span>}</td>
                  <td className={TD}>{l.notifies?.text || <span className={SUB}>Super Admin</span>}</td>
                  <td className={TD}><HqDoor lane={l} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className={`${CARD} flex flex-wrap items-center justify-between gap-2 px-4 py-3`} data-testid="approvals-hq-locked">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className={`${EYE} text-axal-ink dark:text-gray-100`}>HQ decides — Super Admin only</span>
            <span className={SUB}>{`${HQ_LANES.length} HQ lanes are visible to Super Admins. You are signed in as Admin.`}</span>
          </span>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL.plain}`}>🔒 Super Admin</span>
        </section>
      )}
      <details className={`${CARD} px-4 py-3`} data-testid="approvals-not-a-queue">
        <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 sm:min-h-0">
          <b className="text-[13px] text-axal-ink dark:text-gray-100">{`Not approval queues · ${NOT_A_QUEUE.length}`}</b>
          <span className={SUB}>Nothing in them waits on an admin.</span>
        </summary>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          <li className={SUB}><Link to="/admin/directory" className={LINK}>Directory</Link>: {NOT_A_QUEUE[0].reason}</li>
          <li className={SUB}><Link to="/admin/circles" className={LINK}>Circles</Link>: {NOT_A_QUEUE[1].reason}</li>
          <li className={SUB}><Link to="/admin/partner-invitations" className={LINK}>Partner invitations</Link>: {NOT_A_QUEUE[2].reason}</li>
          <li className={SUB}><Link to="/admin/programs/mentor-cohorts/people" className={LINK}>Mentor cohort access</Link>: {NOT_A_QUEUE[3].reason}</li>
          <li className={SUB}><Link to="/admin/programs/spinout-lab/formation" className={LINK}>83(b) follow-ups and formation packets</Link>: {NOT_A_QUEUE[4].reason}</li>
        </ul>
      </details>
    </div>
  );
}
