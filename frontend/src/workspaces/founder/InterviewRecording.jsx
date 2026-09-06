import { useRef, useState } from 'react';
import { Mic, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCost } from '../../ui/assistCost';

/**
 * A recording on one interview, and the text it becomes.
 *
 * TWO ACTS, AND ONLY ONE OF THEM IS AI. Attaching audio is data entry — the
 * same kind of thing as typing the interviewee's name — so it is available
 * whatever the rail's switch says. Transcribing spends money, so it sits behind
 * the mode: with "AI fills the blanks" off, nothing on this workspace runs a
 * model, and a founder who has turned it off should not find one control that
 * still does.
 *
 * That is also why the off state says what it says. A disabled button with no
 * explanation reads as broken; naming the switch tells the reader where the
 * capability went and that it is theirs to turn on.
 *
 * WHAT THE BROWSER MEASURES AND WHAT THE SERVER BILLS ARE DIFFERENT NUMBERS,
 * on purpose. `duration_sec` here comes from an `<audio>` element and is for
 * the screen. The worker prices a transcription from the file's byte length,
 * because a number the client chooses must not decide what a run costs.
 */

const GHOST = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
  + 'border-gray-200 bg-white px-[9px] py-1 text-[10.5px] font-bold text-gray-700 '
  + 'transition-colors hover:border-gray-300 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';

/** Seconds → m:ss. Absent stays absent: a missing duration is not 0:00. */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Read a clip's duration in the browser, or null when the container has none. */
function readDuration(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = new Audio();
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      el.addEventListener('loadedmetadata', () => {
        done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
      });
      // A stream with no container metadata never fires `loadedmetadata`, and a
      // corrupt one fires `error`. Both mean "no duration", which is a real
      // state the row prints rather than a failure to upload.
      el.addEventListener('error', () => done(null));
      el.src = url;
    } catch { resolve(null); }
  });
}

export default function InterviewRecording({ interview, fillsOn, onChanged }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [usage, setUsage] = useState(null);
  const inputRef = useRef(null);

  const hasAudio = Boolean(interview?.recording_r2_key || interview?.recording_uploaded_at);
  // NULL means never transcribed. An EMPTY STRING means transcribed and the
  // clip had no speech in it — a real answer, and the reason the two are not
  // folded together: offering "Transcribe" again on a silent clip would charge
  // the same amount to return the same nothing.
  const transcript = interview?.transcript;
  const hasTranscript = typeof transcript === 'string';

  const upload = async (file) => {
    if (!file) return;
    setBusy('upload'); setNote(''); setUsage(null);
    try {
      const duration = await readDuration(file);
      await api.uploadInterviewRecording(interview.id, file, duration);
      onChanged?.();
    } catch (e) {
      setNote(e?.body?.detail === 'unsupported_type'
        ? 'That file type cannot be transcribed. Use a recording from your phone or browser.'
        : e?.body?.detail === 'too_large'
          ? 'That recording is too large. The limit is 20 MB, about 80 minutes of speech.'
          : e?.body?.message || e?.message || 'The recording could not be attached.');
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const transcribe = async () => {
    setBusy('transcribe'); setNote(''); setUsage(null);
    try {
      const r = await api.transcribeInterview(interview.id);
      setUsage(r?.usage || null);
      if (r?.transcript === '') setNote('The recording has no speech in it. Nothing was written.');
      onChanged?.();
    } catch (e) {
      setNote(e?.body?.message || e?.message || 'That could not be transcribed. Nothing was charged.');
    } finally {
      setBusy('');
    }
  };

  const length = formatDuration(interview?.recording_duration_sec);

  return (
    <div className="mt-1.5" data-testid={`recording-${interview?.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!hasAudio ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
              data-testid={`input-recording-${interview?.id}`}
            />
            <button
              type="button"
              className={GHOST}
              onClick={() => inputRef.current?.click()}
              disabled={busy === 'upload'}
              data-testid={`action-attach-recording-${interview?.id}`}
            >
              <Mic size={12} aria-hidden="true" />
              {busy === 'upload' ? 'Attaching…' : 'Attach a recording'}
            </button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-gray-500 dark:text-gray-400">
            <Mic size={12} aria-hidden="true" />
            Recording attached
            {/* A missing duration is stated, never printed as 0:00. */}
            {length ? ` · ${length}` : ' · length not recorded'}
          </span>
        )}

        {hasAudio && !hasTranscript && (
          fillsOn ? (
            <button
              type="button"
              className={GHOST}
              onClick={transcribe}
              disabled={busy === 'transcribe'}
              data-testid={`action-transcribe-${interview?.id}`}
            >
              <FileText size={12} aria-hidden="true" />
              {busy === 'transcribe' ? 'Transcribing…' : 'Transcribe'}
            </button>
          ) : (
            <span className="text-[10.5px] text-gray-500 dark:text-gray-400" data-testid={`transcribe-off-${interview?.id}`}>
              Turn on &ldquo;AI fills the blanks&rdquo; in the rail to transcribe it.
            </span>
          )
        )}
      </div>

      {hasTranscript && (
        <div className="mt-1.5 rounded-[8px] border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
          {transcript ? (
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-800 dark:text-gray-200" data-testid={`transcript-${interview?.id}`}>
              {transcript}
            </p>
          ) : (
            <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid={`transcript-${interview?.id}`}>
              Transcribed, and there was no speech in the recording.
            </p>
          )}
          {interview?.transcribed_by_model && (
            <p className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
              {interview.transcribed_by_model.split('/').pop()}
            </p>
          )}
        </div>
      )}

      {usage && (
        <p className="mt-1.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400" data-testid={`transcribe-receipt-${interview?.id}`}>
          {usage.model?.split('/').pop()}
          {typeof usage.audio_minutes === 'number' ? ` · ${usage.audio_minutes} audio min` : ''}
          {' · '}{formatCost(usage.est_cost_usd)}
        </p>
      )}
      {note && (
        <p className="mt-1.5 text-[10.5px] text-gray-600 dark:text-gray-400" data-testid={`recording-note-${interview?.id}`}>
          {note}
        </p>
      )}
    </div>
  );
}
