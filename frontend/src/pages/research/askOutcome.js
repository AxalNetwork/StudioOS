/**
 * D4605 — what an Ask outcome and a document's index state mean on screen, in
 * one place for the three surfaces that show them (Ask, the founder's
 * Research desk, the investor's Research workspace).
 *
 * `retrieval_unavailable` is the library not being searchable just now (the
 * index, the embedding or the query failed). It is never shown as "nothing in
 * your library answers this": that would send the reader to upload a document
 * that would not have helped. It is charged nothing and can be asked again.
 *
 * `partial` is a document some of whose passages were indexed: Ask answers
 * from those, and the note says how many.
 */
export const RETRIEVAL_UNAVAILABLE =
  'Your library could not be searched just now, so nothing was retrieved and no answer was written. This is not a gap in your documents. Nothing was charged; ask again in a moment.';

/** The index states Ask can answer from. */
export const ANSWERABLE_STATES = ['indexed', 'partial'];
export const isAnswerable = (state) => ANSWERABLE_STATES.includes(state);
