/** D886 B2 (#2580): the meeting bot's host-independent core. See `../README.md`. */
export * from './types.ts';
export * from './constants.ts';
export { encodeWav, toPcm16k, Chunker } from './wav.ts';
export type { Chunk } from './wav.ts';
export { ChunkUploader, withRetry, backoffMs } from './uploader.ts';
export { EventBatcher } from './events.ts';
export { httpTransport, signRequest, TransportError, CALLBACK_PATHS } from './callback.ts';
export { runBot, checkConfig, realClock } from './lifecycle.ts';
export type { RunDeps, RunResult } from './lifecycle.ts';
export { safeFields, logLine, consoleSink } from './log.ts';
export { FakeAdapter } from './fakeAdapter.ts';
