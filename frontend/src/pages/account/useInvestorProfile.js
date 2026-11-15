/** The Settings cards share one saved profile and one full-replace write at a time (#6288). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

export function useInvestorProfile(enabled) {
  const [profile, setProfile] = useState(undefined);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const reading = useRef(false);
  const writing = useRef(false);
  const savedProfile = useRef(undefined);

  const reload = useCallback(async () => {
    if (reading.current || savedProfile.current !== undefined) return;
    reading.current = true;
    setError(null);
    try {
      const { profile: loaded } = await api.getInvestorProfile();
      savedProfile.current = loaded ?? null;
      setProfile(savedProfile.current);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      reading.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled && savedProfile.current === undefined && !error) void reload();
  }, [enabled, error, reload]);

  const save = async (card, edits) => {
    if (!savedProfile.current || writing.current) return false;
    writing.current = true;
    setSaving(card);
    try {
      const latest = savedProfile.current;
      const { profile: updated } = await api.saveInvestorProfile({
        investor_type: latest.investor_type,
        sectors: latest.sectors ?? [],
        stages: latest.stages ?? [],
        geos: latest.geos ?? [],
        ticket_band: latest.ticket_band,
        thesis_text: latest.thesis_text,
        anti_thesis_sectors: latest.anti_thesis_sectors ?? [],
        anti_thesis_stages: latest.anti_thesis_stages ?? [],
        value_weights: latest.value_weights ?? {},
        // The Worker preserves consent when omitted. Only the Signals switch sends it.
        ...edits,
      });
      savedProfile.current = updated;
      setProfile(updated);
      return true;
    } finally {
      writing.current = false;
      setSaving(null);
    }
  };

  return { profile, error, busy: saving !== null, saving, reload, save };
}
