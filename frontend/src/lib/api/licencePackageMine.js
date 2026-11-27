// D5026 part 2 (#5026, board L35) — the Axal VC package the caller's licence holds, read only, for the studio's
// own Licence page. Worker: routes/licence_package_mine.ts.
//   GET /api/licence/mine/package → { source, recorded, current, next, standalone, reason }
// `current` and `next` carry the package, version, dates, state, programs and accepted annual price; never the
// recommendation, override or country model, which stay HQ's. `current: null` is no package, not no programs:
// `standalone` lists the programs granted on their own. `recorded: false` (or a branch copy) is Not recorded.
import { request } from '../api.js';

export const licencePackageMineApi = {
  mine: () => request('/licence/mine/package'),
};
