/**
 * D4555 (#4555): the Cloudflare Agent Skills SDK adapter behind the
 * `SkillRuntime` seam (`skillRunManifest.ts`). The only file that imports
 * `agents/skills`, and only `manifest`, `loadSkillCatalog` and types
 * (`agent_runtime_contract.test.ts` and `skills_sdk_adapter_4555.test.ts`
 * hold it to that). Nothing from `agents/skills/tools/ai-sdk` (it needs the
 * `ai` package, which is not installed, and its tools would answer the model
 * directly) or `agents/skills/runner` (no script runs in v1).
 *
 * The SDK sees only the run-scoped manifest: two `manifest()` sources built
 * from skills that already passed D1 (`axal-hq`, then `axal-company`), never a
 * bucket or a workspace. The SDK keeps the first source to list a name, which
 * is the manifest's own rule, so the two agree. The catalogue it loads is
 * checked against the manifest (`catalogMatches`): any skill it adds, drops,
 * reorders, warns about or found invalid, a failed source or a missing method
 * makes the adapter unusable, and the selection (`skillRuntime.ts`) falls
 * back to the legacy loader. A call that throws inside the SDK, or answers in
 * a shape this version does not, is answered by the legacy loader. Every
 * activation and resource read re-checks D1 first, in `skillRunManifest.ts`.
 */
import { loadSkillCatalog, manifest, type LoadSkillCatalogOptions, type SkillCatalog, type SkillManifest, type SkillManifestEntry, type SkillSource } from 'agents/skills';
import {
  NO_SKILL, frameActivation, frameCatalogue, guardedRead, guardedSkill,
  type AuthorizedSkill, type RunSkillManifest, type SkillRuntime,
} from './skillRunManifest';

/** The version `cloudflare-worker/package.json` pins exactly. An upgrade is its own reviewed change. */
export const SDK_PINNED_VERSION = '0.32.0';
export const SDK_SOURCE_HQ = 'axal-hq';
export const SDK_SOURCE_COMPANY = 'axal-company';

/** The slice of the SDK this adapter uses. The annotation makes `tsc` fail if 0.32.0's signatures change. */
export type SkillsSdk = {
  version: string;
  manifest: (definition: SkillManifest) => SkillSource;
  loadSkillCatalog: (sources: readonly SkillSource[], options?: LoadSkillCatalogOptions) => Promise<SkillCatalog>;
};
export const CLOUDFLARE_SKILLS_SDK: SkillsSdk = Object.freeze({ version: SDK_PINNED_VERSION, manifest, loadSkillCatalog });

/** Why the SDK may not be used, or null. */
export function sdkUnusable(sdk: unknown): 'sdk_version_unsupported' | 'sdk_surface_changed' | null {
  if (!sdk || typeof sdk !== 'object') return 'sdk_surface_changed';
  const s = sdk as Partial<SkillsSdk>;
  if (s.version !== SDK_PINNED_VERSION) return 'sdk_version_unsupported';
  if (typeof s.manifest !== 'function' || typeof s.loadSkillCatalog !== 'function') return 'sdk_surface_changed';
  return null;
}

const sourceOf = (s: AuthorizedSkill) => (s.scope === 'hq' ? SDK_SOURCE_HQ : SDK_SOURCE_COMPANY);

/** A manifest skill as an SDK entry. No metadata, no `allowedTools`: the SDK pre-approves nothing. */
function entryOf(s: AuthorizedSkill): SkillManifestEntry {
  return { name: s.name, description: s.description, body: s.body, resources: s.resources.map((r) => ({ path: r.path, content: r.content, encoding: 'text' as const })) };
}

/** Whether the SDK's catalogue is exactly the manifest's visible skills, from the expected sources. */
export function catalogMatches(catalog: unknown, m: RunSkillManifest): boolean {
  const c = catalog as SkillCatalog | null;
  if (!c || typeof c !== 'object' || !Array.isArray(c.skills) || !Array.isArray(c.diagnostics)) return false;
  if (typeof c.activate !== 'function' || typeof c.readResource !== 'function' || typeof c.prompt !== 'function') return false;
  if (c.skills.length !== m.visible.length) return false;
  for (let i = 0; i < m.visible.length; i++) {
    const e = c.skills[i];
    if (!e?.skill || e.skill.name !== m.visible[i].name || e.sourceId !== sourceOf(m.visible[i])) return false;
  }
  for (const d of c.diagnostics) {
    if (d?._tag !== 'DuplicateSkill') return false;
    const kept = m.visible.find((s) => s.name === d.name);
    if (!kept || d.keptSourceId !== sourceOf(kept)) return false;
  }
  return true;
}

export type SdkBuild = { ok: true; runtime: SkillRuntime; diagnostics: SkillCatalog['diagnostics'] } | { ok: false; reason: 'sdk_error' | 'sdk_catalog_mismatch' };

/** The SDK runtime over `m`, or why not. `legacy` answers any call the SDK fails on. */
export async function sdkRuntime(m: RunSkillManifest, sdk: SkillsSdk, legacy: SkillRuntime): Promise<SdkBuild> {
  let catalog: SkillCatalog;
  try {
    const hq = sdk.manifest({ id: SDK_SOURCE_HQ, skills: m.ordered.filter((s) => s.scope === 'hq').map(entryOf) });
    const company = sdk.manifest({ id: SDK_SOURCE_COMPANY, skills: m.ordered.filter((s) => s.scope === 'company').map(entryOf) });
    catalog = await sdk.loadSkillCatalog([hq, company]);
  } catch { return { ok: false, reason: 'sdk_error' }; }
  if (!catalogMatches(catalog, m)) return { ok: false, reason: 'sdk_catalog_mismatch' };
  let listing: string | null;
  try { listing = catalog.prompt(); } catch { return { ok: false, reason: 'sdk_error' }; }
  const runtime: SkillRuntime = {
    kind: 'cloudflare_sdk',
    catalogue: () => m.visible.map((s) => ({ name: s.name, description: s.description })),
    cataloguePrompt: () => frameCatalogue(typeof listing === 'string' ? listing : null),
    async activate(name) {
      const s = await guardedSkill(m, name);
      if (!s) return NO_SKILL;
      let text: string | null = null;
      try {
        const r = catalog.activate(s.name);
        text = r && r.ok === true && typeof r.value === 'string' ? r.value : null;
      } catch { text = null; }
      if (text == null) return legacy.activate(name);
      return { ok: true, name: s.name, version: s.version, tools: s.tools, text: frameActivation(s, text) };
    },
    readResource: (id) => guardedRead(m, id, async (s, r) => {
      try {
        const got = await catalog.readResource({ name: s.name, path: r.path });
        if (got && got.ok === true) return typeof got.value?.resource?.content === 'string' ? got.value.resource.content : null;
        return null;
      } catch {
        // The legacy loader's answer: the same authorized, pinned file from the manifest.
        return r.content;
      }
    }),
    readsFor: (name) => m.visible.find((s) => s.name === name)?.tools ?? [],
  };
  return { ok: true, runtime, diagnostics: catalog.diagnostics };
}
