import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Stream } from '@cloudflare/stream-react';
import { ExternalLink } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import LessonFooter, { MarkCompleteButton } from './LessonFooter';
import { hasLessonBody, lessonPositionLine, progressRefusal } from './lessonFooterModel';
import useOnline from './useOnline';
import { queuedPositionWriter } from './lessonPositionWriter';
import './lessonFooter.css';
import { LearningEmpty, LearningUnreadable, SectionCard, stateBlock } from './LearningStates';
import {
  CUES_UNREADABLE, NO_CHAPTERS, NOT_LIVE, PLAIN_TRANSCRIPT_LINE, captionChoices, chapterAt, chaptersOf, clockLabel, cueAt, durationLabel,
  lessonKindLabel,
} from './learningModel';

/**
 * One lesson, or one standalone video or reading: the media, a transcript
 * panel, previous and next, and "Mark complete" (D562; data D557, an uploaded
 * file's stream D561).
 *
 * Props, in the routes' shapes:
 *   status      'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   lesson      { uid, title, kind } from the course, or null for a standalone item
 *   item        `GET /api/learning/items/:uid`'s item: { uid, kind, title, body,
 *               duration_seconds, thumbnail_url, transcript, video_source, video_url,
 *               video_stream_url }
 *   video       how it plays (`videoPlayback`): { src, embed: true } in the
 *               platform's iframe, { src, embed: false } in the browser's own
 *               player (an uploaded file, from its gated stream route), or
 *               { reason, href } for a video this page cannot play
 *   transcript  the item's transcript text, or null when none is recorded
 *   moduleTitle, position ("5 of 12"), prev and next { title, href } or null
 *   completed   the member's own progress on it
 *   onMarkComplete, marking, markError
 *   loadCaption #4178 (D4178): `(language) => Promise<cues>` for a Stream video's ready
 *               captions (`readItemCaption`); without it the transcript is the plain text
 *
 * #4178 (D4178, LR4): a ready Stream video plays in Stream's own player
 * (`@cloudflare/stream-react`, on the signed source), so it can be timed and
 * seeked: the current chapter and the current cue are highlighted, and a click
 * on either seeks. An uploaded file in the browser's player seeks the same way.
 * A plain embed (YouTube, Vimeo) cannot be seeked from the page, so its
 * chapters and transcript are text only.
 *
 * "Mark complete" is disabled until a page passes the handler: a button that
 * looked live and saved nothing would be the dead control D17 refuses.
 */
export default function LessonPlayer({
  status, lesson, item, video, transcript = null, moduleTitle, index, total, position, prev, next,
  completed = false, onMarkComplete, marking = false, markError = '', reason = NOT_LIVE.catalogue, onRetry,
  resumeFrom = null, onPosition = null, loadCaption = null, completionInHeader = false,
}) {
  // The playing time, and how to seek, from whichever player is drawn (null when it cannot be seeked).
  const [now, setNow] = useState(0);
  const online = useOnline();
  const [positionError, setPositionError] = useState('');
  useEffect(() => { setPositionError(''); }, [item?.uid]);
  const positionSubject = useRef(item?.uid);
  positionSubject.current = item?.uid;
  const savePosition = useCallback(async (seconds, percent) => {
    const subject = item?.uid;
    try {
      await onPosition(seconds, percent);
      if (positionSubject.current === subject) setPositionError('');
    } catch (error) {
      if (positionSubject.current === subject) setPositionError(progressRefusal(error));
    }
  }, [onPosition, item?.uid]);
  const seeker = useRef(null);
  const seek = useCallback((t) => { seeker.current?.(t); setNow(t); }, []);
  const canSeek = Boolean(video?.player || (video?.src && !video?.embed));
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the lesson',
    claim: 'This is not a claim that the lesson is empty.',
    isEmpty: !lesson && !item,
    empty: { title: 'No such lesson', body: 'This lesson does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Lesson" testid="lesson-player">{block}</SectionCard>;

  const kind = lesson?.kind || item?.kind;
  const length = durationLabel(item?.duration_seconds);
  const text = String(transcript ?? '').trim();
  // Retain the current caller's recorded `position` until its header wiring is integrated.
  const legacy = typeof position === 'string' ? /^([1-9]\d*) of ([1-9]\d*)$/.exec(position) : null;
  const orderIndex = index ?? (legacy ? Number(legacy[1]) - 1 : undefined);
  const orderTotal = total ?? (legacy ? Number(legacy[2]) : undefined);
  const knownOrder = lessonPositionLine({ index: orderIndex, total: orderTotal, moduleTitle });
  const hasBody = hasLessonBody(item);
  const showFooter = kind === 'video' || (Boolean(lesson) && hasBody);
  // LR4/LR21: player then footer, with chapters and transcript alongside only on wide screens.
  return (
    <div className={`learning-lesson-player min-w-0 space-y-4 ${showFooter ? 'lesson-has-footer' : ''}`} data-testid="lesson-player">
      <div className={kind === 'video' ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start' : ''} data-testid="lesson-player-layout">
        <div className="min-w-0 space-y-4">
          <Card padding="none" className="lesson-content min-w-0 overflow-hidden">
            {!showFooter && !completionInHeader && <div className="border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
              <MarkCompleteButton completed={completed} onMarkComplete={onMarkComplete} marking={marking} hasBody={hasBody} />
            </div>}
            {kind === 'video' ? <div className="lesson-video-frame relative" data-testid="lesson-video-frame">
              <VideoArea video={video} item={item} length={length} resumeFrom={resumeFrom} onPosition={onPosition ? savePosition : null} onTime={setNow} seeker={seeker} />
              {!online && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-axal-ground/95 p-4 text-center text-axal-ink dark:bg-gray-950/95 dark:text-gray-100" role="status" aria-live="polite" data-testid="lesson-offline">
                <strong className="text-[13.5px]">You are offline.</strong><span className="text-[12.5px]">Progress will save when you reconnect.</span>
              </div>}
            </div> : <ReadingArea body={item?.body} />}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-axal-hairline px-4 py-3 text-[11.5px] text-axal-faint dark:border-gray-800 dark:text-gray-400">
              <Pill tone="info">{lessonKindLabel(kind)}</Pill>
              {moduleTitle && <span>{moduleTitle}</span>}
              {position && knownOrder && <span className="tabular-nums">· lesson {position}</span>}
              {length ? <span className="tabular-nums">{length}{kind === 'reading' ? ' read' : ''}</span> : <span>{kind === 'reading' ? 'Reading time' : 'Length'} · <Unrecorded reason={kind === 'reading' ? 'Reading time is not recorded.' : 'Length is not recorded.'} /></span>}
              {item?.level && <Pill tone="neutral">{item.level}</Pill>}
              {kind === 'video' && resumeFrom != null && <Pill tone="neutral" data-testid="lesson-resume">Resume from {clockLabel(resumeFrom)}</Pill>}
            </div>
          </Card>
          {showFooter && <LessonFooter navigation={Boolean(lesson || prev || next)} index={orderIndex} total={orderTotal} moduleTitle={moduleTitle} prev={prev} next={next} completed={completed} onMarkComplete={onMarkComplete} marking={marking} hasBody={hasBody} />}
          {(markError || positionError) && <p className="px-4 py-2 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="text-mark-error">{markError || positionError}</p>}
        </div>
        {kind === 'video' && <div className="min-w-0 space-y-4">
          <Chapters item={item} now={now} onSeek={canSeek ? seek : null} />
          <Transcript text={text} video={video} loadCaption={loadCaption} now={now} onSeek={canSeek ? seek : null} />
        </div>}
      </div>
    </div>
  );
}

function VideoArea({ video, item, length, resumeFrom = null, onPosition = null, onTime = null, seeker = null }) {
  if (!video?.src) {
    const why = video?.reason || 'This video has no playable source yet.';
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-axal-ground px-6 text-center text-[12.5px] text-axal-muted dark:bg-gray-950 dark:text-gray-400" data-testid="lesson-video-absent">
        <span><Unrecorded reason={why} /> · {why}</span>
        {video?.href && (
          <a href={video.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet-deep underline dark:text-violet-300" data-testid="link-video-elsewhere">
            Open the video <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }
  if (video.embed && video.player) {
    return (
      <StreamVideo
        key={video.player.src}
        source={video.player}
        poster={video.stream?.poster || item?.thumbnail_url || undefined}
        title={item?.title || 'Lesson video'}
        language={captionChoices(video)[0]?.language}
        startAt={resumeFrom}
        onPosition={onPosition}
        onTime={onTime}
        seeker={seeker}
      />
    );
  }
  if (video.embed) {
    if (seeker) seeker.current = null;
    return (
      <iframe
        src={video.src}
        title={item?.title || 'Lesson video'}
        className="aspect-video w-full border-0 bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        data-testid="lesson-video-embed"
      />
    );
  }
  // Keyed by its file, so a failure shown for one video never stands in for the next.
  const uploaded = item?.video_source === 'r2' || /^\/api\/learning\/items\/[^/]+\/video(?:[?#]|$)/.test(video.src);
  return (
    <div className="relative" role="region" aria-label={uploaded ? 'Video (uploaded file)' : 'Video player'}>
      {uploaded && <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-axal-sm bg-axal-ground px-2 py-1 text-[11px] font-semibold text-axal-ink dark:bg-gray-900 dark:text-gray-100" data-testid="lesson-uploaded-file">Uploaded file</span>}
    <StreamPlayer
      key={video.src}
      src={video.src}
      poster={item?.thumbnail_url || undefined}
      label={`${item?.title || 'Lesson video'}${length ? `, ${length}` : ''}`}
      startAt={resumeFrom}
      onPosition={onPosition}
      onTime={onTime}
      seeker={seeker}
    />
    </div>
  );
}

/**
 * The writer of a player's position (LR4 resume): at most one write every 15 s
 * while playing, and one on pause or end (`positionWriter`). The page passes a
 * fresh callback each render; the writer reads the latest through a ref, so its
 * throttle is not reset by a re-render.
 */
function usePositionWriter(onPosition, source) {
  // A queued write for the old source must retain that source's callback.
  const latest = useMemo(() => ({ current: onPosition }), [source]);
  latest.current = onPosition;
  const hasWriter = Boolean(onPosition);
  const writer = useMemo(() => (hasWriter ? queuedPositionWriter((s, p) => latest.current?.(s, p)) : null), [hasWriter, source, latest]);
  useEffect(() => {
    if (!writer) return undefined;
    writer.activate();
    const reconnect = () => writer.reconnect();
    window.addEventListener('online', reconnect);
    return () => { window.removeEventListener('online', reconnect); writer.dispose(); };
  }, [writer]);
  return writer;
}

/**
 * #4178 (D4178, LR4): a ready Stream video in Stream's own player, from the
 * signed source the item read minted after its access check. Speed, quality,
 * the captions menu and picture-in-picture are the player's own controls. It
 * starts at the resume point, writes its position like the file player, and is
 * seeked through `seeker`. A player that fails to load is "Unreadable", with
 * Retry, never a black box.
 */
export function StreamVideo({ source, poster, title, language, startAt = null, onPosition = null, onTime = null, seeker = null }) {
  const api = useRef(undefined);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const writer = usePositionWriter(onPosition, source.src);
  useEffect(() => {
    if (!seeker) return undefined;
    seeker.current = (t) => { try { if (api.current) api.current.currentTime = t; } catch { /* a player that cannot seek stays put */ } };
    return () => { seeker.current = null; };
  }, [seeker]);
  if (failed) return <VideoUnreadable onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }} />;
  const at = () => [api.current?.currentTime, api.current?.duration];
  return (
    <div className="aspect-video w-full bg-black" data-testid="lesson-video-stream">
      <Stream
        key={attempt}
        src={source.src}
        customerCode={source.customerCode || undefined}
        controls
        responsive
        preload="metadata"
        poster={poster}
        title={title}
        defaultTextTrack={language || undefined}
        startTime={startAt ?? undefined}
        streamRef={api}
        onError={() => setFailed(true)}
        onTimeUpdate={() => { const [t, d] = at(); onTime?.(Number(t) || 0); writer?.tick(t, d); }}
        onPause={writer ? () => { const [t, d] = at(); writer.flush(t, d); } : undefined}
        onEnded={writer ? () => { const [t, d] = at(); writer.flush(t, d); } : undefined}
      />
    </div>
  );
}

/**
 * LR4: chapters beside the player — the current one marked, and each a button
 * that seeks when the player can be seeked. None recorded says so.
 */
export function Chapters({ item, now = 0, onSeek = null }) {
  const chapters = chaptersOf(item);
  const current = chapterAt(chapters, now);
  return (
    <SectionCard title="Chapters" testid="lesson-chapters">
      {chapters.length ? (
        <ol className="lesson-chapters-list text-[12.5px]" data-testid="lesson-chapters-list">
          {chapters.map((c, i) => {
            const here = i === current;
            const cls = `lesson-chapter flex w-full gap-2 rounded-axal-sm px-1.5 py-1 text-left ${here ? 'bg-violet-50 font-semibold text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200' : 'text-axal-ink dark:text-gray-100'}`;
            const body = (<><span className="tabular-nums text-axal-muted dark:text-gray-400">{clockLabel(c.start)}</span><span>{c.title}</span></>);
            return (
              <li key={`${c.start}-${c.title}`}>
                {onSeek ? (
                  <button type="button" className={`${cls} hover:bg-axal-ground dark:hover:bg-gray-800`} aria-current={here ? 'true' : undefined} onClick={() => onSeek(c.start)} data-testid="button-chapter">{body}</button>
                ) : (
                  <span className={cls} aria-current={here ? 'true' : undefined} data-testid="text-chapter">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="lesson-chapters-none">
          <Unrecorded reason="No chapters are recorded for this video." /> · {NO_CHAPTERS}
        </p>
      )}
    </SectionCard>
  );
}

/**
 * LR4 and LR4b: the transcript below the player. A Stream video's ready caption
 * is read as timed cues — the current one marked, a click seeks — with a picker
 * when there is more than one language. Without cues the plain transcript is
 * shown and says why; without either, it says none is recorded.
 */
export function Transcript({ text, video, loadCaption = null, now = 0, onSeek = null }) {
  const choices = captionChoices(video);
  const [language, setLanguage] = useState(choices[0]?.language || null);
  const [read, setRead] = useState({ status: language && loadCaption ? 'loading' : 'none', cues: [] });
  // The page may pass a fresh loader each render; the read follows the language and the video, not the function.
  const loader = useRef(loadCaption);
  loader.current = loadCaption;
  const hasLoader = Boolean(loadCaption);
  const videoKey = video?.player?.src || video?.src || null;
  useEffect(() => {
    if (!language || !hasLoader) { setRead({ status: 'none', cues: [] }); return undefined; }
    let live = true;
    setRead({ status: 'loading', cues: [] });
    Promise.resolve().then(() => loader.current(language))
      .then((cues) => { if (live) setRead(Array.isArray(cues) && cues.length ? { status: 'ready', cues } : { status: 'none', cues: [] }); })
      .catch(() => { if (live) setRead({ status: 'unreadable', cues: [] }); });
    return () => { live = false; };
  }, [language, hasLoader, videoKey]);
  const current = read.status === 'ready' ? cueAt(read.cues, now) : -1;
  const picker = choices.length > 1 && loadCaption ? (
    <label className="mb-2 flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
      Transcript language
      <select value={language || ''} onChange={(e) => setLanguage(e.target.value)} className="rounded-axal-sm border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="select-transcript-language">
        {choices.map((c) => <option key={c.language} value={c.language}>{c.label}</option>)}
      </select>
    </label>
  ) : null;
  const plain = (line) => (text ? (
    <>
      <p className="mb-1.5 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="lesson-transcript-plain">{line}</p>
      <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300" data-testid="lesson-transcript-text">{text}</p>
    </>
  ) : (
    <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="lesson-transcript-none">
      <Unrecorded reason="No transcript is recorded for this video." /> · No transcript is recorded for this video.
    </p>
  ));
  let body;
  if (read.status === 'loading') body = <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="lesson-transcript-loading">Reading the captions…</p>;
  else if (read.status === 'ready') {
    body = (
      <ol className="max-h-80 space-y-0.5 overflow-y-auto text-[13px] leading-relaxed" data-testid="lesson-transcript-cues">
        {read.cues.map((c, i) => {
          const here = i === current;
          const cls = `flex w-full gap-2 rounded-axal-sm px-1.5 py-0.5 text-left ${here ? 'bg-violet-50 text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200' : 'text-gray-700 dark:text-gray-300'}`;
          const inner = (<><span className="shrink-0 tabular-nums text-[11.5px] text-axal-faint dark:text-gray-500">{clockLabel(c.start)}</span><span>{c.text}</span></>);
          return (
            <li key={`${c.start}-${i}`}>
              {onSeek ? (
                <button type="button" className={`${cls} hover:bg-axal-ground dark:hover:bg-gray-800`} aria-current={here ? 'true' : undefined} onClick={() => onSeek(c.start)} data-testid="button-cue">{inner}</button>
              ) : <span className={cls} aria-current={here ? 'true' : undefined} data-testid="text-cue">{inner}</span>}
            </li>
          );
        })}
      </ol>
    );
  } else body = plain(read.status === 'unreadable' ? CUES_UNREADABLE : PLAIN_TRANSCRIPT_LINE);
  return (
    <SectionCard title="Transcript" testid="lesson-transcript">
      {picker}
      {body}
    </SectionCard>
  );
}

/**
 * An uploaded file in the browser's own player (D561). `src` is the item's
 * gated stream route: the session cookie authenticates it and it answers
 * Range, so the player fetches the metadata first and seeks without loading
 * the whole file. A load that fails (the route refused it, the file is gone,
 * the connection dropped) is "Unreadable", never a black box that never
 * starts, and Retry loads it again.
 */
function StreamPlayer({ src, poster, label, startAt = null, onPosition = null, onTime = null, seeker = null }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // D3726 (#3726) LR4: resume where the member left off, and write the position
  // back at most every 15 s and on pause (`usePositionWriter`).
  const writer = usePositionWriter(onPosition, src);
  const seeked = useRef(false);
  const el = useRef(null);
  useEffect(() => {
    if (!seeker) return undefined;
    seeker.current = (t) => { try { if (el.current) el.current.currentTime = t; } catch { /* a player that cannot seek stays put */ } };
    return () => { seeker.current = null; };
  }, [seeker]);
  if (failed) return <VideoUnreadable onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }} />;
  return (
    <video
      key={attempt}
      ref={el}
      controls
      playsInline
      preload="metadata"
      src={src}
      poster={poster}
      onError={() => setFailed(true)}
      onLoadedMetadata={(e) => {
        if (seeked.current || startAt == null) return;
        seeked.current = true;
        try { e.currentTarget.currentTime = startAt; } catch { /* a player that cannot seek starts at 0 */ }
      }}
      onTimeUpdate={(e) => { onTime?.(e.currentTarget.currentTime || 0); writer?.tick(e.currentTarget.currentTime, e.currentTarget.duration); }}
      onPause={writer ? (e) => writer.flush(e.currentTarget.currentTime, e.currentTarget.duration) : undefined}
      onEnded={writer ? (e) => writer.flush(e.currentTarget.currentTime, e.currentTarget.duration) : undefined}
      className="aspect-video w-full bg-black"
      aria-label={label}
      data-testid="lesson-video"
    />
  );
}

/** The player's place when its file could not be loaded: a failed read, not an absent video. */
export function VideoUnreadable({ onRetry }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center bg-axal-ground px-6 dark:bg-gray-950" data-testid="lesson-video-unreadable">
      <LearningUnreadable what="The video" claim="This is not a claim that the video is gone." onRetry={onRetry} />
    </div>
  );
}

function ReadingArea({ body }) {
  const text = String(body ?? '').trim();
  if (!text) {
    return (
      <div className="p-4">
        <LearningEmpty title="No text yet" body={<><Unrecorded reason="This reading has no text published yet." /><span className="mt-1 block">This reading has no text published yet.</span></>} />
      </div>
    );
  }
  return (
    <article className="prose prose-sm mx-auto max-w-[680px] p-4 dark:prose-invert sm:p-5" data-testid="lesson-reading">
      <ReactMarkdown>{text}</ReactMarkdown>
    </article>
  );
}
