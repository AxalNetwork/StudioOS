// D984 (#2775, part 3 of #2376) — the programs HQ grants the caller's
// licence, read only (GR7). One path on either tier: on HQ the Worker reads
// part 1's store through `licence_admins`; on a branch it reads the dated copy
// HQ pushes (`as_of`, `age_seconds`). An account no licence binds gets
// `linked: false`: on HQ-held accounts, HQ runs every program.
// Worker: routes/licence_programs.ts over services/licencePrograms.ts.
//   GET /api/licence/mine/programs → { linked, source, as_of, age_seconds, licence, programs, reason }
// `programs` is null with a `reason` when a branch holds no copy yet, never [].
import { request } from '../api.js';

export const licenceProgramsApi = {
  mine: () => request('/licence/mine/programs'),
};
