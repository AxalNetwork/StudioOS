import React, { useEffect, useState } from 'react';
import { platformStatusApi } from '../../lib/api/platformStatus.js';
import { reportError } from '../../lib/log';
import { pausedLine } from './platformStatusModel.js';

/**
 * D4162 (#4162, SA6b): the line every team sees while Axal HQ has paused all
 * AI agents. It reads `GET /api/teams/platform-status`; with nothing paused
 * (or nothing read) it draws nothing. The admin is named; the reason stays HQ's.
 */
export default function PlatformPausedBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    platformStatusApi.read().then((s) => { if (live) setStatus(s); }).catch((e) => reportError('team:platform-status', e));
    return () => { live = false; };
  }, []);
  const line = pausedLine(status);
  if (!line) return null;
  return (
    <p role="status" data-testid="platform-paused-banner"
      className="m-0 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
      {line}
    </p>
  );
}
