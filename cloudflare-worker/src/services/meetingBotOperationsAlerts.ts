/** D886 B10: atomic alert receipt + existing in-app inbox, without new schema. */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { botAlertNotification, type BotAlert } from './meetingBotOperations';
import { readMeetingBotOperations } from './meetingBotOperationsRead';

export async function recordMeetingBotAlert(env: Env, alert: BotAlert, episode: string): Promise<number> {
  if (branchOf(env)) return 0;
  const recipients = await env.DB.prepare(`SELECT u.id,u.notification_prefs FROM super_admins s JOIN users u ON u.id=s.user_id
    WHERE u.is_active=1 AND u.role='admin'`).all<{ id: number; notification_prefs: string | null }>();
  if ((recipients.success as unknown) === false || !Array.isArray(recipients.results)) throw new Error('meeting_bot_recipients_unreadable');
  let recorded = 0;
  for (const user of recipients.results) {
    let prefs: any = {};
    try { prefs = JSON.parse(user.notification_prefs || '{}'); } catch { /* default on, like notify() */ }
    const enabled = prefs?.meeting_bot_operations?.in_app;
    if (enabled !== undefined && enabled !== true) continue;
    const n = botAlertNotification(user.id, alert), token = crypto.randomUUID();
    // D1 batch is transactional. Unique notifications(user_id,kind,dedupe_key)
    // elects one publisher; only its token may insert the actual bell item.
    // If the inbox fails, the receipt rolls back and a later sweep can retry.
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO notifications(user_id,kind,title,body,link,meta,dedupe_key)
        VALUES(?,?,?,?,?,?,?)`).bind(user.id,n.type,n.title,n.body,n.link,token,episode),
      env.DB.prepare(`INSERT INTO notifications_inbox(user_id,type,title,body,link,payload,channel,category)
        SELECT ?,?,?,?,?,?,'in_app','operations' WHERE EXISTS
        (SELECT 1 FROM notifications WHERE user_id=? AND kind=? AND dedupe_key=? AND meta=?)`)
        .bind(user.id,n.type,n.title,n.body,n.link,JSON.stringify(n.payload),user.id,n.type,episode,token),
    ]);
    if (result.some(r => (r.success as unknown) === false)) throw new Error('meeting_bot_alert_unreadable');
    recorded += result[1].meta.changes ?? 0;
  }
  return recorded;
}

export async function sweepMeetingBotOperations(env: Env, now = Date.now()) {
  if (branchOf(env)) return;
  const report = await readMeetingBotOperations(env, now);
  if (report.state === 'unreadable') throw new Error('meeting_bot_operations_unreadable');
  if (report.state !== 'ok') return;
  const day = new Date(now).toISOString().slice(0,10);
  for (const alert of report.alerts) {
    // Daily rate/markup reminders; heartbeat receipt is tied to the stalled
    // run, not a fresh notification every time the cron sees the same run.
    if (alert.kind === 'missed_heartbeat') {
      const rows = await env.DB.prepare(`SELECT uid FROM meeting_bots WHERE platform=?
        AND status IN ('joining','waiting_room','recording') AND heartbeat_at < ?`)
        .bind(alert.platform,now - 120_000).all<{ uid: string }>();
      if ((rows.success as unknown) === false || !Array.isArray(rows.results)) throw new Error('meeting_bot_heartbeat_unreadable');
      for (const row of rows.results) await recordMeetingBotAlert(env, { ...alert, runs: 1 }, `meeting-bot:heartbeat:${row.uid}`);
    } else {
      await recordMeetingBotAlert(env, alert, `meeting-bot:${alert.kind}:${alert.kind === 'failure_rate' ? alert.platform : 'all'}:${day}`);
    }
  }
}
