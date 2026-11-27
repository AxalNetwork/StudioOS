/** D5618: one durable coordinator per repository, insert-only audit and restart-safe event/lease state. D5990: the policy check run. D8834: owner sign-off. */
import { DurableObject } from 'cloudflare:workers';
import type { Delivery, Env, GithubApi, Run } from './types.ts';
import { changeLease, type LeaseInput, type LeaseState } from './lib/lease.ts';
import { cancellable, destroyedTarget, queueBranch, WORKFLOWS } from './lib/reconcile.ts';
import { githubClient, POLICY_PERMISSIONS } from './github.ts';
import { checkRunBody, decide, evaluate, policyTarget } from './policyCheck.ts';
import type { Decision, PolicyTarget } from './policyCheck.ts';
import { POLICY_VERSION } from './policy.ts';
import { currentSignoff, mergeGroupSignoff, prHeadKey, signedOffCheckRunBody, signoffKey } from './signoff.ts';
import type { RecordedHead, Signoff, SignoffInput, SignoffOutcome } from './signoff.ts';

/**
 * D5990: one decision per head and policy_version; `posted` turns true once its check run is created.
 * D8834: `signedOff` turns true once the sign-off's success has been posted on a pull request head.
 */
interface StoredDecision { decision: Decision; posted: boolean; signedOff?: boolean }

export class RepoControl extends DurableObject<Env> {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, delivery TEXT, detail TEXT NOT NULL)');
    ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS audit_event_delivery ON audit(delivery) WHERE kind = 'event'");
    // D5990: the audit is append-only in the store itself, not only by convention.
    ctx.storage.sql.exec("CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END");
    ctx.storage.sql.exec("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END");
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
  private async client(injected?: GithubApi, permissions?: Readonly<Record<string, string>>): Promise<GithubApi> {
    const api = injected ?? await githubClient(this.env, async (input, init) => {
      if (await this.off()) throw new Error('kill switch enabled');
      return fetch(input, init);
    }, permissions);
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
      const target = policyTarget(event);
      // D8834: the head a later merge group of this pull request is bound to; the newest by ingress time wins.
      if (target?.kind === 'pull_request' && target.pr !== null) {
        const seen = await this.ctx.storage.get<RecordedHead>(prHeadKey(target.pr));
        if (!seen || event.at >= seen.at) await this.ctx.storage.put(prHeadKey(target.pr), { sha: target.head, at: event.at });
      }
      if (target && !await this.off()) await this.policy(target, event.delivery, injectedApi);
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
  /**
   * D5990: decide once per head and policy_version, audit that decision once,
   * then create the check run. A retry or a redelivery posts the stored
   * decision, never a new one, so one SHA never gets two conclusions under
   * one policy. A client or posting error throws before anything is marked
   * posted, and the Queue retries it; evaluate itself never yields success
   * on an error or a timeout.
   *
   * D8834: a pull request head with a current sign-off posts the sign-off's
   * success instead, once. A T2 merge-group head is decided with the sign-off
   * evidence for its enqueued pull request head.
   */
  private async policy(target: PolicyTarget, delivery: string | null, injectedApi?: GithubApi) {
    const key = `policy:${target.head}:${POLICY_VERSION}`;
    let stored = await this.ctx.storage.get<StoredDecision>(key);
    const signed = target.kind === 'pull_request' && target.pr !== null
      ? currentSignoff(await this.ctx.storage.get<Signoff>(signoffKey(target.pr, target.head))) : null;
    if (stored?.posted && (!signed || stored.signedOff)) return;
    const api = await this.client(injectedApi, POLICY_PERMISSIONS);
    if (!stored) {
      const result = await evaluate({ base: target.base, head: target.head }, { api });
      const evidence = target.kind === 'merge_group' && result.tier === 'T2'
        ? await mergeGroupSignoff(api, target, (k) => this.ctx.storage.get(k)) : null;
      const decision = decide(result, target, evidence);
      stored = { decision, posted: false };
      await this.ctx.storage.put(key, stored);
      this.audit('policy', delivery, { sha: decision.head, base: decision.base, event: decision.kind, pr: target.pr,
        tier: decision.tier, conclusion: decision.conclusion, policy_version: decision.policy_version, at: Date.now() });
    }
    if (await this.off()) return;
    await api('POST', 'check-runs', signed ? signedOffCheckRunBody(stored.decision, signed, this.env.REPOSITORY) : checkRunBody(stored.decision, this.env.REPOSITORY));
    await this.ctx.storage.put(key, { ...stored, posted: true, signedOff: signed !== null });
  }
  /**
   * D8834: the owner signs off one pull request head. It must be the head
   * Merge Control last recorded for that pull request, with a decision under
   * this policy_version. Stores `{pr, head_sha, actor, policy_version, at}`
   * once, writes one `signoff` audit row, and re-posts the check on that SHA
   * as success. Refused, storing nothing, while the kill switch is on.
   */
  async signoff(input: SignoffInput, injectedApi?: GithubApi): Promise<SignoffOutcome> {
    return this.ordered(async (): Promise<SignoffOutcome> => {
      if (await this.off()) return { status: 409, error: 'kill_switch_on' };
      const seen = await this.ctx.storage.get<RecordedHead>(prHeadKey(input.pr));
      if (seen?.sha !== input.head_sha) return { status: 409, error: 'not_current_head' };
      const stored = await this.ctx.storage.get<StoredDecision>(`policy:${input.head_sha}:${POLICY_VERSION}`);
      if (!stored || stored.decision.kind !== 'pull_request') return { status: 409, error: 'no_decision' };
      const key = signoffKey(input.pr, input.head_sha);
      let record = currentSignoff(await this.ctx.storage.get<Signoff>(key));
      if (!record) {
        record = Object.freeze({ pr: input.pr, head_sha: input.head_sha, actor: input.actor, policy_version: POLICY_VERSION, at: Date.now() });
        await this.ctx.storage.put(key, record);
        this.audit('signoff', null, record);
      }
      await this.policy({ kind: 'pull_request', head: input.head_sha, base: stored.decision.base, pr: input.pr }, null, injectedApi);
      const after = await this.ctx.storage.get<StoredDecision>(`policy:${input.head_sha}:${POLICY_VERSION}`);
      return { status: 200, signoff: record, posted: after?.signedOff === true };
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
