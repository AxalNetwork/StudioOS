# Venture scoring

`pmf.ts` is D1143's pure Product-market fit model and engine. `pmfCollector.ts`
reads the venture's Validate stores after its latest Pivot, without selecting
interviewee names, quotes or customer identities. The PMF definition lives here
once; SCORING reuses it as a scope.

`pmfStore.ts` (D1144, migration 598) stores signed PMF changes in the shared
`scoring_model_versions` and `venture_scorecards` tables. Its conditional batch
writes the snapshot, readiness checklist item and metadata-only audit together.
Unchanged inputs write no history point; a freshness boundary is an effective
input change. D1145 (#3031): a store read that fails marks only the inputs it
feeds `unreadable`. They are out of the value and lower confidence, get no next
step, and a partial result is returned but never stored. Below the floor such a
read is Unreadable, never "Not enough recorded". Model versions are immutable. Callers must gate the venture
before calling the collector, recompute or history functions.

Future scoring scopes reuse migration 598's store and distinguish their model
versions by `(scope, version)`. Never replace a historical result with a new
model's interpretation. Never accept browser-supplied scores or raw inputs.
