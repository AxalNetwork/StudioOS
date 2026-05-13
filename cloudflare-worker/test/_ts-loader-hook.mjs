import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      const parentURL = context.parentURL ? new URL(specifier, context.parentURL) : null;
      if (parentURL) {
        const p = fileURLToPath(parentURL);
        // Already has an extension we recognise? defer.
        if (!/\.(ts|js|mjs|cjs|json)$/.test(p)) {
          if (existsSync(p + '.ts')) {
            return nextResolve(specifier + '.ts', context);
          }
          if (existsSync(p) && statSync(p).isDirectory() && existsSync(p + '/index.ts')) {
            return nextResolve(specifier + '/index.ts', context);
          }
        }
      }
    } catch { /* fall through */ }
  }
  return nextResolve(specifier, context);
}
