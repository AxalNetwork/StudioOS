// Template-preview registry — maps every production template key to its REAL
// preview component under this directory. This is the frontend counterpart of
// the worker's TEMPLATE_SOURCES: 15 keys are faithful ports of the designs in
// `brandtemplates/<Dir>/src/routes/index.tsx`, and `proof-builder` is the
// in-house original (no brandtemplates/ source — see TEMPLATE_SOURCES in
// cloudflare-worker/src/services/landingTemplates.ts).
//
// The library page renders these instead of the old TemplateThumb bar-and-box
// placeholders; TemplateThumb survives ONLY as the fallback for keys that are
// not in this registry (the 5 generic visual styles and legacy/unknown
// values). brand_template_previews.test.mjs enforces that every catalog entry
// resolves here, so a new template can't silently ship with a placeholder.
import AdvisorConnectPreview from './AdvisorConnectPreview.jsx';
import ProofBuilderPreview from './ProofBuilderPreview.jsx';
import CapitalReadyKitPreview from './CapitalReadyKitPreview.jsx';
import CapitalStorytellerPreview from './CapitalStorytellerPreview.jsx';
import SeedStageSparkPreview from './SeedStageSparkPreview.jsx';
import DistributionDeckPreview from './DistributionDeckPreview.jsx';
import PilotPartnerPagePreview from './PilotPartnerPagePreview.jsx';
import PartnerHubPreview from './PartnerHubPreview.jsx';
import PartnerPipelineProPreview from './PartnerPipelineProPreview.jsx';
import CoFounderBuilderPreview from './CoFounderBuilderPreview.jsx';
import CoFounderCanvasPreview from './CoFounderCanvasPreview.jsx';
import CofounderConnectPreview from './CofounderConnectPreview.jsx';
import CoFounderQuestPreview from './CoFounderQuestPreview.jsx';
import MentorConnectPreview from './MentorConnectPreview.jsx';
import MentorConnectPagePreview from './MentorConnectPagePreview.jsx';
import BuildersLaunchpadPreview from './BuildersLaunchpadPreview.jsx';

/** Fixed artboard width every preview component designs at; the wrapper
 *  scales this down to whatever container it's placed in. */
export const PREVIEW_NATURAL_WIDTH = 720;

/** key → preview component. Keys mirror TEMPLATE_KEYS / the catalog's
 *  visualTemplate values for the 16 library templates. */
export const PREVIEW_REGISTRY = {
  'advisor-connect': AdvisorConnectPreview,
  'proof-builder': ProofBuilderPreview,
  'capital-ready-kit': CapitalReadyKitPreview,
  'capital-storyteller': CapitalStorytellerPreview,
  'seed-stage-spark': SeedStageSparkPreview,
  'distribution-deck': DistributionDeckPreview,
  'pilot-partner-page': PilotPartnerPagePreview,
  'partner-hub': PartnerHubPreview,
  'partner-pipeline-pro': PartnerPipelineProPreview,
  'co-founder-builder': CoFounderBuilderPreview,
  'co-founder-canvas': CoFounderCanvasPreview,
  'cofounder-connect': CofounderConnectPreview,
  'co-founder-quest': CoFounderQuestPreview,
  'mentor-connect': MentorConnectPreview,
  'mentor-connect-page': MentorConnectPagePreview,
  'builders-launchpad': BuildersLaunchpadPreview,
};

/** Look up the real preview component for a template key (null → caller
 *  falls back to the legacy placeholder for generic/unknown keys). */
export function getPreviewComponent(templateKey) {
  return PREVIEW_REGISTRY[templateKey] || null;
}
