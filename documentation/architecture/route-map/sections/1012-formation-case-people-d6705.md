### Formation case people (D6705)

The HQ founder API reads people, requirements and capital at `GET /api/formation/case-people/:uid/people`. POST actions at the same case prefix add, edit or remove a person, set capital, and grant or withdraw partner consent. The case creator owns this API. HQ screening decisions use `POST /api/admin/formation/cases/:uid/screenings/:id/clear` or `/decline` with a private reason.
