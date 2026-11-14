# Merge Control contracts

Pure contracts shared by the Merge Control Worker and the studioos Worker.
A file here imports nothing, so either side can read it without pulling in the
other's runtime. Checks against D1 (is this person on the team, is this
repository record the team's) belong to the caller.

| File | Purpose |
| --- | --- |
| `landingPolicy.ts` | A team's Landing settings: types, defaults, HQ caps and `validateLandingPolicy` (D5624). |
