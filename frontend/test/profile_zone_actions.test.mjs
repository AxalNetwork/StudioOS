/**
 * The honest pass: every zone's header carries its canvas's actions, and each
 * one either works or says why it does not.
 *
 * NOT TO BE CONFUSED WITH `zone_actions.test.mjs`, which guards a different
 * thing: the `ACTIONS` map inside `FounderValidateWorkspace.jsx`, where four
 * Validate zones dispatch to handlers that call `api.*` methods. That file
 * follows one chain down to a worker route. This file follows the other
 * direction — from each canvas's `ops:` array out to what the product can
 * actually do — across every profile.
 *
 * WHAT THIS FILE IS DEFENDING. The request that produced this work was that
 * every subpage carry its data-entry actions. The way to fail it quietly is to
 * draw the buttons and wire none of them — a page then LOOKS finished and does
 * nothing, which is worse than the empty header it replaced, because the reader
 * now believes they tried. So the assertions below are about the promise, not
 * the pixels: the labels are the canvas's, every link goes somewhere that
 * profile's licence may actually open, and anything that performs nothing is
 * prose.
 *
 * ONE FILE, EVERY PROFILE. The rules are identical and the answers are not —
 * `/matches` is a working destination for an investor's "Request an intro" and
 * a closed door for a founder's identical one — so the checks are parameterised
 * over `PROFILES` and each profile brings its own table, canvases and pages.
 *
 * Run with:
 *   node --test frontend/test/profile_zone_actions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');

const PROFILES = {
  founder: {
    table: 'frontend/src/workspaces/founderZoneActions.js',
    // `workspaces/founder/FounderValidateWorkspace` mounts the four
    // `/validate/*` rows and needs no entry of its own: `pageFiles` RECURSES, so
    // naming the subdirectory here would walk that file twice and trip the
    // mounted-exactly-once check against itself. Its sibling's `mountingFile`
    // does not recurse and does name it — the two readers differ, and this
    // comment is here because the symmetry is the tempting wrong guess.
    pages: ['frontend/src/pages/founder', 'frontend/src/pages/research', 'frontend/src/workspaces'],
    call: 'founderZoneActions',
    canvas: /^Pages · Founder /,
    buckets: /^(validate|build|grow|network|raise|research)\//,
    zones: 30,
    links: 17,
    exports: 20,
    // Seven ops the PAGE performs: six of Validate's — three open a dialog the
    // workspace owns and three are server-side CSV downloads with a busy state —
    // plus `research/ask`'s `New brief` and `research/library`'s `Upload` —
    // one starts a thread in the session store migration 221 added, the other
    // opens the file picker on the form already on the page.
    //
    // THE KIND HAS SPREAD, WHICH IS WHAT THESE COUNTS ARE FOR. It was one
    // profile's answer and is now four; the note that used to sit here said
    // "pinning it at 0 elsewhere is what makes a second one show up as a change
    // rather than as a silent spread", and that is exactly how this landed —
    // three counts went red in one run and each was read before it was moved.
    handlers: 8,
    // NOTHING IS EXCLUDED ANY MORE. `research/funds` sat here as "a card in
    // `ResearchWorkspace`'s ZONE_COPY, not a body" — true when it was written
    // and untrue since `ZONE_COPY` became `{}` and `LIVE_ZONES` gained `funds`.
    // `FundsZone` takes `zoneActions` and renders `zoneActions(visible)`, so the
    // canvas's `Add fund · Brief me · Export` drew nothing at all. The identical
    // staleness `research/client-prep` carried on advisor and partner, found the
    // same way: by the filters half needing an action table for the same zone.
    excluded: [],
    embeddedGuards: 3,
    // Founder canvas routes are the live routes.
    live: (route) => route.replace(/^\//, ''),
  },
  investor: {
    table: 'frontend/src/workspaces/investorZoneActions.js',
    pages: ['frontend/src/pages/investor', 'frontend/src/pages/research', 'frontend/src/workspaces'],
    call: 'investorZoneActions',
    canvas: /^Pages · Investor /,
    buckets: /^(deals|funds|portfolio|network|research)\//,
    zones: 19,
    links: 1,
    // Fourteenth export: `portfolio/value-add`'s. Was a gap reading "there is
    // no support history to export", which was TRUE — see the handler note.
    exports: 14,
    // Five page-supplied ops: `research/ask`'s `New brief`,
    // `research/library`'s `Upload`, `portfolio/positions`'s `Mark history`,
    // and `portfolio/value-add`'s `Log support` and `Per-company view`. Was 0,
    // then 2, then 3.
    //
    // THE THIRD ONE WAS A GAP THAT SHOULD NEVER HAVE BEEN ONE. It carried the
    // reason "only the current mark is stored; there is no history to open",
    // and `portfolio_marks` is a history table whose rows
    // `GET /positions/:projectUid` was already returning to the very readers
    // looking at the disabled button. A gap becoming a handler is the shape
    // this ledger should move in; the reverse needs an argument.
    //
    // THE FOURTH AND FIFTH MOVED FOR THE OPPOSITE REASON, AND IT IS WORTH THE
    // DISTINCTION. `portfolio/value-add`'s three reasons were checked the same
    // way and all three were true: no table in the schema records an investor
    // doing work for a company, only gaining access to one. So these did not
    // become handlers because a reason was wrong — migration 237 built the
    // store the reason correctly said was missing. A gap closed by building is
    // a different event from a gap that was never real, and this file should
    // not blur them.
    handlers: 5,
    // Nothing is excluded. `research/diligence` and `research/benchmarking` sat
    // here behind "both are cards in ResearchWorkspace's ZONE_COPY, not
    // bodies" — a reason that had stopped being true: ZONE_COPY is now `{}`,
    // both slugs are in LIVE_ZONES, and both have had real bodies since the
    // research stores landed. Worse, both were already CALLING zoneActionsFor,
    // so with no key in the table they rendered an empty action row on an
    // artboard that specifies three ops each. The exclusion was hiding a
    // shipped gap rather than deferring one.
    excluded: [],
    embeddedGuards: 1,
    // `Pages · Investor Fund` names /fund/*; the router and shellConfig.js both
    // say /funds/*, and "accounting" is mounted at the slug "ledger". The
    // mapping is written down rather than fuzzy-matched, so a canvas route that
    // stops resolving fails here instead of silently matching nothing.
    live: (route) => ({
      '/fund/lps': 'funds/lps',
      '/fund/calls': 'funds/calls',
      '/fund/accounting': 'funds/ledger',
      '/fund/reporting': 'funds/reporting',
    }[route] ?? route.replace(/^\//, '')),
  },
  partner: {
    table: 'frontend/src/workspaces/partnerZoneActions.js',
    // Partner zone bodies are spread over three subtrees, and two of them are
    // shared pages the bucket router hands a render prop to. All of it is in
    // scope: a zone mounted from `PartnerBucketRoutes` counts as mounted.
    pages: ['frontend/src/pages/partner', 'frontend/src/workspaces'],
    extra: ['frontend/src/pages/ServiceCatalogPage.jsx', 'frontend/src/pages/PerksPage.jsx'],
    call: 'partnerZoneActions',
    // Delivery and Offers ship from `integrated`; Network and Research from
    // `incoming`. Both are read, so a canvas that moves between them does not
    // silently drop out of this check.
    canvasDirs: ['design/canvases/integrated', 'design/incoming'],
    canvas: /^Pages · Partner /,
    // `/pipeline` IS IN SCOPE NOW, and the comment that used to sit here is the
    // reason it was not: it said `Pages · Partner Pipeline` "carries no `ops:`
    // on any artboard, so `canvasOps` finds nothing there and this pattern must
    // not claim it does". The premise was this reader's, not the canvas's. That
    // file has carried all seven ops as `class="vm"` since it was committed —
    // `artboardOps` above reads them now — so the five Pipeline zones are held
    // to their artboard like every other zone. `/network` and `/research` are
    // in scope for the ordinary reason: their canvases live in
    // `design/incoming/`, which `canvasDirs` above opens.
    buckets: /^(delivery|offers|network|pipeline|research)\//,
    // Twenty-two, and the twenty-second is `network/organizations`. It was the
    // one zone whose canvas ops row had no table entry, on the reading that the
    // route rendered a stated gap rather than a list — true of the page that
    // then existed, and migrations 224 and 226 changed it. Was 21.
    zones: 22,
    // ONE LINK, AND IT REPLACED A REASON THAT HAD GONE STALE. `pipeline/leads`'
    // `Edit capability weights` was prose on the grounds that "no capability
    // register is stored, and no weight against one" — true when it was
    // written, and untrue since `partner_fit_rules` (209/229) was built for
    // Offers · Audience fit. The rules are edited there and read on Leads, so
    // the op links to the one place they are written rather than opening a
    // second form over the same numbers. Was 0.
    links: 1,
    // Twenty exports. Organizations exports the roll-up it is showing: the
    // grouped companies, their relationship and how many people the firm knows
    // inside each. The two absent columns ship as empty cells rather than as
    // the words "Not recorded", which in a spreadsheet invite a formula over a
    // fact that does not exist. Was 19.
    exports: 20,
    // Eight page-supplied ops. `research/ask`: `New session` starts a thread,
    // `Saved answers` switches the view to the kept ones. `research/library`:
    // `Add document` opens the file picker, `Re-index` re-queues every document
    // Ask cannot currently read. `research/client-prep`: `Attach to proposal`,
    // which migration 222's `research_attachments` made an edge rather than a
    // wish. `network/relationships`: `Assign owner` opens the board where
    // ownership changes and `Log interaction` dates a touch — both were gaps
    // reading "no owner field is stored on a relationship" and "no interaction
    // log is stored", true of `partner_relationships` and not of the book
    // migration 224 stores. `network/introductions`: `Consent log`, which was
    // prose reading "consent is recorded per introduction, not as a log" — a
    // claim about the RESPONSE rather than the store, since both sides' answers
    // have been rows since migration 150 and only the DTO omitted the second.
    // `network/organizations`: `Build records`, which opens the board where the
    // firm says what each company IS to it — the one organization fact
    // migration 226 gave the book a place for. It does not create an
    // organization record; there is no such table, and that absence is the
    // subject of the whole page. None is a destination, which is why none is a
    // `offers/catalog`: `New service`, which was prose reading "services are
    // added from the catalogue's own form below" — true of a body with a New
    // offering button above it, and the artboard's composition has no such
    // button: the ops row IS the header. `offers/perk-deals`: `New perk`, the
    // same correction on the same grounds; and `Extend`, which was 'an expiry
    // is edited on the perk itself, not extended in bulk' — not a preference
    // but a description of a table with no expiry on it at all, and migration
    // 228 put one there. None is a destination, which is why none is a `to:`.
    // `offers/proof`: `Ask for consent`, whose reason described a page that no
    // longer exists — "no founder-side surface exists to ask from here", and
    // `/attest/partner/:token` is that surface, mounted in `App.jsx` since
    // migration 209. None is a destination, which is why none is a `to:`.
    // `offers/audience-fit`: `Pass reasons`, whose reason was wrong about its
    // own store — "a pass reason is not a stored field on a fit rule", and
    // `partner_fit_rules.statement` is exactly that field, the one the form
    // labels "The sentence a pass quotes". None is a destination, which is why
    // none is a `to:`.
    // Was 0, then 5, then 7, then 8, then 9, then 10, then 12, then 13.
    handlers: 14,
    // NOTHING IS EXCLUDED ON THIS PROFILE ANY MORE. The entry that stood here
    // read: "`network/organizations`: `NetworkPage` catches a slug it has no tab
    // for and suppresses every body … there is nothing for a row to sit over.
    // Checked again rather than inherited: `ORG_BACKED` in
    // `NetworkWorkspace.jsx` is still `['founder', 'investor']`, so this one is
    // as true as it was." It was checked, it was true, and it stopped being
    // true when `ORG_BACKED` gained `partner` and the zone got its own body.
    // Re-checking an exclusion against the code is what makes it fall over on
    // the commit that invalidates it rather than three months later.
    //
    // `research/client-prep` USED to be listed here as "a card, not a body". It
    // is a body — `ClientPrepZone.jsx` takes `zoneActions` and renders a row
    // from it — so the exclusion was hiding three specified ops that drew
    // nothing, exactly as the investor Research pair did.
    excluded: [],
    embeddedGuards: 0,
    // The nine partner bodies that take the "no firm attached" branch —
    // `offers/{visibility,proof,audience-fit}`, `pipeline/{negotiations,
    // retainers}` and all four of `delivery/*`. Only this profile has the
    // branch at all: it is `requirePartnerProfile` that throws.
    gateBranches: 9,
    // `Pages · Partner Research` names /research/market; the router and
    // shellConfig.js both say `markets`.
    live: (route) => (route === '/research/market' ? 'research/markets' : route.replace(/^\//, '')),
  },
  advisor: {
    table: 'frontend/src/workspaces/advisorZoneActions.js',
    pages: ['frontend/src/pages/advisor', 'frontend/src/workspaces'],
    call: 'advisorZoneActions',
    // TWO SHAPES AND TWO DIRECTORIES. `Pages · Advisor {Expertise,Network,
    // Research}` ship from `design/incoming/` and carry an `ops:` array;
    // `Advisor Detail · Practice` ships from the integrated set and is shape B
    // markup. This reader does not open `design/incoming/` for the other two
    // profiles, so it must for this one.
    //
    // THIS COMMENT USED TO SAY THE PRACTICE CANVAS HAD NO HEADER ACTIONS ON
    // ANY ARTBOARD. It has eight, and has had since it was committed — the
    // reader could not see them because they are `class="bulk"` rather than
    // `class="vm"`, which is fixed above. The claim was written from the
    // reader's blind spot rather than from the canvas, which is precisely the
    // mistake `canvasOps`' own docblock records for `Pages · Partner
    // Pipeline`. It cost the same thing both times: five zones with no header
    // row and a sentence explaining why they did not need one.
    canvasDirs: ['design/incoming', 'design/canvases/integrated'],
    canvas: /^(Pages · Advisor |Advisor Detail · Practice)/,
    // PR5 is a POINTER in the Practice canvas — "drawn in full as D4" — so its
    // ops come from the backlog file, by route rather than by directory. See
    // the `alsoZones` block in `canvasOps` for why the whole file is not swept.
    alsoZones: [['practice/earnings', 'design/canvases/backlog/Detail Layer Canvas II.dc.html']],
    buckets: /^(expertise|network|research|practice)\//,
    // 15 zones and 14 exports as of canvas PR4, and THIS IS THE FIRST TIME THE
    // TWO HAVE MOVED APART. PR1, PR2 and PR3 each drew exactly two ops, one of
    // them an export, so the counts rose together. PR4 draws two ops and
    // NEITHER is an export: `Export to calendar` is an .ics file, which the
    // builder's export kind cannot produce — that kind emits the CSV every
    // other zone wants, through `exportView`. Labelling it `export` would have
    // handed the advisor a spreadsheet under a calendar's name, so it is a
    // page-supplied handler and the export count stays where it was.
    // 16 zones and 14 exports as of canvas D4. PR5's Earnings adds the
    // sixteenth and NEITHER of its two ops is an export, for the same reason
    // PR4's were not: `Export CSV` writes a per-client ledger with a total
    // row, and `Download 1099 summary` is a different SPAN entirely — a tax
    // year, fetched from its own endpoint — so neither is the rows-on-screen
    // dump `exportView` produces. Was 15/14 at PR4.
    zones: 16,
    links: 1,
    exports: 14,
    // FIVE PAGE-SUPPLIED OPS, AND THE FIFTH IS THE FIRST ONE THIS PROFILE DID
    // NOT SHARE WITH PARTNER. Four of them are `AskZone` and `LibraryZone`,
    // which are each one file serving both licences. The fifth is Delivery's
    // `Bulk: nudge unopened` — an advisor→client send, which exists here and
    // nowhere else because migration 239 refuses to send a work product to a
    // client with no account, so every row that could be unopened is
    // addressable. Was 0, then 4.
    //
    // SEVEN NOW, because PR4's Sessions brings two at once — `Block a date
    // range`, which withdraws hours nobody has taken and reports back the
    // booked ones it refused to touch, and `Export to calendar`, which builds
    // an .ics in the browser from rows already on screen. Was 0, then 4,
    // then 5.
    // NINE NOW, because D4's Earnings brings two more — `Export CSV`, built
    // in the browser from the table already on screen, and `Download 1099
    // summary`, which fetches its own year rather than deriving one from the
    // reader's chosen window. Was 0, then 4, then 5, then 7.
    handlers: 9,
    embeddedGuards: 0,
    // Both remaining exclusions are cards whose whole page IS the gap
    // statement, so there is nothing for a row to sit over. `expertise/
    // visibility` is the one card left in AdvisorBucketRoutes' COPY ("Nothing
    // counts profile views"); `OrganizationsZone.jsx` is a dashed card and
    // nothing else, because an advisor is 403'd from `/api/contacts` and no
    // other store carries a person-to-organisation edge. Listed here so each
    // exclusion is checked rather than silent.
    //
    // `research/client-prep` was listed here too, on the same reasoning, and
    // was the one case where it had stopped being true: the zone got a real
    // body with the advisor grant, and the exclusion kept three specified ops
    // off a page that was already asking for them.
    //
    //
    // THE REMAINING PRACTICE ZONES are deferrals rather than refusals: the
    // canvas specifies ops for each, and each leaves this list as its artboard
    // lands (task #151, one PR per artboard). They are listed so the gap is
    // counted rather than invisible — which is the whole point of this key,
    // and what the unreadable canvas was denying it.
    //
    // `practice/opportunities` LEFT ON PR1, the first to do so, which is the
    // list working as intended: four became three because an artboard landed,
    // not because anyone edited the count. `practice/engagements` LEFT ON PR2
    // the same way, and three became two. `practice/delivery` LEFT ON PR3, and
    // two became one — the last Practice deferral is Sessions.
    //
    // `practice/earnings` IS NOT AMONG THEM, and the canvas says why in its own
    // words: PR5 "is drawn at full fidelity on the system canvas as D4 … listed
    // here so the Practice set reads as complete rather than as four of five".
    // It carries no crumb and no ops, so this profile's canvas set does not
    // specify it, and listing it here would claim a deferral against an
    // artboard that is not there. The first draft of this list did exactly
    // that and this guard caught it.
    // `practice/sessions` LEFT ON PR4, and one became none: every Practice
    // zone the canvas specifies ops for now has them. What remains excluded is
    // the two whose whole page IS the gap statement.
    excluded: [
      'expertise/visibility', 'network/organizations',
    ],
    live: (route) => route.replace(/^\//, ''),
  },
};

/**
 * The zone → labels map, read out of a profile's own literal.
 *
 * `canvas:` WINS OVER `label:` WHERE BOTH ARE PRESENT, because this map is
 * compared against the artboards: what it must yield is the string the CANVAS
 * drew, not the string the product renders. They are the same for all but one
 * entry across four profiles — `/validate/interviews` renders "Export
 * interviews" where the canvas says "Export transcripts", because the CSV has
 * no transcript column to give. The filters table has carried this split since
 * it was written; without it here an op can only be labelled dishonestly or
 * dropped, and dropping it would tell this guard the canvas never drew it.
 */
function tableLabels(src) {
  const start = src.search(/export const [A-Z_]+_ZONE_ACTIONS/);
  const body = src.slice(start, src.indexOf('\n};', start));
  const out = {};
  let zone = null;
  for (const line of body.split('\n')) {
    const z = line.match(/^ {2}'([a-z-]+\/[a-z-]+)':/);
    if (z) { zone = z[1]; out[zone] = []; continue; }
    const l = line.match(/^ {4}\{ (?:canvas: '([^']+)', )?label: '([^']+)'/);
    if (l && zone) out[zone].push(l[1] ?? l[2]);
  }
  return out;
}

/**
 * A canvas declares its artboards in one of THREE shapes, and this reader
 * understands all three.
 *
 * SHAPE A — a `PAGES` array. `route:'/offers/catalog'` … `ops:['New service',…]`.
 * Research, Offers, Expertise, Delivery and every canvas this file has ever
 * read use it, and until now it was the only shape it knew.
 *
 * SHAPE B — `sc-` markup. `Pages · Partner Pipeline` carries NO `route:` and NO
 * `ops:` anywhere. Its artboards are:
 *
 *     <div class="crumb"><span …>Pipeline</span><span>‹</span><span …>Leads</span></div>
 *     …
 *     <span class="vm" style="cursor:pointer">Edit capability weights</span>
 *
 * — the crumb naming the bucket and the zone, and each op carrying `class="vm"`
 * inside its own artboard's segment.
 *
 * SHAPE C — one templated artboard looped over a `boards` array in the canvas's
 * own `<script type="text/x-dc">` block. `Pages · Founder Validate` is the only
 * one, and it is the reason the emptiness assert below exists. Its markup holds
 * a single crumb reading `{{ b.zone }}` and a single op reading `{{ t }}`, so
 * shape B "parsed" it into one artboard named `/validate/{{-b.zone-}}` carrying
 * the op `{{ t }}` — junk that satisfied every count and was then dropped by
 * founder's bucket filter, which is why nobody noticed. Its real routes and ops
 * are in the data: `sub:'violet · /validate/interviews'` and
 * `tools:['Log an interview','Export transcripts']`, four boards of each.
 *
 * WHY THIS MATTERS MORE THAN A PARSER DETAIL. `partnerZoneActions.js` carried a
 * paragraph asserting that "`Pages · Partner Pipeline` specifies NO zone-header
 * actions", and the profile below repeated it. Both were reasoning from THIS
 * reader's blind spot rather than from the canvas: the file in
 * `design/canvases/integrated/` has carried all seven ops — `Edit capability
 * weights`, `Bulk: nudge unopened`, `Export win/loss CSV`, `WIP limit: 5 per
 * stage`, `Export MRR schedule`, `Export chart`, `Save benchmark` — the whole
 * time, byte-identical to the newer export in `design/incoming/`. A guard that
 * cannot read a canvas reported that the canvas was empty, and five zones went
 * without a header row on the strength of it.
 *
 * The three shapes cannot be confused: A has `route:'…'`; C has a `boards: [`
 * array and no `route:`; B has neither and is the `class="vm"` markup.
 */
function artboardOps(src) {
  const out = {};
  // Shape A.
  if (/route:\s*'/.test(src)) {
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const ops = chunk.match(/ops:\s*\[([^\]]*)\]/);
      if (!ops) continue;
      out[route] = [...ops[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
    return literal(out);
  }
  // Shape C. Each board carries its own route inside `sub:` and its own ops in
  // `tools:`, so the pair is read per board object rather than by zipping two
  // whole-file matches — a board that gains a `sub` and no `tools` must drop
  // out, not shift every later board's ops onto the wrong route.
  const boardsAt = src.search(/\bboards:\s*\[/);
  if (boardsAt >= 0) {
    for (const board of src.slice(boardsAt).split(/\{ id:\s*'/).slice(1)) {
      const route = board.match(/sub:\s*'[^']*?(\/[a-z0-9/-]+)'/);
      const tools = board.match(/tools:\s*\[([^\]]*)\]/);
      if (!route || !tools) continue;
      out[route[1]] = [...tools[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
    return literal(out);
  }
  // Shape B. The route comes from the crumb rather than a hardcoded map, so a
  // canvas for another bucket parses without this reader learning its names.
  const slug = (s) => s.trim().toLowerCase().replace(/\s+/g, '-');
  const crumbs = [...src.matchAll(
    /<div class="crumb">\s*<span[^>]*>([^<]+)<\/span>\s*<span[^>]*>[^<]*<\/span>\s*<span[^>]*>([^<]+)<\/span>/g,
  )];
  for (let i = 0; i < crumbs.length; i += 1) {
    // Bounded at the NEXT crumb, so an op can never be read into the artboard
    // above or below its own.
    const from = crumbs[i].index;
    const to = i + 1 < crumbs.length ? crumbs[i + 1].index : src.length;
    const segment = src.slice(from, to);
    // TWO CLASSES, AND THE SECOND ONE COST FIVE ZONES. `Pages · Partner
    // Pipeline` marks its ops `class="vm"`; `Advisor Detail · Practice` marks
    // all eight of its own `class="bulk"`. This selector knew only the first,
    // so it read the Practice canvas as eight artboards with no header
    // actions — and the advisor profile below carried a comment asserting
    // exactly that, in the same words this file's own shape-B docblock uses to
    // describe the Partner Pipeline mistake. Same failure, same file, a
    // different canvas: a guard that cannot read a canvas reports it empty,
    // and the reader believes the guard.
    out[`/${slug(crumbs[i][1])}/${slug(crumbs[i][2])}`] =
      [...segment.matchAll(/class="(?:vm|bulk)"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
  }
  return literal(out);
}

/**
 * Nothing a shape reader emits may be an unexpanded `{{ … }}` binding.
 *
 * This is the second half of the emptiness assert, and it is the half that had
 * something to catch: a canvas read in the WRONG shape does not usually come
 * back empty, it comes back full of the template's own placeholders. Shape C
 * exists because shape B did exactly that to `Pages · Founder Validate` — a
 * route and an op that were both bindings, counted as a parsed artboard. An
 * emptiness check alone would have passed it.
 */
function literal(out) {
  for (const [route, ops] of Object.entries(out)) {
    for (const text of [route, ...ops]) {
      assert.ok(!text.includes('{{'),
        `"${text}" is an unexpanded template binding, not a route or an op — ` +
        'this canvas was read in the wrong shape');
    }
  }
  return out;
}

/** Every matching artboard's `route` and its `ops` array, from the canvases. */
/**
 * One artboard's HEADER OPS, read from the row that holds its view chips.
 *
 * A FOURTH MARKER, AND DELIBERATELY NOT ADDED TO SHAPE B. The shape-B reader
 * above knows `class="vm"` and `class="bulk"`, and its own docblock records
 * what each cost when it did not. `Detail Layer Canvas II` marks its ops with
 * neither: they are inline-styled spans carrying `cursor:pointer`.
 *
 * That marker is NOT safe to add to shape B. `cursor:pointer` appears on
 * ROW-level actions too — "Accept", "Pass", "Open thread" in that same file,
 * and across a dozen integrated canvases — so a global widening would read a
 * per-row button as a header op on zones that are currently correct. It would
 * be the same mistake as the three before it, made in the other direction.
 *
 * So the marker is scoped twice over: to a named zone (`alsoZones`), and
 * within that artboard to the one row that also holds the view chips, which
 * is where every canvas in this repo puts its header ops. A `sc-for` over a
 * `…Views` list is what identifies that row, and the ops are the clickable
 * spans beside it.
 */
function headerOps(src, zone) {
  const slug = (s) => s.trim().toLowerCase().replace(/\s+/g, '-');
  const crumbs = [...src.matchAll(
    /<div class="crumb">\s*<span[^>]*>([^<]+)<\/span>\s*<span[^>]*>[^<]*<\/span>\s*<span[^>]*>([^<]+)<\/span>/g,
  )];
  // EVERY MATCHING CRUMB, NOT THE FIRST. This file names `practice/earnings`
  // TWICE — once in the compressed-versus-full comparison strip at the top of
  // the artboard, and once in the artboard's own frame. Taking the first hit
  // read the comparison strip, which has no ops row, and reported the zone as
  // drawing none. Scanning them all and keeping the first that actually
  // yields ops is what makes the reader indifferent to that ordering.
  for (let i = 0; i < crumbs.length; i += 1) {
    if (`${slug(crumbs[i][1])}/${slug(crumbs[i][2])}` !== zone) continue;
    const from = crumbs[i].index;
    const to = i + 1 < crumbs.length ? crumbs[i + 1].index : src.length;
    const segment = src.slice(from, to);
    // The ops row is the one the view chips are in. Bounded to that single
    // `<div>` so a clickable span further down the artboard — a row action, a
    // link in a card — cannot be read as a header op.
    const chips = segment.search(/<sc-for list="\{\{ \w+ \}\}" as="v"/);
    if (chips < 0) continue;
    const rowEnd = segment.indexOf('</div>', chips);
    const row = segment.slice(chips, rowEnd < 0 ? segment.length : rowEnd);
    const ops = [...row.matchAll(/cursor:pointer[^>]*>([^<]+)</g)]
      .map((m) => m[1].trim())
      .filter((t) => t && !t.includes('{{'));
    if (ops.length) return ops;
  }
  return [];
}

function canvasOps(profile) {
  const out = {};
  let routes = 0;
  for (const dir of profile.canvasDirs || ['design/canvases/integrated']) {
    const files = readdirSync(resolve(root, dir)).filter((f) => profile.canvas.test(f));
    for (const f of files) {
      const found = artboardOps(read(`${dir}/${f}`));
      // PER FILE, AND COUNTING ROUTES RATHER THAN FILES. The old assertion was
      // `seen += files.length` — a canvas whose NAME matched but which yielded
      // nothing left `seen` truthy and quietly shrank the covered set, which is
      // exactly how a shape this reader could not parse passed for an empty
      // one. A canvas that stops parsing now breaks the build.
      //
      // This is one of two ways a canvas fails to be read, and on its own it is
      // the weaker one. The other — a canvas read in the WRONG shape, coming
      // back full of the template's own `{{ … }}` bindings — is refused inside
      // `literal()`, because it is not empty and this assert would wave it
      // through. Both are exercised directly at the foot of this file.
      assert.ok(Object.keys(found).length,
        `${dir}/${f} matched ${profile.canvas} and yielded no artboard — ` +
        'it is in none of the three known shapes, or one of them has changed');
      // THE THIRD WAY A CANVAS FAILS TO BE READ, and the one that actually
      // happened. A shape-B canvas whose op class this reader does not know
      // parses into real routes carrying EMPTY op arrays: not empty, not full
      // of bindings, so neither assert above nor `literal()` says a word. That
      // is how `Advisor Detail · Practice` read as four artboards with no
      // header actions for as long as it has existed, and how the profile
      // below came to assert in a comment that it had none.
      //
      // A whole file yielding zero ops across every one of its artboards means
      // the selector missed, not that eight designed controls are absent. A
      // canvas that genuinely specifies none can have this revisited — with
      // the canvas quoted, which is what was missing last time.
      assert.ok(Object.values(found).some((ops) => ops.length),
        `${dir}/${f} parsed into ${Object.keys(found).length} artboard(s) and not one op — ` +
        'the shape was recognised but its ops were not; check the op class this canvas marks');
      for (const [route, ops] of Object.entries(found)) out[profile.live(route)] = ops;
      routes += Object.keys(found).length;
    }
  }

  // ONE ARTBOARD FROM A FILE THIS SCAN DOES NOT OPEN, NAMED ROUTE BY ROUTE.
  //
  // `/practice/earnings` is the case, and it is not an oversight in the
  // Practice canvas: that canvas draws PR5 as a POINTER — "drawn in full as
  // D4" — and D4 lives in `design/canvases/backlog/Detail Layer Canvas II`.
  // So the zone has an artboard, it is simply in a file the directory scan
  // above is right not to sweep: that file also holds D5–D8 for cohorts,
  // partner delivery and partner pipeline, and pulling the whole thing in
  // would hand this profile artboards it does not own and give
  // `expertise/proof` two competing sources.
  //
  // Hence route-by-route rather than by directory. The backlog canvas stays
  // in `backlog/` — reading it for intent is not promoting it — and an entry
  // here is a claim that THIS zone's ops come from THAT artboard, checkable
  // because a route the file does not contain fails immediately.
  for (const [zone, file] of profile.alsoZones || []) {
    const ops = headerOps(read(file), zone);
    assert.ok(ops.length, `${file}'s ${zone} artboard parsed with no ops`);
    out[zone] = ops;
    routes += 1;
  }

  assert.ok(routes, `no canvases matched ${profile.canvas}`);
  return out;
}

/**
 * One builder call, from its name through its own closing paren.
 *
 * REPLACES A TERMINATOR THAT ASSUMED ONE SHAPE. This used to be
 * `src.slice(at, src.indexOf('})}', at) + 3)` — the end of a call sitting
 * directly inside a JSX prop. Nine partner zones now HOIST the call to a
 * `const` above the branch that renders the gap card, so the row survives an
 * account with no firm attached, and `})}` then landed somewhere in the next
 * statement: the extractor below read an `if` as a name the page had failed to
 * declare. Balancing the call's own parens reads both shapes and stops
 * depending on what follows the call at all.
 *
 * Quoted spans are skipped, because a heading is allowed to contain a paren —
 * `'Price (USD)'` in the catalog export is exactly that, and a naive count
 * closes the call in the middle of a string.
 */
function callText(src, at) {
  const open = src.indexOf('(', at);
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced builder call at ${at}`);
}

/** The inside of `[ … ]` starting at index 0, brackets balanced. */
function balanced(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if ('([{'.includes(text[i])) depth += 1;
    else if (')]}'.includes(text[i])) {
      depth -= 1;
      if (depth === 0) return text.slice(1, i);
    }
  }
  throw new Error('unbalanced cells array');
}

/** Every `.jsx` under a profile's subtrees, plus any file it names outright. */
function pageFiles(profile) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(resolve(root, rel))) {
      const next = `${rel}/${entry}`;
      if (statSync(resolve(root, next)).isDirectory()) walk(next);
      else if (entry.endsWith('.jsx')) out.push(next);
    }
  };
  for (const dir of profile.pages) walk(dir);
  for (const f of profile.extra || []) out.push(f);
  return out;
}

for (const [name, profile] of Object.entries(PROFILES)) {
  const SRC = read(profile.table);

  test(`${name}: every zone lists exactly the canvas's actions, in the canvas's order`, () => {
    const table = tableLabels(SRC);
    const canvas = canvasOps(profile);
    assert.equal(Object.keys(table).length, profile.zones);
    for (const [zone, labels] of Object.entries(table)) {
      assert.ok(canvas[zone], `${zone} has no artboard — where did its labels come from?`);
      // Order matters: the canvas puts the destructive or configuring action
      // last, and re-ordering them here would quietly re-rank them on screen.
      assert.deepEqual(labels, canvas[zone], `${zone} does not match its artboard's ops`);
    }
    // And nothing in a canvas for one of this profile's own buckets was skipped.
    // An excluded zone is one the canvas specifies and this table deliberately
    // does not carry. Checking the set exactly means an exclusion cannot grow
    // by accident — a new unbacked zone fails here rather than vanishing.
    const excluded = profile.excluded || [];
    const specified = Object.keys(canvas)
      .filter((r) => profile.buckets.test(r))
      .filter((r) => !excluded.includes(r));
    assert.deepEqual(specified.sort(), Object.keys(table).sort(),
      'an artboard specifies actions for a zone this table does not cover');
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!table[skip], `${skip} is both excluded and declared`);
      // AND IT MUST BE A ZONE THIS PROFILE ACTUALLY COVERS. `specified` is
      // filtered by `buckets` before the exact-set comparison, so an exclusion
      // outside them is checked against nothing: narrowing `buckets` would
      // silently retire every deferral it drops, and the exact-set assertion
      // would still pass. Mutation-checking found this by removing `practice`
      // from the advisor profile's buckets — four recorded deferrals became
      // unenforced and no assertion moved.
      assert.ok(profile.buckets.test(skip),
        `${skip} is excluded but sits outside this profile's buckets, so nothing enforces it`);
    }
  });

  test(`${name}: every link is a route this licence is allowed to open`, () => {
    const links = [...SRC.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    // The count is pinned because a working action quietly downgraded to a
    // note is the regression this whole pass exists against, and it would
    // otherwise pass every other assertion in this file.
    assert.equal(links.length, profile.links,
      `${name} declares ${links.length} linked actions, expected ${profile.links}`);
    // COUNTED OVER THE CODE, NOT THE PROSE. A table's docblock explains the
    // kinds it uses, so `kind: 'handler'` appears in `founderZoneActions.js`
    // once as a sentence about the vocabulary and six times as a declaration —
    // and this read seven. That is the case `_codeOnly.mjs` was written for.
    const CODE = codeOnly(SRC);
    assert.equal((CODE.match(/kind: 'export'/g) || []).length, profile.exports,
      `${name} declares a different number of exports than it did`);
    assert.equal((CODE.match(/kind: 'handler'/g) || []).length, profile.handlers,
      `${name} declares a different number of page-supplied ops than it did`);
    for (const link of new Set(links)) {
      const path = link.split('?')[0];
      const i = APP.indexOf(`path="${path}"`);
      assert.ok(i > 0, `${path} is not a route App.jsx mounts`);
      // The guard is the first `[...]` after the path — either a bare array or
      // one wrapped in labRoles(...), which only ever ADDS the caller's own role.
      const decl = APP.slice(i, i + 400);
      // `authOnly(…)` is the one legitimate alternative to `guard([…])`: it
      // gates on being signed in and on nothing else, so it is MORE permissive
      // than any role list and every licence may open it. `/articles/draft`,
      // where an advisor writes a new piece, is mounted that way.
      if (/authOnly\(/.test(decl.slice(0, decl.indexOf('/>') + 2))) continue;
      const roles = decl.match(/guard\((?:labRoles\()?\[([^\]]*)\]/);
      assert.ok(roles, `${path} goes through neither guard() nor authOnly()`);
      assert.match(roles[1], new RegExp(`'${name}'`), `${path} is mounted, but not for a ${name}`);
    }
  });

  test(`${name}: an unbuilt reason never points at a path, because it is not checked`, () => {
    // Every `to` in this table is verified against the router by the test above.
    // An `unbuilt` reason is prose and nothing verifies it, so one that says "go
    // to /matches" is an unchecked link wearing a sentence. It now renders
    // NOWHERE — the builder drops the entry — which makes an unchecked path in
    // it worse, not better: a reader of this file would act on a route that may
    // not exist, and no rendering would ever contradict them.
    const notes = [...SRC.matchAll(/^ {4}\{ (?:canvas: '[^']+', )?label: '[^']+', unbuilt: '([^']*)'/gm)].map((m) => m[1]);
    // Exact rather than a floor: every action is a link, an export, a
    // page-supplied handler or a gap, and nothing is untyped. An entry that is
    // none of the four would render as a dead button — which is the one thing
    // this whole pass forbids. `handlers` joined this sum when Validate's ops
    // came into the table; before that, a fourth kind could have been added and
    // every count here would still have balanced by coincidence.
    const actions = [...SRC.matchAll(/^ {4}\{ (?:canvas: '[^']+', )?label: '/gm)].length;
    assert.equal(profile.links + profile.exports + profile.handlers + notes.length, actions,
      `${name} has ${actions} actions but ${profile.links} links, ${profile.exports} exports, `
      + `${profile.handlers} page-supplied and ${notes.length} gaps`);
    for (const note of notes) {
      assert.doesNotMatch(note, /(^|\s)\/[a-z]/, `an unbuilt reason carries an unchecked path: "${note}"`);
    }
  });

  test(`${name}: no action is given both a destination and an excuse`, () => {
    // The builder prefers `to`, so an `unbuilt` reason beside it would never be
    // read, and the entry would claim to be both built and not. `linkNote` is
    // the deliberate way to qualify a link, and it renders as the title.
    const entries = [...SRC.matchAll(/^ {4}\{ (?:canvas: '[^']+', )?label: '[^']+',([^\n]*)$/gm)].map((m) => m[1]);
    assert.ok(entries.length >= profile.zones * 2, `expected every action, found ${entries.length}`);
    for (const rest of entries) {
      assert.ok(!(/\bto: /.test(rest) && /\bunbuilt: /.test(rest)),
        `an action declares both a destination and a gap: ${rest.trim()}`);
    }
  });

  test(`${name}: a zone row names only variables its page actually has`, () => {
    // `scope: project?.name` on a page with no `project` is a ReferenceError
    // that blanks the whole route at render — and it is NOT a build error:
    // esbuild bundles it happily, and this repo has no lint step to catch it.
    // It shipped into one of the founder pages and only a browser found it.
    const KNOWN = new Set(['true', 'false', 'null', 'undefined', 'Number', 'String',
      'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Date', profile.call,
      // OPERATORS ARE NOT VARIABLES. `typeof d.days === 'number'` in an export
      // cell read as a global named `typeof` and failed a page that is
      // correct — the identifier scan cannot tell a keyword from a name, so
      // the keywords that can legally appear in an expression are listed. A
      // false alarm here is worse than a gap: it is the thing that gets a
      // guard weakened instead of fixed.
      'typeof', 'instanceof', 'in', 'new', 'void', 'delete', 'await']);
    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = read(f);
      let at = src.indexOf(`${profile.call}('`);
      while (at >= 0) {
        const call = callText(src, at);
        const bare = call
          // A template literal is text plus real expressions: keep the `${…}`
          // bodies, drop the rest, or `?project_id=${id}` contributes a bare `$`.
          .replace(/`([^`]*)`/g, (_m, inner) => [...inner.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' '))
          .replace(/'[^']*'/g, "''")               // string literals
          .replace(/\b[A-Za-z_$][\w$]*\s*:/g, '')  // object keys
          .replace(/\.[A-Za-z_$][\w$]*/g, '');     // property access
        // An arrow's own parameter is declared right there — `cells: (r) =>
        // [r.x]` leaves a bare `r` once the property is stripped.
        // Including an ENCLOSING arrow's parameter: the partner bucket router
        // hands these pages `(rows) => partnerZoneActions(…)`, so `rows` is
        // declared just before the call rather than inside it.
        //
        // EVERY PARAMETER, NOT THE FIRST. This read one name per arrow, which
        // was right while every render prop took only its rows. A zone with a
        // page-supplied op takes `(rows, handlers) =>` — the shape D67
        // introduced and three workspaces now use — and a one-name pattern
        // matches neither of them, so `handlers` read as an undeclared global
        // on a page that declares it in the very arrow being scanned.
        const around = src.slice(Math.max(0, at - 160), at) + call;
        const params = new Set(
          [...around.matchAll(/\(\s*([A-Za-z_$][\w$,\s]*)\)\s*=>/g)]
            .flatMap((m) => m[1].split(',').map((x) => x.trim()))
            .filter(Boolean),
        );
        // MULTI-LINE IMPORTS COUNT AS DECLARATIONS, AND THEY DID NOT.
        // The single-line regex below cannot cross a newline, so a name bound
        // by a wrapped `import { A,\n  B } from '…'` read as an undeclared
        // global — a false positive on code that is correct, which is the
        // failure mode that makes a guard get loosened rather than trusted.
        // Every binding inside an import's braces is collected first; a name
        // found there IS declared, so this only ever removes false alarms.
        const imported = new Set(
          [...src.matchAll(/import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from/g)]
            .flatMap((m) => m[1].split(','))
            .map((x) => x.trim().split(/\s+as\s+/).pop().trim())
            .filter(Boolean),
        );
        for (const id of new Set([...bare.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))) {
          if (KNOWN.has(id) || params.has(id) || imported.has(id)) continue;
          const declared = new RegExp(`(const|let|var|function|import)[^\\n;]*\\b${id}\\b`).test(src);
          assert.ok(declared, `${f} passes \`${id}\` to its zone row, and never declares it`);
          checked += 1;
        }
        at = src.indexOf(`${profile.call}('`, at + 1);
      }
    }
    // A floor, only so a broken extractor returning nothing cannot pass. The
    // real assertion is the one inside the loop; the number of DISTINCT names a
    // profile references is not a fact worth pinning (partner's ten zones name
    // eight between them, because most of them call their list `items`).
    assert.ok(checked >= 2, `the name extractor found almost nothing: ${checked}`);
  });

  test(`${name}: a zone row is never sealed inside a header that does not render`, () => {
    // The Network zones mount only through NetworkWorkspace, which passes
    // `embedded` — so their own `{!embedded && <header>…}` block is dead on the
    // route the reader opens. Rows placed inside rendered nowhere on three
    // founder pages, and every source assertion still passed.
    //
    // Read through `codeOnly`, and check EVERY guard rather than the first: the
    // comment explaining this rule quotes `{!embedded &&` itself, and a file
    // can carry more than one guarded block. Both bit this assertion.
    // BOTH COMPONENTS, because a file used to stop being checked the moment it
    // migrated. `ZoneToolbar` is `ZoneActions` plus the filters half and the
    // canvas's rule — it renders `<ZoneActions>` internally — so a row sealed
    // inside a dead `{!embedded && <header>}` is exactly as invisible either
    // way. The old `if (!src.includes('<ZoneActions')) continue;` skipped the
    // whole file, which meant converting a page silently dropped it out of
    // `guarded` and could take the count under `embeddedGuards` — or worse,
    // leave a genuinely sealed row unchecked while the count was still met by
    // other files.
    const ROW = /<Zone(Actions|Toolbar)\b/;
    let guarded = 0;
    for (const f of pageFiles(profile)) {
      const src = codeOnly(read(f));
      if (!ROW.test(src)) continue;
      for (const m of src.matchAll(/\{!embedded &&/g)) {
        const close = src.indexOf('</header>}', m.index);
        if (close < 0) continue;
        guarded += 1;
        assert.ok(!ROW.test(src.slice(m.index, close)),
          `${f} hides its actions behind !embedded, on a route that is always embedded`);
      }
    }
    assert.ok(guarded >= profile.embeddedGuards,
      `${name} checked ${guarded} embedded-guarded blocks, expected at least ${profile.embeddedGuards}`);
  });

  test(`${name}: a zone the account cannot read still draws its header row`, () => {
    /**
     * THE STATE MOST READERS ARE IN, AND THE ONE THE ROW USED TO SKIP.
     *
     * `requirePartnerProfile` resolves a caller only through
     * `users.partner_id`, and `ensureRoleProfile` backfills that column for
     * `role = 'partner'` alone — so every ADMIN reading this workspace, which
     * includes anyone checking whether a design was built, gets
     * `No partner profile attached to your account` on every zone. All nine
     * partner zone bodies used to `return` a heading and the gap card there and
     * nothing else, so the canvas's actions shipped and then rendered nowhere
     * the reviewer looked. Measured on production the same day: 18 of 26
     * partner accounts resolve to nothing, and no admin account ever resolves.
     *
     * `ZoneBody` has argued the general form of this since it was written — "a
     * zone's header row is as true while the store is loading, or failed, or
     * empty, as it is when rows are on screen". This was the one state carved
     * out of that rule, and it was the state that mattered most.
     *
     * ACTIONS AND NOT FILTERS, asserted in both directions below. An export
     * with nothing loaded already renders disabled and says so; a filter chip
     * is a claim about ROWS, and drawing a selectable one over a store this
     * account cannot read is the "an empty set reads as an answer" failure
     * `zoneFilterBuilder.js` exists to prevent, reached from a new direction.
     */
    const kit = codeOnly(read('frontend/src/pages/partner/kit.jsx'));
    if (!kit.includes('export function UnlinkedZone')) {
      assert.fail('partner/kit.jsx no longer exports UnlinkedZone');
    }
    const helper = kit.slice(kit.indexOf('export function UnlinkedZone'));
    assert.match(helper, /<ZoneActions[^>]*items=\{actions\}/,
      'UnlinkedZone stopped drawing the zone\'s actions above the gap card');
    assert.doesNotMatch(helper, /ZoneToolbar|filters=/,
      'UnlinkedZone draws a filter over rows this account cannot read');

    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = codeOnly(read(f));
      // The CALL, not the import and not the definition — exactly the files
      // that take this branch.
      if (!src.includes('isNoPartnerProfile(state.error)')) continue;
      checked += 1;
      assert.match(src, /<UnlinkedZone[\s\S]{0,120}?actions=\{/,
        `${f} takes the no-firm branch without handing over its header row`);
      assert.doesNotMatch(src, /<NoPartnerProfile\s*\/>/,
        `${f} renders the gap card directly again, which drops the row above it`);
    }
    // A floor rather than an exact count: the per-file assertion above is the
    // real one and runs on a tenth zone the day it appears. This only stops a
    // needle that has stopped matching from passing as "nothing to check".
    if (profile.gateBranches) {
      assert.ok(checked >= profile.gateBranches,
        `${name} checked ${checked} no-firm branches, expected at least ${profile.gateBranches}`);
    }
  });

  test(`${name}: every zone is mounted, exactly once`, () => {
    const table = tableLabels(SRC);
    const seen = new Map();
    const sharedSites = [];
    for (const f of pageFiles(profile)) {
      const src = read(f);
      // Two mount shapes. A profile's own page calls its own builder; a SHARED
      // surface — `/network/*`, `/research/*` — calls `zoneActionsFor(role, …)`
      // and serves four licences from one call site. A shared site counts as a
      // mount for every profile whose table declares that zone, and for none
      // that does not: `research/companies` exists for a founder and an advisor
      // and not for an investor, from the same line of code.
      const own = [...src.matchAll(new RegExp(`${profile.call}\\('([^']+)'`, 'g'))];
      for (const m of src.matchAll(/zoneActionsFor\([^,]+,\s*'([^']+)'/g)) {
        if (table[m[1]]) sharedSites.push([m[1], f, src, m.index]);
      }
      for (const m of own) {
        assert.ok(table[m[1]], `${f} names a zone the table does not declare: ${m[1]}`);
        assert.ok(!seen.has(m[1]), `${m[1]} is mounted by ${seen.get(m[1])} and ${f}`);
        // CALLING the builder is not mounting it. Renaming the prop from
        // `actions=` to anything else leaves the call in the file and the row
        // off the screen, and every other assertion here still passes — so the
        // call has to reach a prop something actually renders.
        //
        // TWO SHAPES REACH ONE, AND THE SECOND IS NEW. A call may sit directly
        // inside the prop, or be HOISTED to a `const` first — which the nine
        // partner zones now do, because the same row has to be drawn in two
        // places: over the loaded body, and over the card shown when the
        // account is attached to no firm. Naming it once is what stops those
        // two rows drifting apart. The hoist is only accepted when the name is
        // then handed to a rendered prop, so it buys no exemption: a `const`
        // nothing mounts fails here exactly as an unmounted call did.
        //
        // THE GAP BRANCH MAY NOT VOUCH FOR THE LIVE ONE. `<UnlinkedZone
        // actions={rowActions} />` also spells `actions={…}`, so searching the
        // whole file let a row that renders ONLY over the no-firm card pass as
        // mounted — the zone would draw its header for an unattached account
        // and for nobody else, which is the original defect inverted. Found by
        // mutation: deleting the live mount left this assertion green. The
        // `UnlinkedZone` elements are removed before the search; the branch has
        // its own assertion above.
        const before = src.slice(Math.max(0, m.index - 220), m.index);
        const live = src.replace(/<UnlinkedZone[\s\S]*?\/>/g, '');
        const inProp = /(?:^|\s)(?:actions|items|zoneActions)=\{[^}]*$/.test(before);
        const hoisted = before.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
        const handed = hoisted
          && new RegExp(`(?:actions|items|zoneActions)=\\{${hoisted[1]}[\\s}]`).test(live);
        assert.ok(inProp || handed,
          `${f} calls the builder for ${m[1]} but does not hand the result to anything`);
        seen.set(m[1], f);
      }
    }
    // A shared site is the FALLBACK, not a second mount. `NetworkWorkspace`
    // routes a founder to their own page, an investor to theirs, an advisor to
    // theirs, and everyone else to the shared `NetworkPage` — so per profile
    // exactly one of the two shapes is live, and a profile with its own page
    // for a zone is already accounted for.
    for (const [key, f, src, at] of sharedSites) {
      if (seen.has(key)) continue;
      // The call's result has to flow into a prop something renders. An arrow
      // and a ternary are both legitimate shapes between the two, so this looks
      // for a prop-open that is still UNCLOSED at the call rather than for an
      // exact spelling: `zoneActions={(kind, rows) => kind === 'x' ? call(…)`
      // is fine, and `data-x={(rows) => call(…)` is not.
      // No fixed window: the two branches of a ternary can be far apart, and the
      // second one failed a 320-character one on correct code.
      const before = src.slice(0, at);
      const opens = [...before.matchAll(/\b(?:actions|items|zoneActions)=\{/g)];
      const open = opens.length ? opens[opens.length - 1] : null;
      // Braces are BALANCED, not counted: a `{` and a `}` tally that merely
      // comes out even lets an earlier, closed prop vouch for a later broken
      // one. Walk from just past the prop's own `{` and require the depth to
      // still be inside it when the call is reached.
      let depth = open ? 1 : 0;
      if (open) {
        for (let n = open.index + open[0].length; n < at && depth > 0; n += 1) {
          if (before[n] === '{') depth += 1;
          else if (before[n] === '}') depth -= 1;
        }
      }
      assert.ok(open && depth > 0,
        `${f} calls the builder for ${key} but does not hand the result to anything`);
      seen.set(key, f);
    }
    assert.equal(seen.size, profile.zones,
      `${profile.zones} zones declared, ${seen.size} mounted`);
  });

  test(`${name}: an export names the columns it writes, and fills every one`, () => {
    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = read(f);
      if (!src.includes(`${profile.call}(`) && !src.includes('zoneActionsFor(')) continue;
      for (const header of src.matchAll(/header: \[([^\]]*)\]/g)) {
        const after = src.slice(header.index);
        const open = after.search(/cells: \([a-z]+\) => \[/);
        assert.ok(open >= 0, `${f} declares export columns but no row mapping`);
        const body = balanced(after.slice(after.indexOf('[', open)));
        const cols = [...header[1].matchAll(/'/g)].length / 2;
        // A TRAILING COMMA IS NOT AN EIGHTH VALUE. `[a, b,]` has two elements
        // in JavaScript and this counted three, so a multi-line `cells` array
        // written in the house style every other list in this repo uses failed
        // with "writes 8 values under 7 column headings" — a real-sounding
        // message for a formatting choice. Dropped before the split, which is
        // the one place it can be done without special-casing the loop.
        const inner = body.replace(/^\[/, '').replace(/\]$/, '').replace(/,\s*$/, '');
        // Top-level commas only: an accessor may carry brackets or calls.
        let depth = 0, count = 1;
        for (const ch of inner) {
          if ('([{'.includes(ch)) depth += 1;
          else if (')]}'.includes(ch)) depth -= 1;
          else if (ch === ',' && depth === 0) count += 1;
        }
        assert.equal(count, cols, `${f} writes ${count} values under ${cols} column headings`);
        checked += 1;
      }
    }
    assert.ok(checked >= 3, `expected every exporting zone to be checked, saw ${checked}`);
  });
}

test('a gap note describes the screen, never a capability the API already has', () => {
  // THE ERROR THIS EXISTS TO STOP, committed inside the pass it belongs to.
  // `funds/lps` said "nothing writes an LP" and `funds/calls` said "never
  // issued" — both read off the pages' imports and both false: `api.fundAddLP`
  // and `api.fundCapitalCall` exist and reach worker routes that serve them.
  // What is missing on those two zones is a form, not a store, and a reader
  // deciding what to build next is exactly the person the wrong version misled.
  //
  // The tie runs both ways. If either method is removed, its note stops being
  // true in the OTHER direction and this fails; if either note goes back to
  // denying the capability, this fails too.
  const api = read('frontend/src/lib/api.js');
  const worker = read('cloudflare-worker/src/routes/funds.ts');
  const table = read('frontend/src/workspaces/investorZoneActions.js');
  const DENIALS = /nothing writes|never issued|no such|is not stored|cannot be/i;

  for (const [zone, label, method, route] of [
    ['funds/lps', 'Add LP', 'fundAddLP', "post('/:id/lps'"],
    ['funds/calls', 'New call', 'fundCapitalCall', "post('/:id/capital-call'"],
  ]) {
    assert.match(api, new RegExp(`\\n  ${method}:`), `api.js no longer declares ${method}`);
    assert.ok(worker.includes(route), `funds.ts no longer serves ${route}`);
    const at = table.indexOf(`'${zone}'`);
    assert.ok(at > 0, `${zone} left the table`);
    const entry = table.slice(at, table.indexOf('],', at));
    const note = entry.match(new RegExp(`\\{ label: '${label}', unbuilt: '([^']*)'`));
    assert.ok(note, `${zone}'s "${label}" is no longer a stated gap — if it was wired, delete this row`);
    assert.doesNotMatch(note[1], DENIALS,
      `${zone} "${label}" denies a capability ${method} provides: "${note[1]}"`);
    assert.match(note[1], /no screen offers the form yet/,
      `${zone} "${label}" must say where the gap actually is`);
  }
});

test('the shared surfaces dispatch on the role, and refuse an unknown one', () => {
  // `/network/*` and `/research/*` are one component each, answering four
  // licences. Hardcoding a profile there — or falling back to one — would show
  // a founder's actions to an operator from the same line of code, which is the
  // same broken promise as a dead button and much harder to notice. Two
  // mutations proved nothing was holding this shut.
  const src = read('frontend/src/workspaces/zoneActionsByRole.js');
  const fn = src.slice(src.indexOf('export function zoneActionsFor'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /BY_ROLE\[role\]/, 'the dispatcher no longer looks the role up');
  assert.match(body, /return fn \? fn\(key, opts\) : \[\];/,
    'an unknown role must get an empty list, never a default profile');
  assert.doesNotMatch(body, /founderZoneActions|investorZoneActions|partnerZoneActions|advisorZoneActions/,
    'the dispatcher names a profile directly instead of choosing one');
  // And the map is complete: a licence missing from it silently shows nothing.
  const map = src.slice(src.indexOf('const BY_ROLE'), src.indexOf('};', src.indexOf('const BY_ROLE')));
  for (const role of Object.keys(PROFILES)) {
    assert.match(map, new RegExp(`\\b${role}:`), `${role} is not in the dispatcher's map`);
  }
});

test('one builder, so the rules cannot drift apart between profiles', () => {
  // Four tables and four copies of "what an empty export says" is how this repo
  // ended up with three CSV escapers that disagree.
  const builder = read('frontend/src/workspaces/zoneActionBuilder.js');
  assert.match(builder, /export function makeZoneActions\(/);
  for (const [name, profile] of Object.entries(PROFILES)) {
    const src = read(profile.table);
    assert.match(src, /import \{ makeZoneActions \} from '\.\/zoneActionBuilder'/,
      `${name} does not use the shared builder`);
    // The ban is on the table CALLING these, and a table explaining why an op is
    // a handler rather than an `exportView` has to name the thing it is not.
    assert.doesNotMatch(codeOnly(src), /exportView|localStorage/,
      `${name}'s table reimplements what the builder does`);
  }
});

test('the shared zone body actually renders the row it is handed', () => {
  // Seven partner zones pass their row to `ZoneBody`, which is the only thing
  // that renders it. `const row = null` in there empties all seven at once and
  // leaves every table, every wiring assertion and the build untouched.
  const kit = read('frontend/src/pages/advisor/expertise/kit.jsx');
  const fn = kit.slice(kit.indexOf('export function ZoneBody'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /actions\?\.length \? <ZoneActions[^>]*items=\{actions\}/,
    'ZoneBody no longer renders the actions it is given');
  // And it renders above every one of the four states, not only the happy one:
  // a stated gap is as true while the store is loading or failed as after.
  for (const state of ['loading', 'error', 'isEmpty']) {
    assert.ok(body.includes(state), `ZoneBody no longer handles ${state}`);
  }
  assert.equal((body.match(/wrap\(/g) || []).length, 4,
    'a ZoneBody return path stopped carrying the actions row');
});

test('an action that performs nothing is not rendered at all', () => {
  // THIS ASSERTION REVERSED, DELIBERATELY. It used to require that an
  // unperformable action rendered as a `<span>` of prose stating why. That
  // shipped the reason to the customer inside the control's own label — the
  // design's `Comparables` chip arrived as a two-line sentence about how
  // comparables are filed — so the entry now renders NOTHING and the reason
  // stays in the action table. Refusing to draw a dead button has not changed;
  // only where the refusal is explained has.
  const builder = read('frontend/src/workspaces/zoneActionBuilder.js');
  const bind = builder.slice(builder.indexOf('export function makeZoneActions'));
  assert.match(bind, /return null;\n\s*\}\)\.filter\(Boolean\);/,
    'the builder no longer drops the entries it cannot perform');

  const zone = read('frontend/src/workspaces/ZoneActions.jsx');
  const render = zone.slice(zone.indexOf('export default function ZoneActions'));
  assert.doesNotMatch(render, /item\.note/,
    'ZoneActions reads a note again — the prose branch is back');
  assert.doesNotMatch(render, /\{item\.label\} — /,
    'ZoneActions renders a label joined to a sentence again');

  // The toolbar's filter half had the same defect and the same fix.
  const toolbar = read('frontend/src/workspaces/ZoneToolbar.jsx');
  assert.doesNotMatch(toolbar, /groupFilterNotes|sentenceList/,
    'ZoneToolbar collects filter reasons into prose again');
  // Through `codeOnly`: the docblock NAMES `noteAlways` to explain why it was
  // removed, so a raw-source check would fail on the explanation itself.
  const filters = codeOnly(read('frontend/src/workspaces/zoneFilterBuilder.js'));
  assert.match(filters, /if \(item\.unbuilt\) return \[\];/,
    'the filter builder no longer drops an unbuilt chip');
  assert.doesNotMatch(filters, /noteAlways/,
    'the noteAlways mode is back — a standing sentence beside working chips');
});

test('the client CSV escapes exactly as the worker does', () => {
  // Three copies of this function already disagree in this repo; a fourth
  // drifting a fifth way is the failure that consolidating them was meant to
  // end. A bare carriage return left unquoted splits a record for any RFC 4180
  // reader, which is how a founder's export loses half its rows.
  //
  // Read through `codeOnly`: the docblock of the file under test QUOTES the
  // rule it implements, so a check against the raw source passes on the comment
  // while the code says something else. That mutation survived once here.
  const client = codeOnly(read('frontend/src/lib/csvExport.js'));
  const worker = codeOnly(read('cloudflare-worker/src/services/csv.ts'));
  const rule = /\[",\\n\\r\]/;
  assert.match(client, rule, 'the client CSV does not quote on all four characters');
  assert.match(worker, rule, 'the worker CSV rule moved — this test is comparing to nothing');
  assert.match(client, /replace\(\/"\/g, '""'\)/, 'a quote inside a cell is not doubled');
  assert.match(client, /if \(!list\.length\) return false;/,
    'exportView writes an empty file instead of refusing');
});

test('the label says the export is of this view, because it is', () => {
  // It exports the rows the page has LOADED, which on most zones is a capped
  // page. "Export" over a truncated list, with no hint of the truncation, is
  // how a reader pastes twenty-five of two hundred rows into an update.
  const builder = read('frontend/src/workspaces/zoneActionBuilder.js');
  assert.match(builder, /label: `\$\{item\.label\} · this view`/,
    'the export button no longer says which rows it covers');
  assert.match(read('frontend/src/lib/csvExport.js'), /\$\{list\.length\}-rows/,
    'the filename no longer carries the row count');
  // An export over rows that have not LOADED is the one control that stays and
  // goes quiet: the store and the writer both exist, so it keeps the canvas's
  // label and renders disabled rather than vanishing like an unbuilt op.
  assert.match(builder, /disabled: true, title: 'nothing loaded to export yet'/,
    'an export with no rows is offered as a live button');
});

/*
 * The reader's own two failure modes, exercised directly.
 *
 * Every assertion above reads a canvas through `artboardOps`, so a reader that
 * quietly returns nothing — or returns the template rather than the design —
 * takes the whole file's coverage with it and reports a clean run. These two
 * tests are the only ones here that do not care what any zone says; they care
 * that a canvas this reader cannot read is loud about it.
 */
test('a matched canvas that yields no artboard fails the run', () => {
  // Not a hypothetical: `canvasOps` used to count MATCHED FILES, so a canvas
  // whose name matched and whose contents it could not parse left the count
  // truthy and shrank the covered set in silence. The stand-in is a file in
  // this very directory, chosen because it can never drift into looking like a
  // canvas — `design/incoming/README.md` was the first candidate and it PARSED,
  // as shape A, off one `route:'…'` quoted in its own prose. That is the shape
  // of the original bug in miniature: what a reader matches is not what a
  // person means by the name.
  assert.throws(() => canvasOps({
    canvasDirs: ['frontend/test'],
    canvas: /^_codeOnly\.mjs$/,
    live: (route) => route,
  }), /yielded no artboard/);
});

test('a canvas read in the wrong shape is refused, not counted', () => {
  // `Pages · Founder Validate` is the file that proved emptiness was not the
  // whole test. It is shape C — one artboard looped over a `boards` array — and
  // the shape-B branch below it reads its markup into a single artboard called
  // `/validate/{{-b.zone-}}` whose one op is `{{ t }}`. That is a parsed-looking
  // result with a non-zero count, so only `literal()` catches it.
  const src = read('design/canvases/integrated/Pages · Founder Validate.dc.html');
  assert.match(src, /\bboards:\s*\[/, 'the canvas this test is built on is no longer shape C');
  assert.throws(() => artboardOps(src.replace(/\bboards:\s*\[/, 'notboards: [')),
    /unexpanded template binding/,
    'the shape-B fallback read a template as a design and nothing objected');

  // And read in its own shape it yields the four real routes, with the ops
  // paired to the board that declares them rather than to their position.
  const found = artboardOps(src);
  assert.deepEqual(Object.keys(found).sort(),
    ['/validate/hypotheses', '/validate/interviews', '/validate/pain-map', '/validate/verdict']);
  // Two boards, not one: reading `tools:` from the whole array rather than from
  // the board that declares it gives every route the FIRST board's ops, and a
  // single-board check cannot tell the difference.
  assert.deepEqual(found['/validate/interviews'], ['Log an interview', 'Export transcripts']);
  assert.deepEqual(found['/validate/verdict'], ['Export summary', 'Send to Problem slide']);
});
