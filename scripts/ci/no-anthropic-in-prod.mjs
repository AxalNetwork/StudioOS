#!/usr/bin/env node
/**
 * D5339 — production Advisor provider boundary.
 *
 * `npm run test:guards` runs this check. It proves three separate properties:
 *   1. the Personal Advisor route/service import graph cannot reach D851's
 *      provider execution service or any adapter under `services/ai/providers`;
 *   2. Anthropic endpoints, model ids and key names occur only in the reviewed
 *      dev-assistant and D851 files; and
 *   3. `/api/assistant` remains mounted behind its non-production, explicit
 *      `ENABLE_ANTHROPIC_DEV=1` middleware.
 *
 * The D851 adapter remains off unless its own switch is exactly `on`; this
 * guard does not change provider eligibility or enable a provider.
 */
import { auditNoAnthropicInProduction, formatNoAnthropicFindings } from '../lib/noAnthropicInProd.mjs';

const findings = auditNoAnthropicInProduction();
if (findings.length) {
  console.error(formatNoAnthropicFindings(findings));
  process.exit(1);
}
console.log('no-anthropic-in-prod: OK (Advisor graph, reviewed references, assistant mount gate)');
