/**
 * Detect a failed dynamic import / lazy route chunk.
 *
 * Stale hashed chunks after a deploy are the usual cause. The recovery path
 * (main.jsx + RouteErrorBoundary) hard-reloads once onto the current shell.
 * The phrases differ by browser — and Safari, after React.lazy settles a
 * broken payload, surfaces a TypeError about `_result.default` instead of
 * any "failed to fetch" wording. That message used to fall through as a
 * generic render error ("Try again"), so the red card appeared across the
 * platform whenever a tab held a shell from before a deploy.
 *
 * Keep this list in ONE place. main.jsx and RouteErrorBoundary used to each
 * maintain a slightly different regex; Safari's shape lived in neither.
 */

// Chunk/dynamic-import failure phrases across major browsers + bundlers:
//   Chrome:  "Failed to fetch dynamically imported module"
//            "error loading dynamically imported module"
//            "Cannot read properties of undefined (reading 'default')"
//              — React.lazy when the import settled without a module object
//   WebKit/Safari: "Importing a module script failed."
//                  "module script failed to load"
//                  "undefined is not an object (evaluating 'e._result.default')"
//                    — React.lazy payload whose `_result` never resolved
//   Firefox: "error loading dynamically imported module"
//   Webpack: "ChunkLoadError" / "Loading chunk NNN failed"
//   Vite:    "Failed to load module script"
const CHUNK_LOAD_RE = /chunk|loading chunk|chunkloaderror|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|module script failed to load|failed to load module script|_result\.default|cannot read propert(?:y|ies) of undefined \(reading ['"]default['"]\)/i;

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (error && typeof error === 'object' && /** @type {{name?: string}} */ (error).name === 'ChunkLoadError') {
    return true;
  }
  const msg = String(
    (typeof error === 'object' && /** @type {{message?: unknown}} */ (error).message) || error,
  );
  return CHUNK_LOAD_RE.test(msg);
}
