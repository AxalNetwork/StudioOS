/**
 * D886 B2 (#2580): the numbers the core runs on. The owner's answers on #2577
 * fix the name and the plan limits; D872 fixes the audio format.
 */

import { MEETING_BOT_NAME } from '../notice.mjs';

/** The owner's choice (#2577, 2026-10-22), from B9's notice contract so the name lives in one place. */
export const BOT_NAME: string = MEETING_BOT_NAME;

/** D872's chunk format: 16 kHz, mono, 16-bit PCM behind a canonical 44-byte header. */
export const SAMPLE_RATE = 16000;
export const WAV_HEADER_BYTES = 44;

/** About 30 seconds a chunk: 480,000 samples, 960,044 bytes, well under D872's 5 MB part limit. */
export const CHUNK_SECONDS = 30;
export const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;

/** The bot leaves after this long as the only one in the call. */
export const ALONE_MS = 2 * 60 * 1000;

/** The plan limits (#2577). The Worker sends the founder's; the core refuses anything above the paid one. */
export const FREE_LIMIT_MS = 30 * 60 * 1000;
export const PAID_LIMIT_MS = 2 * 60 * 60 * 1000;

/** How long the core waits in the lobby or waiting room before giving up with `not_admitted`. */
export const ADMIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Events go to the callback in batches: every 5 seconds, or sooner at 50. At most 5,000 wait. */
export const EVENT_FLUSH_MS = 5000;
export const EVENT_BATCH_MAX = 50;
export const EVENT_QUEUE_MAX = 5000;

/** Retry backoff for a chunk or a batch: 1 s doubling to 30 s, 8 tries per pass. */
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30000;
export const RETRY_TRIES = 8;

/** How many times the notice is tried before the bot gives up and leaves. */
export const NOTICE_TRIES = 3;
