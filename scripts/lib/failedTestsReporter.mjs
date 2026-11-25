/**
 * D6464: a node:test reporter writing one JSON line per failed test, read by
 * the suite runner.
 *
 * D6464 (#6464): a node:test reporter that writes one JSON line per failed
 * test, `{ "file": "<repo path>", "test": "<name>" }`, to its destination.
 * The suite runner adds it beside TAP under merge_group only, then reads the
 * file to decide on a retry (`lib/flakyTests.mjs` `retryDecision`). A failed
 * suite (describe) is not written: its failed tests are. A file that fails
 * outside any test is written with the file as its name.
 */
import { relative, isAbsolute } from 'node:path';

const repoPath = (file) => (file && isAbsolute(file) ? relative(process.cwd(), file) : file || null);

export default async function* failedTestsReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { data } = event;
    if (data.details?.type === 'suite') continue;
    const file = repoPath(data.file);
    if (!file) continue;
    const name = data.nesting === 0 && repoPath(data.name) === file ? file : data.name;
    yield `${JSON.stringify({ file, test: name })}\n`;
  }
}
