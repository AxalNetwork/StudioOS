/** Synthetic fully owned participant and offline, nonmatching lists for v2 stage fixtures. */
export function formationScreeningFixture(db, caseId) {
  db.prepare(
    "INSERT INTO formation_case_people(case_id,name,ownership_bps,is_entity) VALUES(?,'Fixture case owner',10000,0)",
  ).run(caseId);
  return {
    get: async (key) => [
      {
        source: key.split(':').at(-1),
        name: 'unrelated listed entity',
        aliases: [],
        ref: 'test-list',
        dob: null,
        nationality: null,
      },
    ],
  };
}
