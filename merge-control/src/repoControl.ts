/** D5618: one durable coordinator per repository, insert-only audit and restart-safe event/lease state. */
import { DurableObject } from 'cloudflare:workers';
import type { Delivery, Env, GithubApi, Run } from './types.ts';
import { changeLease, type LeaseInput, type LeaseState } from './lib/lease.ts';
import { cancellable, destroyedTarget, queueBranch, WORKFLOWS } from './lib/reconcile.ts';
import { githubClient } from './github.ts';

export class RepoControl extends DurableObject<Env> {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, delivery TEXT, detail TEXT NOT NULL)');
    ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS audit_event_delivery ON audit(delivery) WHERE kind = 'event'");
  }
  private ordered<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.serial.then(fn); this.serial = result.catch(() => undefined); return result;
  }
  private audit(kind: string, delivery: string | null, detail: unknown) {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO audit (at, kind, delivery, detail) VALUES (?, ?, ?, ?)', Date.now(), kind, delivery, JSON.stringify(detail));
  }
  private async off() { return (await this.ctx.storage.get<boolean>('kill-switch')) ?? true; }
  async setKillSwitch(on: boolean) {
    await this.ctx.storage.put('kill-switch', on); this.audit('switch', null, { on }); return { on };
  }
  async status() {
    return { killSwitch: await this.off(), lastDelivery: await this.ctx.storage.get('last-delivery') ?? null,
      lastReconcile: await this.ctx.storage.get('last-reconcile') ?? null,
      counts: this.ctx.storage.sql.exec('SELECT kind, COUNT(*) AS count FROM audit GROUP BY kind').toArray() };
  }
  async claim(issue: number, input: LeaseInput) {
    if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error('invalid issue');
    return this.ordered(async () => {
      const key = `lease:${issue}`;
      const state = await this.ctx.storage.get<LeaseState>(key) ?? { counter: 0, lease: null };
      const result = changeLease(state, input, Date.now());
      await this.ctx.storage.put(key, result.state);
      this.audit('claim', null, { issue, operation: input.operation, status: result.status, fence: result.lease?.fence ?? null });
      return { status: result.status, lease: result.lease };
    });
  }
  private async client(injected?: GithubApi): Promise<GithubApi> {
    const api = injected ?? await githubClient(this.env, async (input, init) => {
      if (await this.off()) throw new Error('kill switch enabled');
      return fetch(input, init);
    });
    return async (method, path, body) => {
      if (await this.off()) throw new Error('kill switch enabled');
      return api(method, path, body);
    };
  }
  private async pages(api: GithubApi, path: string, key?: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = key ? (data as Record<string, unknown[]>)[key] : data;
      if (!Array.isArray(rows)) throw new Error('invalid GitHub page');
      result.push(...rows);
      if (rows.length < 100) return result;
    }
    throw new Error('GitHub pagination cap');
  }
  private async cancel(api: GithubApi, run: Run, sha: string, delivery: string | null) {
    if (!cancellable(run, sha) || await this.off() || await this.ctx.storage.get(`cancelled:${run.id}`)) return;
    this.audit('cancel-intent', delivery, { id: run.id, sha });
    await api('POST', `actions/runs/${run.id}/cancel`);
    await this.ctx.storage.put(`cancelled:${run.id}`, true);
    this.audit('cancelled', delivery, { id: run.id, sha });
  }
  async deliver(event: Delivery) { return this.process(event); }
  /** api injection is internal to tests, not used by public routes or Queue dispatch. */
  async process(event: Delivery, injectedApi?: GithubApi) {
    return this.ordered(async () => {
      if (event.repo !== this.env.REPOSITORY || !/^[a-zA-Z0-9-]{1,100}$/.test(event.delivery)) throw new Error('invalid delivery');
      const key = `delivery:${event.delivery}`;
      const previous = await this.ctx.storage.get<{ done: boolean }>(key);
      if (previous?.done) return;
      this.audit('event', event.delivery, event);
      if (!previous) await this.ctx.storage.put(key, { done: false, event });
      await this.ctx.storage.put('last-delivery', { id: event.delivery, at: event.at });
      const sha = destroyedTarget(event);
      if (sha && !await this.off()) {
        const api = await this.client(injectedApi);
        for (const workflow of WORKFLOWS) {
          const runs = await this.pages(api, `actions/workflows/${workflow}/runs?head_sha=${sha}&event=merge_group`, 'workflow_runs') as Run[];
          for (const run of runs) await this.cancel(api, run, sha, event.delivery);
        }
      }
      await this.ctx.storage.put(key, { done: true });
    });
  }
  async reconcile(injectedApi?: GithubApi) {
    return this.ordered(async () => {
      if (await this.off()) { this.audit('reconcile-disabled', null, {}); return; }
      const api = await this.client(injectedApi);
      const refs = await this.pages(api, 'git/matching-refs/heads/claim/') as { ref: string; object: { sha: string } }[];
      const mirrors: { issue: number; sha: string; message: string }[] = [];
      for (const ref of refs) {
        const match = /^refs\/heads\/claim\/([1-9]\d*)$/.exec(ref.ref);
        if (!match || !/^[a-f0-9]{40}$/.test(ref.object.sha)) continue;
        const commit = await api('GET', `git/commits/${ref.object.sha}`) as { message: string };
        mirrors.push({ issue: Number(match[1]), sha: ref.object.sha, message: String(commit.message).slice(0, 4096) });
      }
      await this.ctx.storage.put('claim-mirrors', mirrors);
      for (const status of ['queued','in_progress','waiting','pending','requested']) {
        const runs = await this.pages(api, `actions/runs?event=merge_group&status=${status}`, 'workflow_runs') as Run[];
        for (const run of runs) {
          if (!cancellable(run, run.head_sha) || !queueBranch(run.head_branch)) continue;
          try { await api('GET', `git/ref/heads/${encodeURIComponent(run.head_branch)}`); }
          catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
            await this.cancel(api, run, run.head_sha, null);
          }
        }
      }
      const at = Date.now(); await this.ctx.storage.put('last-reconcile', at); this.audit('reconciled', null, { at, claims: mirrors.length });
    });
  }
}
