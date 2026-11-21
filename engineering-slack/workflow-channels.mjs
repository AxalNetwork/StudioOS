// D6370: reconcile trusted Actions completions into the durable Slack outbox, one intent per run attempt.
import catalog from '../engineering-notifications/workflow-channels.json' with { type: 'json' };
import { terminalAttempt } from '../engineering-notifications/events-v1.mjs';

const roles = new Map(catalog.workflows.filter(row => Number.isSafeInteger(row.id) && row.id > 0)
  .map(row => ['workflow:' + row.id, row.channel]));
export const workflowHashtag = role => roles.get(role);
const positiveId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
const pageSize = 100;

export class WorkflowLogRelay {
  constructor(outbox) {
    this.outbox = outbox;
    this.sql = outbox.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS workflow_log_cursor (id INTEGER PRIMARY KEY, sequence INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS workflow_log_unmapped (run TEXT NOT NULL, attempt TEXT NOT NULL, workflow TEXT, conclusion TEXT NOT NULL, occurred INTEGER NOT NULL, PRIMARY KEY (run, attempt))');
  }

  route(record) {
    const { workflow, run, attempt, conclusion, occurred } = record;
    const role = 'workflow:' + workflow;
    const channel = this.outbox.registry.channels[role];
    if (!channel || !workflowHashtag(role)) return false;
    const url = 'https://github.com/' + catalog.repository + '/actions/runs/' + run + '/attempts/' + attempt;
    this.outbox.insert({
      key: ['workflow-attempt', catalog.repository, workflow, run, attempt].join(':'),
      role, text: `[${conclusion}] Run ${run}, attempt ${attempt} · <${url}|Open GitHub Actions logs>`,
      createdAt: occurred,
    });
    return true;
  }

  accept(event) {
    if (event.family !== 'ci' || event.kind !== 'workflow_run' || !terminalAttempt(event)) return;
    if (event.repository !== catalog.repository || event.visibility !== 'public') throw new Error('workflow_source_mismatch');
    const { run, attempt, workflow } = event.ids;
    const occurred = Date.parse(event.occurredAt);
    if (!positiveId(run) || !positiveId(attempt) || !Number.isFinite(occurred)) throw new Error('workflow_attempt_invalid');
    const record = { run, attempt, workflow: positiveId(workflow) ? workflow : null, conclusion: event.state, occurred };
    if (this.route(record)) {
      this.sql.exec('DELETE FROM workflow_log_unmapped WHERE run = ? AND attempt = ?', run, attempt);
    } else {
      // Keep only the facts needed to recover after an operator registers the workflow.
      this.sql.exec('INSERT INTO workflow_log_unmapped (run, attempt, workflow, conclusion, occurred) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run, attempt) DO UPDATE SET workflow = COALESCE(excluded.workflow, workflow_log_unmapped.workflow)',
        run, attempt, record.workflow, record.conclusion, occurred);
    }
  }

  recoverMapped() {
    const ids = this.sql.exec('SELECT DISTINCT workflow FROM workflow_log_unmapped WHERE workflow IS NOT NULL').toArray();
    for (const { workflow } of ids) {
      if (!this.outbox.registry.channels['workflow:' + workflow]) continue;
      this.outbox.transaction(() => {
        const rows = this.sql.exec('SELECT * FROM workflow_log_unmapped WHERE workflow = ? ORDER BY occurred LIMIT 100', workflow).toArray();
        for (const row of rows) {
          if (this.route(row)) this.sql.exec('DELETE FROM workflow_log_unmapped WHERE run = ? AND attempt = ?', row.run, row.attempt);
        }
      });
    }
  }

  summary() {
    const [{ cursor, unmapped }] = this.sql.exec('SELECT COALESCE((SELECT sequence FROM workflow_log_cursor WHERE id = 1), 0) AS cursor, (SELECT COUNT(*) FROM workflow_log_unmapped) AS unmapped').toArray();
    return { cursor, unmapped };
  }

  async poll(source) {
    if (this.polling) return;
    this.polling = true;
    try {
      this.recoverMapped();
      let { cursor } = this.summary();
      // Advance only after processing each entire page. Bound RPC calls per cron invocation.
      for (let page = 0; page < 12; page++) {
        const rows = await source.history({ visibility: 'public', after: cursor, limit: pageSize });
        if (!Array.isArray(rows) || rows.length > pageSize) throw new Error('workflow_source_page_invalid');
        this.outbox.transaction(() => {
          for (const event of rows) {
            if (!Number.isSafeInteger(event.sequence) || event.sequence <= cursor || event.visibility !== 'public') throw new Error('workflow_source_page_invalid');
            this.accept(event);
            cursor = event.sequence;
          }
          if (rows.length) this.sql.exec('INSERT INTO workflow_log_cursor (id, sequence) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence', cursor);
        });
        if (rows.length < pageSize) break;
      }
    } finally {
      this.polling = false;
    }
  }
}
