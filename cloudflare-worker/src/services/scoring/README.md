# Venture scoring

`pmf.ts` is D1143's pure Product-market fit model and engine. `pmfCollector.ts`
reads the venture's Validate stores after its latest Pivot, without selecting
interviewee names, quotes or customer identities. The PMF definition lives here
once; SCORING reuses it as a scope.

`pmfStore.ts` (D1144, migration 598) stores signed PMF changes in the shared
`scoring_model_versions` and `venture_scorecards` tables. Its conditional batch
writes the snapshot, readiness checklist item and metadata-only audit together.
Unchanged inputs write no history point; a freshness boundary is an effective
input change. Model versions are immutable. Callers must gate the venture
before calling the collector, recompute or history functions.

Future scoring scopes reuse migration 598's store and distinguish their model
versions by `(scope, version)`. Never replace a historical result with a new
model's interpretation. Never accept browser-supplied scores or raw inputs.

`pmfExplain.ts` (D1147) projects only signed PMF input rows into Eadwyn's
explanation or lowest-confidence interview-question prompt, then validates the
citations and words. `../../routes/pmf_explain.ts` mounts previews and the explicit Keep;
`storedPmfInputs` reads without recomputing or writing a score.
