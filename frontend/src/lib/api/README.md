# frontend/src/lib/api — one file per new API domain

`../api.js` is the SPA's client for the Worker. It is also the file most likely
to conflict: on `main` from 2 August to 3 October 2026 it changed in 113 of
624 commits, because every new client method landed at the bottom of it. From
D527 on, a **new** API domain gets its own module here instead.

Existing methods stay in `api.js`. 147 tests and scripts read that file by
path, so moving code out of it is a separate decision, not a side effect of
adding a domain.

## Adding a domain

1. Create `<domain>.js` here, camelCase (`ventureReviews.js`). Export the
   client object the way `api.js` does today, and call the Worker through
   `request` from `api.js`:

   ```js
   import { request } from '../api.js';

   export const ventureReviewsApi = {
     list: () => request('/venture-reviews'),
     create: (body) => request('/venture-reviews', { method: 'POST', body: JSON.stringify(body) }),
   };
   ```

   Call `request` only inside method bodies, never at the top level of the
   module: `api.js` re-exports this file, so the two import each other, and a
   top-level call would run before `request` is defined.

2. Add ONE line to the re-export block near the top of `api.js`, between
   `// api-modules:begin` and `// api-modules:end`, in alphabetical order:

   ```js
   export * from './api/ventureReviews.js';
   ```

   The block sits under the imports, away from the end of the file where other
   pull requests append, so two new domains touch two different lines.

3. Pick export names that `api.js` does not already use. With `export *`, a
   name `api.js` declares itself wins and the module's export is silently
   hidden.

## What checks it

`scripts/check-api-drift.mjs` (run by `npm run test:drift`) reads `api.js` and
every `.js` file here. A `request()` in a module must match a mounted Worker
route exactly as one in `api.js` must, and the check fails if the re-export
block does not name exactly the files in this folder, one well-formed line
each, in alphabetical order. The rules themselves live in
`scripts/lib/apiModules.mjs` and are tested by
`scripts/lib/apiModules.test.mjs`. The Worker's own drift tests
(`cloudflare-worker/test/api_drift.test.*`) read this folder too.
