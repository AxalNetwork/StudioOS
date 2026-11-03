# services/fills

"AI fills the blanks", and since #2431 "Fill with Eadwyn": which fields may be
filled, what each fill must promise, where a value came from, and the writes
that keep it. Read [D777](../../../../documentation/architecture/decisions/D777.md),
[D1323](../../../../documentation/architecture/decisions/D1323.md),
[D1325](../../../../documentation/architecture/decisions/D1325.md) and
[D1326](../../../../documentation/architecture/decisions/D1326.md) first.

**Eadwyn proposes and a person accepts.** Nothing in this folder writes a
value into a record the member did not keep, and every path that records a
fill ends in `provenance.ts`' `recordFill`, which refuses a never-fill field
whatever its caller passed.

| File | What it owns |
| --- | --- |
| `types.ts` | The three fill classes (`restatement`, `sourced`, `composition`), `Citation`, `FillTarget` and the fill-kind shape. |
| `registry.ts` | `FILL_KINDS`: Validate's fills, each kind's surface, parse and `apply` (the form's own writer). |
| `citations.ts` | Citations for a `sourced` fill, from the Library first and research second. |
| `neverFill.ts` | The fields Eadwyn never fills (D777), mirrored by `frontend/src/lib/neverFill.js`. |
| `fields.ts` | D1325: FILL_FIELDS, which form fields Fill with Eadwyn may fill, how and from where; mirrored by `frontend/src/lib/fillFields.js`. |
| `sources.ts` | D1325: FILL_SOURCES, the read-only adapters the sheet gathers (Eadwyn's waiting proposals, a connector's state, a module's choices). D1329: a publication's Summary also offers H20's waiting `draft:publication-summary` draft. |
| `provenance.ts` | `fill_provenance`: `recordFill`, `recordCompositionFills`, migration 643's source columns and `marksForRows`. |
| `formRun.ts` | D1326: the `form` handler's gather, prompt and parse for `POST /api/ai/rail/run`. It writes nothing. |
| `scopes.ts` | D1329: RECORD_SCOPES, the records filled that are not a venture's (an advisor's service, a partner's status report, an event and its agenda, a publication, an IC memo), each with one literal read and its own route's write check; a reader gets marks and no trigger, an admin gets none on another member's decision record, an Explorer holds nothing to fill. D1595 adds a support entry (an investor's book), a service offering and a perk (their owner's): each shares its route's gate from `../profileWriteGates.ts`, reads the request's active company (`ScopeContext`), and is `concealed`, so a caller who may not read it is told it does not exist. |
| `keep.ts` | D1326: after the member decides. `recordKept` (after a form's Save), `acceptRows` (Accept all, at most 50, through `ROW_WRITERS` by table, `FORM_ROW_WRITERS` by `<page> / <form>` where two forms share a table, as Add feature and Add must-have do, D1328, or `SCOPED_ROW_WRITERS` for a parent that is not a venture, D1329) and `undoFill` (through `UNDO_WRITES`, only while the field holds the fill). |

**Rule for adding here.** A new form joins FILL_FIELDS (both copies) and, if
it writes rows, `ROW_WRITERS` (or `FORM_ROW_WRITERS` when its table is another
form's too); a new table joins `../../routes/fills.ts`' `ROW_READS`,
`../../routes/rail_run.ts`' `ROW_REQUIRED` and `formRun.ts`' `EXISTING_READS`; a new
undoable column joins `UNDO_WRITES` as one literal statement. No table or
column name is ever spliced into SQL. D1328 (#3489) adds the founder's forms in
parts of at most 30 fields, each form's entries in their own block.

**#3740 part 2a.** Three founder Add forms join, one composition field each:
Build › Product roadmap's item (`roadmap_okrs.objective`), Raise › Capital
relationships' investor (`raise_prospects.notes`) and Grow › Team expansion's
role (`job_postings.title`), with their Edits (`edit-item`, `edit-investor`,
`edit-role`). None offers "add several rows" (no `ROW_REQUIRED`). Not listed,
by the never-fill rule or for want of a composition field: a demand signal
(a person, an amount, a date), a founder (identity, equity, vesting), a filing,
a narrative version, a partner (terms), a market (scores) and feedback's words
(what a customer said). Market intelligence's `why` and feedback's new theme
wait for a later part: the competitor's row is keyed by name and the
feedback's by uid, which `ROW_READS` and `fillRecordId` do not take. An
obligation's title waits for its Edit form to draw one.

**#4046 Group A1.** The three forms part 2a left join, one composition field
each: Validate › Market intelligence's competitor (`competitor_tracking.why_it_matters`,
Add and `edit-competitor`), Grow › Product improvement's feedback (its new theme,
`product_feedback.theme`, Log feedback only: its Edit picks a theme from the
venture's chips) and Grow › Durable company building's obligation
(`compliance_events.title`, Add and `edit-obligation`, whose Edit now draws the
title). A row a form names by a text key is resolved by `ROW_KEYS` in
`../../routes/fills.ts` (`venturedRowId`): a competitor by its candidate id (the
tracking row is keyed by the name, `competitorNameNorm`) and feedback by its uid,
each to its own id on the venture, literal statements only; the frontend sends a
text key only for `KEYED_FILL_TABLES`. A customer's words are never read for a
fill: feedback's `EXISTING_READS` reads the venture's themes alone.
**#4046 (#3740 2b), the deal page's New note.** `deal_notes.body` joins as
one composition field (`Investor · Deals · Deal room` / `deal-note`), under
a `deal_notes` scope in `scopes.ts` that reads the notes route's own rule
from `../dealNotes.ts` (`noteFirm`, `visibleDeal`): the firm is the request's
verified active company, else the caller's only firm, and a claim that does
not verify never falls back; a firm's note is read by that firm, a firm-less
note by its author alone, and only the author fills it. No admin and no staff
bypass, so the scope is concealed. The tag is the investor's own call and has
no entry. No rows are offered. The other three 2b screens are not built here:
the DD memo's parts are encrypted at rest (`dd_case_memos.*_enc`) while
`fill_provenance` keeps proposed and written values in plaintext; a closing
paper's open fields are merge values of a preview, not a stored column, and
the non-money ones are names and dates; the data room's "Eadwyn proposals"
are actions (a match, a folder), not field values.

**#4046 Group B2, the owner's calls 2 and 5.** Two forms join, composition only.
- **`/events/new`:** the event form's Title joins its Description
  (`events.title`, on the edit page as well). A new event hangs under the
  caller, its host (`events`' parent is `owner`, `ownUserId`, because `POST
  /api/events` makes the caller the host). Any profile the page admits may
  draft one. The run reads the host's own last event titles and nothing else.
  The Save and Publish paths record against the new event's id. An event's
  times, capacity, price, visibility and approval are never listed.
- **A product-testing programme's answers** (`Member · Studio · Product
  testing` / `testing-answers`): `answer_1` to `answer_5` on
  `testing_applications`. The scope's read lays out `answers` (a JSON list)
  one column per answer, so the record step compares each one.
  - A new application hangs under the programme (`programme`), for a member
    `apply` would take now (`../testing.ts` `mayApplyTo`). Anyone else is
    told it does not exist (concealed).
  - The run reads the programme's questions, its firm and what the test asks,
    and the member's own role and headline. It never reads another tester's
    answers. It asks only the programme's own questions: `FormGather.only`,
    applied in `rail_run.ts` before any quote. It adds one line on voice
    (`FormGather.guide`): the member's own words, with no claim they did not give.
  - After Apply, the record step keeps what still equals each placed answer. An
    Undo is always refused (`no_prior`), because the firm reads what was sent.
  - Availability and the email consent are never listed.

## #4046 Group B4

- **Propose a program** (`Admin · Programs` / `program-proposal`): a studio's
  program proposal's Name, One-line purpose and Eligibility on
  `program_proposals`, composition only. Who it is for, group, join method,
  cycle, weeks, seats, rewards, templates, what HQ receives, tools and HQ's
  note and decision are the studio's or HQ's call and are never listed; HQ's
  New program dialog draws the same fields with no Fill.
  - The scope is `requireAdmin` then `ownRow`'s studio rule
    (`../programProposals.ts`): a licence's admins share its proposals, an
    admin bound to no licence holds only their own. A new proposal hangs under
    the caller (`owner`, `ownUserId`). It is filled while `draft` or
    `sent_back`, and never by a frozen admin: the scope asks `adminWritesFrozen`
    (`../../auth.ts`, D135's rule), so an Undo through `/api/fills` cannot write
    what Save could not. A Super Admin reads a proposal that is not a draft and
    fills none of another studio's. Anyone else is told it does not exist
    (concealed), as the route answers `unknown_proposal`.
  - The run reads the studio's own other proposal names, the program names its
    admins can see (never HQ's `proposed` drafts) and this proposal's own name
    and choices (who, group, join method, cycle). Never HQ's note or decision,
    seats, rewards, templates, what HQ receives, a sender or another studio's
    proposal.
  - `proposalView` now answers the integer `id`, so the page records after Save
    (between the Save's answer and the move to `?proposal=<uid>`). An Undo may
    put back a blank, since a draft may hold one; the undo statements carry no
    status clause, because the scope refuses a proposal that is no longer
    editable before `undoFill` runs.
- **New invitation's message** (`Admin · Community · Partner invitations` /
  `partner-invitation`): `partner_invitations.personal_message`, the admin's
  note shown in the email and at the start of the onboarding chat,
  composition only. The invitee's email and name, what to offer and the terms
  are never listed.
  - A new invitation hangs under the caller (`owner`, `ownUserId`), as `POST
    /api/admin/partners/invitations` (`requireAdmin`) binds the caller as
    `invited_by_user_id`. Any admin drafts one; a sent one is read by any admin
    and filled by its inviter alone. No partner or member reaches one, so the
    scope is concealed. The frozen-admin and suspended-branch refusals stay with
    the POST, the only write of the row.
  - The run reads the inviter's own last five messages (`gatherScoped`) and
    nothing else: never the invitee's email or name, the lookup, what to offer,
    the terms or another admin's invitation.
  - The dialog records against the 201's `id` before the result replaces the
    form. An Undo is always refused (`no_prior`): the message left in the email
    as the row was made, and a resend reads it again. The table has no
    `updated_at`, so the undo statement stamps nothing. Add only: no form or
    route rewrites a sent message (the #3740 guard's Edit is exempt).
- **A reviewer's comment** (`Super Admin · Content · Content queue` /
  `review-comment`): the review drawer's new comment to the article's author,
  `article_review_comments.body`, composition only. The paragraph it points
  at, a reply, Resolve, every stage change and its reason are never listed.
  - A new comment hangs under the article (a new parent kind, `article`, on
    `article_id`). `POST /api/admin/articles/:id/comments` is `requireAdmin`
    and checks no article, so the scope does: any admin drafts one under an
    article that exists. Any admin reads a sent comment (the drawer lists them
    all); only its author fills one, so a Super Admin, whom the route lets
    rewrite another admin's words, gets no trigger on them. Not concealed: the
    route conceals nothing from an admin and refuses everyone else.
  - The run reads the article's own title, subtitle, sector and first 4000
    characters, and its last ten first comments, so a note is not a repeat.
    Never a reply, the author's name or email, a revision's or rejection's
    reason, the stage or another article. It adds a reviewer's voice line
    (`FormGather.guide`): what to clarify, cut or check, never a verdict, a
    stage or a deadline.
  - Send records against the 201's `id` inside the drawer's `run`, before the
    comments are read again. The hook sits before the tab's early return for
    an unreadable list, and is off while the list is unreadable. An Undo is
    always refused (`no_prior`): the comment reached the author's editor as it
    was made. The table has no `updated_at`; the undo statement stamps
    `edited_at` as PUT `/comments/:cid` does.
- **HQ's New segment** (`Super Admin · Content · Personas` / `segment-profile`):
  a segment profile's Name and Who they are on `segment_profiles`,
  composition only. The key (the segment's permanent identity), its profile
  and status (HQ's decisions; status gates sign-up), its typical, needs and
  offers (the segment page's edit), a reason and the expected version are
  never listed.
  - The scope is `requireSuperAdmin`'s rule exactly: an admin with the Super
    Admin elevation, on HQ (`isSuperAdmin` and `!branchOf`, a second lock
    beside `hydrateSuperAdmin`'s branch answer). A plain Admin, or any admin
    on a branch, reads with no trigger (the GETs are `requireAdmin`); anyone
    else is refused. Not concealed: the route conceals nothing from an admin.
    `requireAdmin`'s D135 freeze never applies, since it exempts a Super
    Admin. A segment hangs under no record, so a new one hangs under the
    caller (`owner` on `updated_by`, which `createProfile` stamps).
  - The key is TEXT, so the fill keys a segment by its rowid: `POST
    /api/personas/segments` now answers `segment.id` (the rowid, read back by
    key), and the page records after Confirm creation, before the result
    replaces the form. `segmentProfiles.ts`' header says a rebuild must keep
    the rowid; no route deletes a segment.
  - The run reads the segment names already on file and nothing else: never a
    key, another segment's who, a member, a count, a suggestion or a history
    row. No rows are offered (`ROW_REQUIRED` has no entry).
  - An Undo is always refused (`no_prior`, both entries `required`): every
    segment write adds a version, a `segment_profile_history` row and an
    admin audit copy (`writeProfile`), and one statement cannot add the last
    two, so HQ revises the words in the segment's own edit. The statements
    still bump `version`. The Edit side is exempt in the #3740 guard for the
    same reason.
