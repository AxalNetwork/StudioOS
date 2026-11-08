/**
 * D4555 (#4555): which skill runtime a run uses. The legacy (current Axal)
 * loader unless the caller asks for `cloudflare_sdk`, and then only when the
 * SDK is the pinned version with the expected surface and its catalogue matches
 * the D1 manifest; otherwise the legacy loader, with the reason.
 *
 *   const m = await buildRunManifest(env, agent.id);
 *   const { runtime, fallback } = await skillRuntimeFor(m, { engine: 'cloudflare_sdk' });
 *   runtime.cataloguePrompt(); await callSkillTool(runtime, 'activate_skill', { name });
 *
 * THE SWITCH (`skillEngineOf`, the D4555 addendum). `agentRun` asks for the
 * SDK only when the Worker is the preview Worker (`ENVIRONMENT` is exactly
 * `preview`, and `STUDIOOS_ENV` does not say production) AND
 * `AGENT_SKILL_RUNTIME` is exactly `cloudflare_sdk`. Production's two var
 * blocks set `ENVIRONMENT = "production"`, so no value of the variable can
 * select the adapter there; no D1 row, member setting, `AGENT_ENGINE` or
 * `AGENT_AUTONOMY` value is read. `wrangler.toml` declares the variable
 * nowhere: even preview runs the legacy loader until someone sets it there.
 *
 * ON THE RUN PATH (`skillTextForRun`). `agentRun` has already passed
 * `skillForRun()` for the named skill. Switch off: today's text,
 * `skillPrompt()` of the pinned version, and no other read. Switch on: the
 * run-scoped manifest; the catalogue (authorized, exact-pin skills only), the
 * named skill activated and each of its files read through the chosen runtime,
 * every one re-checking D1. The run is one model call with no tool loop, so
 * the catalogue, the activation and the files go into that call's system
 * prompt together. A D1 re-check that now refuses fails the run closed (no
 * model call); an SDK that cannot be used, or a skill the stricter manifest
 * leaves out, uses today's text unchanged. Nothing here calls a model: the run
 * still calls aiRouter's `run()` once, through `agentRun.ts`, with its safety,
 * holds and usage ledger.
 */
import type { Env } from '../../types';
import { legacyRuntime, buildRunManifest, type ResourceProvider, type RunSkillManifest, type SkillRuntime } from './skillRunManifest';
import { CLOUDFLARE_SKILLS_SDK, sdkRuntime, sdkUnusable, type SkillsSdk } from './skillsSdk';
import { skillPrompt } from './skillEval';
import type { SkillRow, VersionRow } from './skillLinks';

export type SkillEngine = 'cloudflare_sdk' | 'legacy';
export type SkillFallback = 'sdk_version_unsupported' | 'sdk_surface_changed' | 'sdk_error' | 'sdk_catalog_mismatch';
export type SkillRuntimeChoice = { runtime: SkillRuntime; fallback: SkillFallback | null };

/** The variable that selects the SDK adapter, read only on the preview Worker. */
export const SKILL_RUNTIME_VAR = 'AGENT_SKILL_RUNTIME';
export const SKILL_RUNTIME_SDK_VALUE = 'cloudflare_sdk';

/** The engine a run asks for: `cloudflare_sdk` only on the preview Worker with the variable set exactly; anything else `legacy`. */
export function skillEngineOf(env: Pick<Env, 'ENVIRONMENT' | 'STUDIOOS_ENV' | 'AGENT_SKILL_RUNTIME'>): SkillEngine {
  if (env.ENVIRONMENT !== 'preview') return 'legacy';
  const studio = String(env.STUDIOOS_ENV ?? '').trim().toLowerCase();
  if (studio === 'production' || studio === 'prod') return 'legacy';
  return env.AGENT_SKILL_RUNTIME === SKILL_RUNTIME_SDK_VALUE ? 'cloudflare_sdk' : 'legacy';
}

export async function skillRuntimeFor(m: RunSkillManifest, opts: { engine?: SkillEngine; sdk?: unknown } = {}): Promise<SkillRuntimeChoice> {
  const legacy = legacyRuntime(m);
  if (opts.engine !== 'cloudflare_sdk') return { runtime: legacy, fallback: null };
  const sdk = opts.sdk === undefined ? CLOUDFLARE_SKILLS_SDK : opts.sdk;
  const unusable = sdkUnusable(sdk);
  if (unusable) return { runtime: legacy, fallback: unusable };
  let built: Awaited<ReturnType<typeof sdkRuntime>>;
  try { built = await sdkRuntime(m, sdk as SkillsSdk, legacy); } catch { return { runtime: legacy, fallback: 'sdk_error' }; }
  return built.ok ? { runtime: built.runtime, fallback: null } : { runtime: legacy, fallback: built.reason };
}

/** The most file text one run's prompt takes; files past it are left out (each is still re-checked when read). */
export const RUN_FILES_MAX_CHARS = 16 * 1024;

/** Why a switched-on run used today's text: the SDK's reason, or the named skill is not in the stricter manifest. */
export type RunSkillFallback = SkillFallback | 'skill_not_in_manifest';
export type RunSkillText =
  | { ok: true; text: string; runtime: SkillEngine; fallback: RunSkillFallback | null }
  | { ok: false; code: 'skill_unavailable' };
/** Tests only: the SDK and the resource provider the switched-on path uses. */
export type RunSkillDeps = { sdk?: unknown; resources?: ResourceProvider };

/**
 * The named skill's part of the run's system prompt; see the header. `skill`
 * is `skillForRun()`'s answer for this run. Never throws: an unexpected error
 * on the switched-on path is the SDK's (`sdk_error`) and uses today's text.
 */
export async function skillTextForRun(
  env: Env, agentId: number, skill: { skill: SkillRow; version: VersionRow }, engine: SkillEngine, deps: RunSkillDeps = {},
): Promise<RunSkillText> {
  const today = (fallback: RunSkillFallback | null): RunSkillText => ({ ok: true, text: skillPrompt(skill.version), runtime: 'legacy', fallback });
  if (engine !== 'cloudflare_sdk') return today(null);
  try {
    const m = await buildRunManifest(env, agentId, deps.resources ? { resources: deps.resources } : {});
    const s = m.visible.find((x) => x.uid === skill.skill.uid && x.version === Number(skill.version.version));
    if (!s) return today('skill_not_in_manifest');
    const choice = await skillRuntimeFor(m, { engine, sdk: deps.sdk });
    if (choice.runtime.kind !== 'cloudflare_sdk') return today(choice.fallback ?? 'sdk_error');
    const rt = choice.runtime;
    const act = await rt.activate(s.name);
    // D1 refuses the skill now (grant, rule book, role, pin, agent state changed since the gate): no model call.
    if (!act.ok) return { ok: false, code: 'skill_unavailable' };
    const files: string[] = [];
    let used = 0;
    for (const r of s.resources) {
      const got = await rt.readResource(r.id);
      if (!got.ok) {
        // A refused read is either D1 refusing now (fail closed) or a file the store no longer has (left out).
        if (!(await m.recheck(s))) return { ok: false, code: 'skill_unavailable' };
        continue;
      }
      if (used + got.text.length > RUN_FILES_MAX_CHARS) continue;
      used += got.text.length;
      files.push(got.text);
    }
    return { ok: true, text: [rt.cataloguePrompt(), act.text, ...files].filter(Boolean).join('\n\n'), runtime: 'cloudflare_sdk', fallback: null };
  } catch {
    return today('sdk_error');
  }
}
