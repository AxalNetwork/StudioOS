/**
 * Raise's entry in CycleRoute.jsx's cycle table (D661, #1474; split out by
 * D5615, #5615): its modules, Build your deck and the round-call lightbox
 * (D686), each module's parts, its tools and the four AI bands (D424).
 */
import RoundCallSheet from '../../founder/RoundCallSheet';
import MercuryRaiseFeed from '../MercuryRaiseFeed';
import FromNotion from '../FromNotion';
import RaisePosthog from '../RaisePosthog';
import NotionSnapshotImport from '../NotionSnapshotImport';
import { PmfPart } from '../PmfPart';
import RaiseReceiptMatches from '../../../components/RaiseReceiptMatches';
import EvidencePart from '../evidence/EvidencePart';
import { isNarrativeAdmin } from '../../raise/narrative/narrativeModel';
import { forecastHref } from '../../raise/useoffunds/useOfFundsModel';
import { toFnMap } from '../adapters';
import { MODULES } from '../modules';
import { lazyStep } from '../lazyStep.jsx';

// D4574 (#4574, H5): Raise's step behind its own lazy boundary.
const NarrativeHome = lazyStep(() => import('../../raise/narrative/NarrativeTool'), 'NarrativeHome');

/** D840 part 2 (#2347): a Raise module's From Mercury, from `parts.mercury`, which only the founder's own read carries. */
const mercuryPart = (slug, data, ctx) => <MercuryRaiseFeed slug={slug} part={data?.parts?.mercury} projectId={ctx.projectId} reload={ctx.reload} />;

/**
 * Raise's read (#1501, D663) is already in D661's shape: its cards carry
 * chart specs and its records carry their own `add`, so it needs no
 * adapter. Its modules are in `modules.js`, held to `services/raiseCycle.ts`'s
 * list by `cycle_adapters_d661.test.ts`.
 *
 * Data room's module page is `/raise/data-room`: that static route draws
 * this page with `slug="data-room"` (D696 decision 12), so all seven Raise
 * modules have module pages. It is the Data room tool's Home (D1101); the
 * old files tool and access view are retired and their addresses forward to
 * the tool's tabs (D1109).
 */
const raise = {
  modules: MODULES.raise,
  // Keep the round-call lightbox route; the primary action opens Pitch Studio.
  path: 'call',
  Mount: RaiseMount,
  action: (q) => ({ label: 'Build your deck', href: `/raise/pitch${q}` }),
  // D686 §5.6: Capital relationships' Calls history, anchored at #calls.
  // D752 (#1989): then the founder's "Match to my Mercury" for committed prospects.
  // D840 part 2 (#2347): every Raise module's From Mercury, the founder's alone, anchored at #from-mercury.
  // D1267 (#3290, VR6): then each module's Evidence part, opening the Evidence view's drawers.
  parts: toFnMap({
    ...Object.fromEntries(MODULES.raise.map((m) => [m.slug, (data, ctx) => (
      <>
        {mercuryPart(m.slug, data, ctx)}
        {/* D1607 (#3731): Pitch deck's PostHog metrics; Readiness and Narrative draw theirs below. */}
        <RaisePosthog slug={m.slug} projectId={ctx.projectId} />
        <EvidencePart slug={m.slug} projectId={ctx.projectId} />
      </>
    )])),
    // D909 (#2693, NAR1): Home's tiles, Needs you and footer, from the module read's `parts.narrative`;
    // D913: its Objections heard, with no Answer it for an admin.
    'investor-narrative': (data, ctx) => (
      <>
        <NarrativeHome data={data} admin={isNarrativeAdmin({ role: ctx.role })} projectId={ctx.projectId} />
        {mercuryPart('investor-narrative', data, ctx)}
        <RaisePosthog slug="investor-narrative" projectId={ctx.projectId} />
        <EvidencePart slug="investor-narrative" projectId={ctx.projectId} />
      </>
    ),
    // D1141 (#2433), D1145 (#3031): Product-market fit from `parts.pmf`, beside the raise kit; then From Mercury.
    'fundraising-readiness': (data, ctx) => (
      <>
        <PmfPart part={data?.parts?.pmf} card={data?.card} records={data?.records} projectId={ctx.projectId} reload={ctx.reload} />
        {mercuryPart('fundraising-readiness', data, ctx)}
        <RaisePosthog slug="fundraising-readiness" projectId={ctx.projectId} />
        <EvidencePart slug="fundraising-readiness" projectId={ctx.projectId} />
      </>
    ),
    // D1227 (#3226): the Calls history left Overview; Calls for Capital is the Calls tab (D1221).
    'capital-relationships': (data, ctx) => (
      <>
        <RaiseReceiptMatches role={ctx.role} onChanged={ctx.reload} />
        {mercuryPart('capital-relationships', data, ctx)}
        {/* D1089 (#2954): an investor CRM in Notion, as investors to add or link; once linked, their stage follows. */}
        <FromNotion section="raise" projectId={ctx.projectId} module="capital_relationships" />
        <EvidencePart slug="capital-relationships" projectId={ctx.projectId} />
      </>
    ),
    // D1089 (#2954): Notion pages as dated snapshots, NDA by default; a change adds a version on Accept only.
    'data-room': (data, ctx) => (
      <>
        {mercuryPart('data-room', data, ctx)}
        <FromNotion section="raise" projectId={ctx.projectId} module="data_room" acceptDialog={NotionSnapshotImport} />
        <EvidencePart slug="data-room" projectId={ctx.projectId} />
      </>
    ),
  }),
  tools: toFnMap({
    'investor-narrative': (q) => ({ label: 'Open positioning', href: `/raise/investor-narrative/positioning${q || ''}` }),
    'pitch-deck': () => ({ label: 'Open the pitch deck', href: '/raise/pitch' }),
    // D1029: the Cap table module page is the tool, so it has no door to itself.
    // D1173 (#2455): the venture travels with the link (broken item 8).
    'use-of-funds': (q) => ({ label: 'Open the forecast', href: forecastHref(q) }),
    // D1194 (#3128): the old pipeline retired into the tool; its door opens the Pipeline tab with the venture.
    'capital-relationships': (q) => ({ label: 'Open the investor pipeline', href: `/raise/capital-relationships/pipeline${q || ''}` }),
    // D1109 (#2989): the Data room module page is the tool, so it has no door to the retired access view.
  }),
  add: toFnMap({}),
  fills: {},
  // The Raise desk's four AI bands (ZoneDraft, D424), on the modules they
  // read: the round and its order of payment on Cap table, which holds the
  // scenario both read; the room and the clauses on Fundraising readiness,
  // which scores the data room and the documents, so the room's band sits
  // there rather than on Data room's module page. The narrative band sits on
  // Investor narrative, whose check it phrases.
  drafts: new Map([
    ['cap-table', [{
      surface: 'raise/capital', label: 'Proposal · plain-language read', run: 'Read the round back', accept: 'Attach to scenario',
      empty: 'Nothing proposed yet. Eadwyn will read your round and cap-table scenario back in plain language, and show every step of the arithmetic.',
      nothingToDraft: 'No round and no cap-table scenario are recorded for this startup yet.',
      foot: 'Shown step by step, because you will be asked to defend this number.',
    }, {
      surface: 'raise/liquidity', label: 'Proposal · plain-language read', run: 'Explain the order of payment', accept: 'Attach to term sheet',
      empty: 'Nothing proposed yet. Eadwyn will explain who is paid what and in what order from your cap table and round — and name every term the answer needs that nothing here records.',
      nothingToDraft: 'No cap-table scenario is recorded, so there is no ownership to pay out.',
      foot: 'No preference term is stored, so none is assumed.',
    }]],
    ['fundraising-readiness', [{
      surface: 'raise/data-room', label: 'Gap analysis', run: 'Read the room', accept: 'Keep this reading',
      empty: 'Nothing proposed yet. Eadwyn will read what this room holds, what sits behind NDA, and what the investors with access have actually opened.',
      nothingToDraft: 'This room holds no folders and no files yet.',
      foot: 'Read from the room itself, never from a generic diligence checklist.',
    }, {
      surface: 'raise/legal', tone: 'warn', label: 'Clause explained', run: 'Explain the clauses', accept: 'Keep this reading',
      empty: 'Nothing proposed yet. Eadwyn will read the documents you have stored and name the clauses worth looking at again, quoting each one.',
      nothingToDraft: 'No stored legal document has any text to read.',
      // A reading of your own documents, and the footnote says what it is
      // rather than what it is not (D424's voice rule).
      foot: 'A reading of your documents, not counsel’s review. Counsel is on the Team page.',
    }]],
    // #1524 item 3 (D663): the consistency check lists each figure the
    // narrative states differently from the stored metrics; on request,
    // Eadwyn phrases the fix for the first one, citing both sides.
    ['investor-narrative', [{
      surface: 'raise/narrative-fix', tone: 'warn', label: 'Mismatch · phrase the fix', run: 'Phrase the fix', accept: 'Save reading to copy',
      empty: 'Nothing proposed yet. Eadwyn will phrase the fix for the first mismatch the consistency check found in your newest narrative version, naming both figures and where each was read.',
      nothingToDraft: 'The consistency check found no mismatch in your newest narrative version.',
      foot: 'Neither figure is taken as the right one. Keeping the wording changes neither the narrative nor the metrics.',
    }]],
  ]),
};

export default raise;

function RaiseMount({ projectId, onClose, asPage }) {
  return <RoundCallSheet projectId={projectId} onClose={onClose} asPage={asPage} />;
}
