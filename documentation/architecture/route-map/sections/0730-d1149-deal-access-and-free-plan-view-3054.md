### D1149 — deal access and Free-plan view (#3054)

`GET /api/deals/:id` and DD case creation share the invited-or-committed investor
rule. An invited Free investor gets only the header/key strip and DL22b plan
card; all other deal and DD reads stay Professional. Legacy Join records an
invitation request and grants no access. Missing progress/age says Not recorded.
Deal amounts use migration 599's currency. A founder returns to Raise's Capital
relationships. The existing main page consumes the DL22b component independently
of D1148's pending integration.

