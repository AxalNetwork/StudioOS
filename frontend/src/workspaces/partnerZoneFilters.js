import { makeZoneFilters } from './zoneFilterBuilder.js';

/**
 * The partner profile's filter tables — the left half of the zone header row.
 *
 * SEVEN PARTNER ZONES CARRY A `filters:` ARRAY ON A CANVAS, and all seven are
 * here. The four Research ones, and all three of Network's — including
 * `network/organizations`, which two earlier versions of this docblock said
 * would never be. See the note on that row for what changed and why the old
 * reasoning was right about the page it was written against.
 *
 * `/research/library` IS THE ONE ZONE WHERE THIS LICENCE GETS EVERYTHING THE
 * CANVAS DREW, out of the same component that gives founder one live chip out
 * of five. `research_documents.kind` is free text with no CHECK, so the column,
 * the write path and the client method all pass for every licence's labels —
 * and then the writer settles it: the upload form offers `Document`, `My
 * playbook` and `About a client`, the worker coerces anything else, and this
 * canvas asked for exactly that axis. Founder's `Reports` and `Legal` did not.
 *
 * WHERE THE LABELS WILL COME FROM. `design/incoming/Pages · Partner
 * {Network,Research}.dc.html`, verbatim and in the canvas's own order. Note
 * that the Research canvas names `/research/market` where the router and
 * `shellConfig.js` both say `markets`; the guard's `live()` hook does that
 * translation and already carries this exact mapping for the ops half.
 *
 * WHAT THIS DOCBLOCK USED TO SAY ABOUT `network/organizations`, AND WHY IT WAS
 * REVERSED RATHER THAN DELETED. It read: "`network/organizations` will never be
 * here. `NetworkPage` catches a slug it has no tab for and suppresses every
 * body, so that route already renders its own heading above a card stating the
 * gap — a filter row would be four controls above a sentence explaining that
 * there is nothing to filter."
 *
 * That was a correct reading of a page that was one sentence, and the reasoning
 * still holds: a chip row over nothing is four controls above a statement. What
 * changed is the page. Migration 224 gave the book a company name per contact
 * and 226 gave it a relationship, so the zone now groups real rows — and the
 * `pn3` artboard is about exactly this state, a company as text with no
 * organization record behind it, with the empty state as its primary
 * composition and the table underneath as what the roll-up would look like.
 * Give the route a body, and the chip row follows honestly.
 *
 * "Never" was the word to distrust. The note was written against a page, not
 * against a possibility, and it read as a rule about the zone. This one is
 * dated to what it observed.
 */
// TWO STRINGS THAT USED TO LIVE HERE ARE GONE, and their absence is the point.
// `ONE_ANSWER_ONLY` and `NO_ANSWER_RECORD` explained why all four of Ask's
// chips were prose: one answer on screen and no record of any past one.
// Migration 221 stored both, so the reasons stopped being true and went with
// the entries they justified. A reason kept past the gap it describes is worse
// than no reason at all — it reads as current.

// `ONE_SOURCE_ONLY` STOOD HERE AND IS GONE. It named one fact that cut both
// ways — every brief row was the founder's, so `Ours only` matched nothing and
// `Founder-sourced` matched everything — and migration 222 gave the firm rows
// of its own to separate out. `ClientPrepZone` is one file serving this licence
// and advisor, and both copies of the constant went together.

// `NO_OWNER_ON_A_RELATIONSHIP` AND `NO_INTERACTION_DATE` STOOD HERE AND ARE
// GONE, and the deletion is the whole of what changed on this zone. They said
// "no owner is stored on a relationship, so there is no assignment to bring
// forward and none to filter by" and "no interaction date is stored … the only
// history kept is that the row was created and edited". Both were true of
// `partner_relationships`, which this zone no longer reads: it is a
// partner-to-partner edge carrying a type and a hand-set `strength_score`.
//
// Migration 224 stores the firm's BOOK — `firm_owner_user_id`, nullable and
// unset on creation, and `partner_book_interactions.happened_at`, which is the
// date the touch happened rather than the date it was typed. Three of the four
// labels below narrow on those two columns, so all four now run. The reasons
// went with the gaps they described, because a reason kept past its gap reads
// as current.

// `NO_CONNECTED_STATE` STOOD HERE AND IS GONE, and it is worth recording that
// it was HALF wrong rather than simply out of date. It read: "accepting is
// recorded per side, so this page knows that you accepted and not whether they
// did; no connected state exists to mark an introduction as made". The first
// clause was a fact about the RESPONSE, not about the store — the counterpart's
// consent is the mirror row (`source = 'reciprocal'`, owned by
// `target_user_id`) and has been in `intro_propositions` since migration 150;
// only the DTO omitted it. Returning it made `Gated` mean the canvas's word
// again, so the `label:` override that renamed it `Awaiting you` went too.
//
// The second clause was right, and migration 225 is the answer to it: two
// consents mean an introduction MAY happen, and `intro_terms.made_at` is what
// says it did. Reading `accepted` as `Made` would have been the inference the
// old reason correctly refused.

// `NO_PRICING_MODEL` STOOD HERE AND IS GONE WITH THE GAP IT NAMED. It read: "a
// service stores one price and nothing saying whether it is charged once,
// monthly or per seat, so these three cannot be told apart" — one absent column
// shared by `Fixed`, `Retainer` and `Seat`. Migration 227 added it, the offering
// form writes it, and all three chips narrow on it.

// `/offers/perk-deals`'s two time chips ran on this until migration 228, and
// the reason is quoted rather than deleted because it was exact and its second
// half is still true: "a perk listing carries no date at all; the only expiry
// in this store is on a claim already issued to one founder, which says
// nothing about the offer." `perk_claims.expires_at` still exists and still
// says nothing about the offer. What changed is that `perks.ends_at` now
// exists beside it — one date per offer, one per issued code — so `Expiring`
// and `Expired` read the first and the confusion the note warned about is a
// distinction the schema now draws.

export const PARTNER_ZONE_FILTERS = {
  // ── Network ──────────────────────────────────────────────────────────────
  // FOUR OF FOUR, WHERE THIS ROW USED TO RUN ONE. `Unassigned first` and `By
  // owner` are the two sides of `firm_owner_user_id` being null or not — and
  // `Unassigned first` is the canvas's own default (`fil([…], 0)`), which is
  // the artboard saying the orphans are what this page opens on.
  //
  // `Going cold` IS SIXTY DAYS, AND THAT NUMBER IS THE ARTBOARD'S. `cold =
  // BOOK.filter(c => c.days !== null && c.days > 60)`, and its `cmpBody` says
  // "going cold past 60 days" in as many words. `MarketZone`'s ninety is a
  // different question about a different object — how stale a price reading may
  // be before a proposal may not carry it — and transcribing one onto the other
  // is how two numbers become one.
  //
  // A CONTACT WITH NO DATED INTERACTION IS NOT COLD. `days` is null there, and
  // the predicate requires a date, so an undated row is excluded rather than
  // swept in as maximally cold. It sorts to the bottom of the list — nobody
  // knows when it was last touched — but "we have no date" is not the same
  // claim as "it has been sixty days", and only one of them is in the store.
  'network/relationships': [
    { canvas: 'Unassigned first', key: 'unassigned' },
    { canvas: 'All', key: 'all' },
    { canvas: 'By owner', key: 'owned' },
    { canvas: 'Going cold', key: 'cold' },
  ],

  // FOUR OF FOUR, AND ALL FOUR NARROW ON A DERIVED STATE RATHER THAN ON
  // `status`. `stateOf` in `IntroductionsPanel` reads the caller's status and
  // the counterpart's together, which is what the artboard's pipeline is:
  // `Gated` is `Requested` or `One side` — a state a recorded consent could
  // still open — and `Made` is `intro_terms.made_at`, the introduction having
  // actually happened rather than merely being permitted.
  //
  // `Lapsed` HAS NO CHIP, DELIBERATELY. An expired proposition is not at a gate
  // (no consent can advance it) and is not declined (nobody refused), so it
  // belongs to none of the three narrow chips and is reachable through `All`.
  // Giving it a fifth chip would add a control the artboard does not draw;
  // folding it into `Gated` would count rows that cannot move as rows waiting
  // to.
  'network/introductions': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Gated', key: 'gated' },
    { canvas: 'Made', key: 'made' },
    { canvas: 'Declined', key: 'declined' },
  ],

  // THREE CHIPS OVER ONE COLUMN, AND THE COLUMN HAD TO BE BUILT FOR THEM.
  // `Clients`, `Prospects` and `Referral sources` are the three values migration
  // 226 added to a book contact, and without it all three would have selected
  // nothing on every account — D51's canonical failure, which is why this row
  // could not have been written before the store was.
  //
  // A COMPANY WHOSE CONTACTS DISAGREE MATCHES NONE OF THE THREE. The roll-up
  // reads `Mixed` there rather than picking a value, so it is not a client and
  // not a prospect; `All` shows it and the `Build records` board is where the
  // firm settles it. A chip that swept `Mixed` into one side would be the
  // tie-break the page refuses, moved into the filter.
  'network/organizations': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Clients', key: 'clients' },
    { canvas: 'Prospects', key: 'prospects' },
    { canvas: 'Referral sources', key: 'referrals' },
  ],

  // ── Offers ───────────────────────────────────────────────────────────────
  // Ten of nineteen labels run. The canvas is the same in
  // `design/canvases/integrated/` and `design/incoming/`, checked rather than
  // assumed — both name these nineteen in this order.

  // FOUR OF FOUR, AND THE COLUMN THEY WAITED ON IS MIGRATION 227's. The note
  // here read: "the catalogue's own axis is `is_active` … the canvas does not
  // ask for it — it asks how the work is priced. So `All` is what this row can
  // offer, and the other three wait on a column." They waited; the column
  // landed; `service_offerings.engagement_model` is CHECKed to exactly these
  // three values and the offering form writes it.
  //
  // A SERVICE WITH NO MODEL RECORDED MATCHES NONE OF THE THREE, and reads `Not
  // recorded` in the Model column. That is a firm that has not decided how it
  // charges for something, which is a real state and not a fourth kind — a chip
  // for it would be a control over an omission rather than over a choice.
  'offers/catalog': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Fixed', key: 'fixed' },
    { canvas: 'Retainer', key: 'retainer' },
    { canvas: 'Seat', key: 'seat' },
  ],

  // `Live` IS THE STORE'S OWN WORD. `perks.status` is a CHECK over `draft`,
  // `in_review`, `live`, `paused` and `rejected`, so the canvas's chip and the
  // column agree exactly and no relabel is needed.
  // FOUR OF FOUR, AND `Live` NOW MEANS BOTH THINGS IT SHOULD. It used to read
  // `perks.status = 'live'` alone — the REVIEW state, "an admin approved it".
  // The artboard's tile note for the same word is "accepting redemptions",
  // which is approved AND not past its end date. A perk approved in March and
  // ended in June is not accepting anything, and calling it Live said it was.
  //
  // A DRAFT WITH A FAR-OFF END DATE IS UNDER `All` AND ONLY `All`, and that is
  // the same fourth state `offers/proof` names below: not approved, not
  // ending, not ended. Sweeping it into `Live` would claim a review that has
  // not happened; sweeping it into `Expiring` would claim an urgency it does
  // not have.
  'offers/perk-deals': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Live', key: 'live' },
    { canvas: 'Expiring', key: 'expiring' },
    { canvas: 'Expired', key: 'expired' },
  ],

  // FOUR ORDERINGS, ONE OF WHICH IS THE ONE THE SERVER ALREADY RETURNS.
  // `GET /partner-offers/surfaces` ends `ORDER BY COUNT(es.id) DESC, s.name`,
  // and the zone's own blurb says so — "ranked by engagements rather than by
  // reach". So this chip names the ordering on screen rather than holding a
  // state, the way `network/relationships`'s lone `All` does.
  //
  // The other three are the two columns the zone's docblock refuses to draw
  // plus a word for something nothing records. Their reasons are separate
  // because the absences are: a ratio with no denominator, a count with no
  // pipeline, and a judgement with no input.
  'offers/visibility': [
    { canvas: 'By engagements', key: 'engagements' },
    {
      canvas: 'By leads',
      unbuilt: 'nothing records which surface a founder arrived through, so the lead half of the ratio has no source and the zone reports it absent rather than partial',
    },
    {
      canvas: 'By views',
      unbuilt: 'a view count needs an impression pipeline rather than a table, and the product records no impressions at all',
    },
    {
      canvas: 'Weak intent',
      unbuilt: 'nothing scores or records intent against a surface; what is stored per surface is engagements and the value they carried',
    },
  ],

  // THE ONE OFFERS ZONE WHERE EVERY LABEL RUNS, out of one array rather than
  // one column: each item carries `consents[]`, and the row already draws the
  // same three states per consenter — `Agreed`, `Withdrawn`, `Not answered`.
  //
  // THERE IS A FOURTH REAL STATE THE CANVAS HAS NO WORD FOR: an unpublished
  // item with NO consent row at all, where nobody has been asked. It falls
  // under `All` and only `All`. Sweeping it into `Awaiting consent` would be
  // the zone claiming a request was made, which is the same class of untruth
  // as a filter that returns an empty set and calls it an answer.
  'offers/proof': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Published', key: 'published' },
    { canvas: 'Awaiting consent', key: 'awaiting' },
    { canvas: 'Blocked', key: 'blocked' },
  ],

  // ALL FOUR RUN, AND THE TWO REASONS THAT STOOD HERE MISREAD THEIR OWN
  // ARTBOARD. They said: "no lead is scored against these rules — the worker
  // answers `enforcement: 'none'` — so nothing here is qualified or not", and
  // "the same absent score from the other end; a rule records who the firm is
  // for, and no row anywhere marks a lead as weak against one."
  //
  // Both are exactly right about LEADS and neither is what these chips select.
  // The artboard's own rows are "Series A companies without design leadership —
  // Qualified" and "Pre-product founders with a deck — Weak intent": the FIRM'S
  // judgement about a KIND of client, written down beside the profile, not a
  // score computed about anybody. Its instNote turns on the distinction — "pre-
  // product founders read as weak intent rather than declined, because the
  // honest answer is 'not yet'".
  //
  // Migration 229 stores that judgement as `partner_fit_rules.signal`, and
  // `enforcement: 'none'` is exactly as true after it as before: nothing scores
  // a founder, and the zone still says so.
  'offers/audience-fit': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Best fit', key: 'best_fit' },
    { canvas: 'Qualified', key: 'qualified' },
    { canvas: 'Weak', key: 'weak_intent' },
  ],

  // ── Delivery ─────────────────────────────────────────────────────────────
  // `/delivery/board` HAD NO ROW IN THIS TABLE AT ALL, which is why its four
  // chips never appeared: the zone rendered `EngagementsPage`, which draws
  // `ZoneActions` directly and no toolbar, so there was nowhere for a filter
  // row to go and nothing declaring one.
  //
  // THREE OF THE FOUR SELECT ON THINGS THAT ARE DERIVED, NOT STORED, and that
  // is correct rather than a compromise. `Project` and `Embedded` are whether
  // an engagement granted a seat — the artboard's "mode is structural, not a
  // status" — and `Needs attention` is `healthFor`'s rating, a read over five
  // tables that nothing stores because a stored copy would disagree with them.
  //
  // `Needs attention` IS THE TWO RATED-BAD STATES, not "anything not green".
  // An unrated engagement has nothing recorded against it, which the strip says
  // in its own tile; folding it in here would turn "we have not looked" into
  // "something is wrong".
  'delivery/board': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Project', key: 'project' },
    { canvas: 'Embedded', key: 'embedded' },
    { canvas: 'Needs attention', key: 'attention' },
  ],

  // `Never opened` IS THE DEFAULT, AND THE ARTBOARD PUTS IT FIRST ON PURPOSE:
  // `fil([...], 0)` selects it, because sent-and-not-opened is the firm's most
  // expensive state and a log that opens on everything buries it.
  //
  // `By client` IS AN ORDERING, NOT A SUBSET — it groups the same rows rather
  // than removing any, which is why its key selects everything and sorts. The
  // same shape `offers/visibility`'s `By engagements` has.
  'delivery/deliverables': [
    { canvas: 'Never opened', key: 'never_opened' },
    { canvas: 'All', key: 'all' },
    { canvas: 'Signed off', key: 'signed_off' },
    { canvas: 'By client', key: 'by_client' },
  ],

  // TWO OF THESE CHANGE THE PERIOD RATHER THAN THE ROWS. `GET /capacity` takes
  // `?period=`, and hours are logged per period, so `This week` and `Next week`
  // are two reads of the same store rather than two views of one read — which
  // is also why next week is usually empty and says so instead of reading as
  // nobody being busy.
  'delivery/capacity': [
    { canvas: 'This week', key: 'this_week' },
    { canvas: 'Next week', key: 'next_week' },
    { canvas: 'Seats only', key: 'seats' },
    { canvas: 'All', key: 'all' },
  ],

  // `Archive` IS EVERY EARLIER CYCLE, not a deleted state. A report is written
  // against a period and stays against it; there is no archive flag and there
  // does not need to be one.
  'delivery/status-reports': [
    { canvas: 'This cycle', key: 'this_cycle' },
    { canvas: 'Drafts', key: 'drafts' },
    { canvas: 'With blockers', key: 'blocked' },
    { canvas: 'Archive', key: 'archive' },
  ],

  // `At risk` IS THE DEFAULT for the reason the artboard opens on it, and it is
  // the two RATED-bad states rather than "anything not green": an engagement
  // with nothing recorded is unrated, not at risk, and the zone says which
  // separately.
  //
  // `Renewing soon` READS `partner_retainers.renews_at`, which migration 208
  // stored and indexed and which the health response now returns.
  //
  // `By owner` HAS NOTHING TO ORDER BY. Nothing records who at the firm owns an
  // engagement: migration 224 put a firm owner on a BOOK CONTACT, which is a
  // person the firm knows rather than a piece of work it is running, and
  // reading one as the other would name the wrong person against every row.
  'delivery/health': [
    { canvas: 'At risk', key: 'at_risk' },
    { canvas: 'All', key: 'all' },
    { canvas: 'Renewing soon', key: 'renewing' },
    // `By owner` WAS PROSE, AND THE REASON WAS EXACTLY RIGHT AT THE TIME: it
    // read "nothing records who at the firm owns an engagement; the firm owner
    // migration 224 added belongs to a book contact, which is a person the firm
    // knows rather than work it is running." Migration 232 records the second
    // thing — `partner_engagement_health.owner_user_id`, written from the
    // health zone and returned on every row — so the distinction 224 could not
    // cross is now on both sides. Unassigned sorts first: an engagement nobody
    // owns is what this ordering exists to surface.
    { canvas: 'By owner', key: 'owner' },
  ],

  // ── Research ─────────────────────────────────────────────────────────────
  // ALL FOUR LIVE, AND MIGRATION 222 IS WHY. Three carried `ONE_SOURCE_ONLY`
  // and a fourth its own sentence, and all four were exact: every row this
  // brief produced was the founder's, so `Ours only` matched nothing and
  // `Founder-sourced` matched everything, and no row could be marked open
  // because none was the reader's to settle. `research_brief_notes` is the
  // second source — a row the firm writes against a client it holds a live
  // grant over — and `open` is a flag on those rows only.
  //
  // `Open items` IS `Ours only` NARROWED, NOT A THIRD AXIS, and that is the honest
  // shape rather than a shortcut: a founder-sourced row is the client's record,
  // quoted, and ticking it off would be editing someone else's fact.
  'research/client-prep': [
    { canvas: 'Full brief', key: 'all' },
    { canvas: 'Ours only', key: 'ours' },
    { canvas: 'Founder-sourced', key: 'client' },
    { canvas: 'Open items', key: 'open' },
  ],
  // Three live, one prose. The windows are this canvas's own — `const STALE_AT
  // = 90, AGE_AT = 30`, ninety where advisor's artboard says a hundred and
  // twenty, which is why the number lives in each licence's own table rather
  // than in the shared body. Age comes from each signal's evidence
  // `observed_at`, never from `updated_at`: the ingestion job stamps every row
  // it touches with one run timestamp, so that column cannot tell two signals
  // apart.
  'research/markets': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Current', key: 'current' },
    { canvas: 'Stale', key: 'stale' },
    {
      canvas: 'Attached to proposals',
      unbuilt: 'no row joins a signal to a proposal — the only foreign keys to a signal in the whole schema are its evidence and the companies it names',
    },
  ],
  // ALL FOUR LIVE, AND MIGRATION 221 IS WHY. Both of these entries used to
  // carry prose — `ONE_ANSWER_ONLY` for the two that narrow a thread and
  // `NO_ANSWER_RECORD` for the two that need a past. `POST /api/research/ask`
  // answered and returned without writing anything down, so there was one
  // answer on screen, no history behind it, and four chips that could only
  // have selected everything or nothing. `research_ask_sessions` and
  // `research_ask_answers` store every exchange including the ones that came
  // back with no source, which is exactly what `Unanswered` selects on.
  //
  // TWO SCOPES AND TWO PREDICATES, DELIBERATELY. `This session` and `All
  // history` are different READS — the page asks the worker for a different
  // slice — while `Cited` and `Unanswered` narrow whichever slice came back.
  // Splitting them the other way would make `Cited` mean "cited answers in
  // this session" on one chip and "in all history" on another, which is two
  // chips for one question.
  'research/ask': [
    { canvas: 'This session', key: 'session' },
    { canvas: 'All history', key: 'all' },
    { canvas: 'Cited', key: 'cited' },
    { canvas: 'Unanswered', key: 'unanswered' },
  ],
  // Four labels, four predicates, no prose — the only zone in this pass where
  // that happens. `Client docs` needs no relabel: `About a client` is what the
  // upload form calls the same value, so the canvas's word and the store's word
  // agree for once. Advisor's slot says `Session docs` and is relabelled,
  // because nothing attaches a document to a session.
  //
  // `Not indexed` tests `index_state`, not the passage count beside it: a
  // document that indexed once and later failed a re-index keeps its old count,
  // so filtering on the number would drop exactly the rows this chip is for.
  'research/library': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Client docs', key: 'client' },
    { canvas: 'Reusable', key: 'playbook' },
    { canvas: 'Not indexed', key: 'unindexed' },
  ],

  // ── Pipeline ─────────────────────────────────────────────────────────────
  // THE WHOLE BUCKET WAS ABSENT FROM THIS TABLE, so five zones with a `views(…)`
  // row on their artboard rendered no chip row at all. Not prose, not a
  // relabel — nothing. The labels below are `Pages · Partner Pipeline`'s own,
  // in its own order, out of the five `views([…])` calls in its data prelude.

  // `Open` IS THE DEFAULT AND IT IS A THREE-WAY EXCLUSION, not a status column:
  // a need this firm has quoted on is a PROPOSAL and a need with a pass row is
  // a PASS, so an open lead is what is left. The artboard states the rule
  // itself — "a lead you already bid is not a lead, and a lead you declined is
  // not one either" — and the read enforces it rather than trusting a flag.
  //
  // `Warm intros` READS PROVENANCE, and on this build there is exactly one kind
  // of it: every lead this product can see is a marketplace need. Nothing
  // records a lead arriving through an investor or a referral, so this chip
  // selects the whole open list and says so rather than pretending to narrow.
  'pipeline/leads': [
    { canvas: 'Open', key: 'open' },
    { canvas: 'Strong fit', key: 'strong' },
    {
      canvas: 'Warm intros',
      unbuilt: 'every lead here is a marketplace need — nothing records a lead arriving through an investor or a referral, so there is no second provenance to select',
    },
    { canvas: 'Passed', key: 'passed' },
    { canvas: 'All sources', key: 'all' },
  ],

  // `Opened, unanswered` AND `Never opened` BOTH READ `quotes` AND BOTH ARE
  // ABOUT A COLUMN NOBODY WRITES. No surface lets a client mark a proposal
  // read, so "never opened" means "we have not heard" — the same reading
  // `delivery/deliverables` documents at length. The chips stay, because the
  // distinction they draw is real on the firm's side (sent vs decided); what
  // the zone must not do is read either as the client ignoring it.
  'pipeline/proposals': [
    { canvas: 'All', key: 'all' },
    // BOTH OF THESE NEED A READ RECEIPT AND NOTHING RECORDS ONE. `quotes` has
    // no open, no view count and no client-side surface that could write one —
    // the same absence `engagement_deliverables.opened_at` has, for the same
    // reason: an open is the client's act. So the two states the artboard
    // separates are ONE state here, and two chips over one state would be
    // inventing the distinction they claim to filter on. The zone says the
    // same thing in its strip, where both tiles read absent.
    {
      canvas: 'Opened, unanswered',
      unbuilt: 'nothing records that a client opened a proposal, so this cannot be told from one never read',
    },
    {
      canvas: 'Never opened',
      unbuilt: 'the same missing read receipt — naming a silent proposal never-opened would be a claim about our own send',
    },
    { canvas: 'Won', key: 'won' },
    { canvas: 'Lost', key: 'lost' },
  ],

  // `quote_negotiations.ball` IS EXACTLY THESE TWO CHIPS — migration 208 stores
  // `us` / `them` and the zone already renders it. `Stalled 7d+` reads
  // `days_stalled`, which the worker computes from `last_moved_at` rather than
  // letting the page do it against a different clock.
  'pipeline/negotiations': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Awaiting you', key: 'us' },
    { canvas: 'Awaiting them', key: 'them' },
    { canvas: 'Stalled 7d+', key: 'stalled' },
  ],

  // `Renewing 30d` READS `partner_retainers.renews_at`; `Under-consuming` and
  // `Over scope` read the utilisation the retainers zone already computes —
  // under 70% and over 100% of retained hours. A retainer sold as a fee rather
  // than by the hour has no retained hours and therefore no utilisation, so it
  // is in neither: it is unmeasured, not fine.
  'pipeline/retainers': [
    { canvas: 'All', key: 'all' },
    { canvas: 'Renewing 30d', key: 'renewing' },
    { canvas: 'Under-consuming', key: 'under' },
    { canvas: 'Over scope', key: 'over' },
  ],

  // THREE PERIODS AND A GROUPING, which is what an analytics chip row is. The
  // quarters are relative to today rather than the canvas's `Q3 2026` — that
  // date is when the artboard was drawn, and a page whose first chip named a
  // fixed quarter would be wrong for every reader after it.
  'pipeline/analytics': [
    { canvas: 'Q3 2026', key: 'quarter', label: 'This quarter' },
    { canvas: 'Q2 2026', key: 'prev_quarter', label: 'Last quarter' },
    { canvas: 'Year to date', key: 'ytd' },
    { canvas: 'By shape', key: 'shape' },
  ],
};

export const partnerZoneFilters = makeZoneFilters(PARTNER_ZONE_FILTERS);
