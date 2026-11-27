// D4659 (#4659) — the Spin-Out Lab venture this browser last read from
// `/api/spinout-lab/state`.
//
// The server records which of a founder's projects the Lab enrollment is about
// (`spinout_lab_enrollments.project_id`). Every Lab tool page picks its project
// with `pickLabProject`; reading the recorded venture here makes all of them
// pick the same company the server proves milestones on and issues the
// certificate for, instead of each guessing ("the oldest owned project").
// `spinoutLab.state()` sets it on every read; nothing else writes it.

let ventureId = null;

/** Called by `spinoutLab.state()` with the state it read. */
export function rememberLabVenture(state) {
  const v = state && state.venture;
  ventureId = v && v.status === 'bound' && v.project && Number.isFinite(Number(v.project.id)) ? Number(v.project.id) : null;
  return state;
}

/** The recorded venture's project id, or null when none is recorded (or not yet read). */
export function labVentureId() {
  return ventureId;
}
