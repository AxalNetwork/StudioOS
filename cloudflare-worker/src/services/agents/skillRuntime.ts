/**
 * D4555 (#4555): which skill runtime a run uses. The legacy (current Axal)
 * loader unless the caller asks for `cloudflare_sdk`, and then only when the
 * SDK is the pinned version with the expected surface and its catalogue matches
 * the D1 manifest; otherwise the legacy loader, with the reason. No binding,
 * flag or `AGENT_ENGINE` value selects it: nothing in production does yet.
 *
 *   const m = await buildRunManifest(env, agent.id);
 *   const { runtime, fallback } = await skillRuntimeFor(m, { engine: 'cloudflare_sdk' });
 *   runtime.cataloguePrompt(); await callSkillTool(runtime, 'activate_skill', { name });
 *
 * Neither runtime calls a model: a run that loads skills still calls
 * aiRouter's `run()` through `agentRun.ts`, with its safety, holds and usage
 * ledger.
 */
import { legacyRuntime, type RunSkillManifest, type SkillRuntime } from './skillRunManifest';
import { CLOUDFLARE_SKILLS_SDK, sdkRuntime, sdkUnusable, type SkillsSdk } from './skillsSdk';

export type SkillEngine = 'cloudflare_sdk' | 'legacy';
export type SkillFallback = 'sdk_version_unsupported' | 'sdk_surface_changed' | 'sdk_error' | 'sdk_catalog_mismatch';
export type SkillRuntimeChoice = { runtime: SkillRuntime; fallback: SkillFallback | null };

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
