// Scoring Engine — dimension tile icons.
//
// lib/scoringViewModel.js is a pure module (no React), so DIMENSIONS carries
// an `iconKey` string and the lucide component is resolved here.

import { Compass, Fingerprint, Map as MapIcon, Gauge, Building2, MessagesSquare } from 'lucide-react';

export const DIM_ICONS = {
  compass: Compass,
  fingerprint: Fingerprint,
  map: MapIcon,
  gauge: Gauge,
  building: Building2,
  messages: MessagesSquare,
};

export default DIM_ICONS;
