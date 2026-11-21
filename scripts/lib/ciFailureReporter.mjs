/** D5502 (#5502): bounded structured node:test evidence beside TAP; no assertion values or stack traces. */
import { relative, isAbsolute } from 'node:path';
import { safeFile } from './ciFailures.mjs';
export default async function* report(source) {
  const files = new Set(); let count = 0; let truncated = false;
  for await (const { type, data } of source) {
    if (type === 'test:summary' && (data.counts?.cancelled || data.cancelled)) truncated = true;
    if (!['test:pass', 'test:fail'].includes(type)) continue;
    const file = data.file && (isAbsolute(data.file) ? relative(process.cwd(), data.file) : data.file);
    if (!safeFile(file)) continue;
    if (files.size < 20000) files.add(file); else truncated = true;
    // Older Node reporters cannot prove ancestry for nested equal titles. Keep those diagnoses unknown.
    if (data.nesting > 0 || String(data.name).length > 240) truncated = true;
    if (type === 'test:fail' && data.details?.type !== 'suite') {
      if (++count <= 200) yield `${JSON.stringify({ file, test: String(data.name).slice(0, 240), errorCode: data.details?.error?.cause?.code || data.details?.error?.code })}\n`;
      else truncated = true;
    }
  }
  yield `${JSON.stringify({ end: true, files: [...files], complete: !truncated })}\n`;
}
