import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable } from '../../ui';

/** D1128: opening Profile asks an admin-moved member the missing questions
 * through the existing onboarding screen. A read failure costs only this block. */
export default function PersonaFollowUpCheck() {
  const location = useLocation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const skip = location.state?.skipPersonaFollowUp === true;
  useEffect(() => {
    if (skip) return undefined;
    let live = true;
    setFailed(false);
    api.getMyPersonas().then(data => {
      if (!live) return;
      if (typeof data?.follow_up?.pending !== 'boolean') { setFailed(true); return; }
      if (data.follow_up.pending) navigate('/onboarding/persona?follow_up=1', { replace: true });
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [skip, tick, navigate]);
  return failed ? <div data-testid="persona-follow-up-unreadable"><Unreadable what="Your segment questions" claim="This is not a claim that you have no questions." onRetry={() => setTick(n => n + 1)} /></div> : null;
}
