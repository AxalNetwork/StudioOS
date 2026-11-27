## Programs bounded reads (D4810, #4810)

The Worker side is `routes/learning_programs.ts` and `routes/influencer_offers.ts`, and `services/learningPrograms.ts` and `services/influencerOffers.ts`. The screens are Programs › Learning (Overview, People) and Influencer › Offers, plus the program frame.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/learning/programs/mine/completion` | an admin (assigned programs) or the Super Admin | Each published program in scope (first 50 by name): `{ uid, learners, finished }`. Also `unreadable`, `capped` and `max`. 403 `admins_only` for anyone else. |
| `GET /api/learning/programs/:uid/learners?limit=&offset=` (changed) | the program's assigned admin or the Super Admin | With `limit` (1–200), a page of learners and `total`. With none, every learner, as before. 400 `bad_page`. |
| `GET /api/admin/influencer-offers?limit=&offset=` | the Super Admin | Every influencer's offers, newest first, a page (default 50, at most 100) with `total`, each `{ influencer: { user_uid, handle, name }, offer }`. 400 `bad_page`. |
