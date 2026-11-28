/**
 * D886 B3 (#2581): the Meet tab's audio capture. Since D5812 (#5812) the
 * routines live in `../capture.ts`, shared with the Teams page driver; this
 * file keeps Meet's import path.
 */
export { CAPTURE_BINDING, CAPTURE_SCRIPT, decodeBlock } from '../capture.ts';
