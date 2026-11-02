/**
 * D1528 (#3847, E3 of #3742) — `AgentTaskWorkflow`: one instance per run, its
 * id the run uid. The steps, each named, are `load` → `context` → `run` →
 * `propose` → `wait` → `after`; their logic is `loop.ts`, plain functions the
 * tests drive with fakes, so this class is the binding and nothing else.
 *
 * Each `step.do` retries 3 times (30 s, then exponential) on a throw, which
 * only a transient error raises; a refusal is an answer and ends the run.
 * Instance state is kept 7 days on success and 30 on error
 * (`[workflows] default_retention`, owner Q6 A). No step returns a prompt or
 * an output, so that state never holds one.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { defaultLoopDeps, runTaskLoop, type StepLike } from './loop';

export type AgentTaskParams = { run_uid: string };

export class AgentTaskWorkflow extends WorkflowEntrypoint<Env, AgentTaskParams> {
  async run(event: Readonly<WorkflowEvent<AgentTaskParams>>, step: WorkflowStep) {
    return runTaskLoop(event.payload.run_uid, step as unknown as StepLike, defaultLoopDeps(this.env));
  }
}
