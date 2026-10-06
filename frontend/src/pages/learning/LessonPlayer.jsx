import React from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import { LearningEmpty, SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, durationLabel, lessonKindLabel } from './learningModel';

/**
 * One lesson: a video or a reading, a transcript panel, previous and next, and
 * "Mark complete" (D562; data #1158, playback #1162).
 *
 * Props, in the shapes the issues plan:
 *   status     'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   lesson     { uid, title, kind: 'video' | 'reading' }            (#1158 learning_lessons)
 *   item       { uid, kind, title, body, duration_seconds, thumbnail_url } (#1158 GET /items/:uid)
 *   video      { src, embed } or null: the playable source the page resolves —
 *              #1162's gated stream for an uploaded file, the allow-listed
 *              link (YouTube, Vimeo, Stream) for a linked one, which embeds
 *   moduleTitle, position ("5 of 12")
 *   prev, next { title, href } or null
 *   completed  the member's own progress on this lesson (#1158)
 *   onMarkComplete, marking
 *
 * NO TRANSCRIPT IS PLANNED. The canvas draws an auto-generated transcript, and
 * no column in #1158 holds one, so the panel says "Not recorded" with its
 * reason instead of inventing lines (D562 GAPS).
 *
 * "Mark complete" is disabled until a page passes the handler, which it does
 * once #1158's `POST /api/learning/progress` exists. A button that looked live
 * and saved nothing would be the dead control D17 refuses.
 */
export default function LessonPlayer({
  status, lesson, item, video, moduleTitle, position, prev, next,
  completed = false, onMarkComplete, marking = false, reason = NOT_LIVE.catalogue, onRetry,
}) {
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
  return (
    <div className="space-y-4" data-testid="lesson-player">
      <Card padding="none" className="overflow-hidden">
        {kind === 'video' ? <VideoArea video={video} item={item} length={length} /> : <ReadingArea body={item?.body} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-axal-faint dark:text-gray-500">
              <Pill tone="info">{lessonKindLabel(kind)}</Pill>
              {moduleTitle && <span>{moduleTitle}</span>}
              {position && <span className="tabular-nums">· lesson {position}</span>}
              {length && <span className="tabular-nums">· {length}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StepLink step={prev} dir="prev" />
            <StepLink step={next} dir="next" />
            {completed ? (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="text-lesson-completed">
                <Check size={14} aria-hidden="true" /> Completed
              </span>
            ) : (
              <button
                type="button"
                onClick={onMarkComplete}
                disabled={!onMarkComplete || marking}
                title={onMarkComplete ? undefined : 'Progress cannot be saved until the Learning service is live.'}
                className="rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-mark-complete"
              >
                {marking ? 'Saving…' : 'Mark complete'}
              </button>
            )}
          </div>
        </div>
      </Card>
      {kind === 'video' && (
        <SectionCard title="Transcript" testid="lesson-transcript">
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
            <Unrecorded reason="No transcript is stored for a lesson." /> · No transcript is stored for a lesson.
          </p>
        </SectionCard>
      )}
    </div>
  );
}

function VideoArea({ video, item, length }) {
  if (!video?.src) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-axal-ground px-6 text-center text-[12.5px] text-axal-muted dark:bg-gray-950 dark:text-gray-400" data-testid="lesson-video-absent">
        <span><Unrecorded reason="This video has no playable source yet." /> · This video has no playable source yet.</span>
      </div>
    );
  }
  if (video.embed) {
    return (
      <iframe
        src={video.src}
        title={item?.title || 'Lesson video'}
        className="aspect-video w-full border-0 bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        data-testid="lesson-video-embed"
      />
    );
  }
  return (
    <video
      controls
      preload="metadata"
      src={video.src}
      poster={item?.thumbnail_url || undefined}
      className="aspect-video w-full bg-black"
      aria-label={`${item?.title || 'Lesson video'}${length ? `, ${length}` : ''}`}
      data-testid="lesson-video"
    />
  );
}

function ReadingArea({ body }) {
  const text = String(body ?? '').trim();
  if (!text) {
    return (
      <div className="p-4">
        <LearningEmpty title="No text yet" body="This reading has no text published yet." />
      </div>
    );
  }
  return (
    <article className="prose prose-sm max-w-none p-5 dark:prose-invert" data-testid="lesson-reading">
      <ReactMarkdown>{text}</ReactMarkdown>
    </article>
  );
}

function StepLink({ step, dir }) {
  const label = dir === 'prev' ? 'Previous' : 'Next';
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  const cls = 'inline-flex items-center gap-1 rounded-axal-sm border border-axal-hairline px-2.5 py-1.5 text-[12.5px] font-medium dark:border-gray-700';
  if (!step?.href) {
    return <span className={`${cls} text-axal-faint dark:text-gray-600`} aria-disabled="true">{dir === 'prev' && <Icon size={13} aria-hidden="true" />}{label}{dir === 'next' && <Icon size={13} aria-hidden="true" />}</span>;
  }
  return (
    <Link to={step.href} className={`${cls} text-axal-ink hover:border-axal-violet/40 dark:text-gray-200`} title={step.title || undefined} data-testid={`link-lesson-${dir}`}>
      {dir === 'prev' && <Icon size={13} aria-hidden="true" />}{label}{dir === 'next' && <Icon size={13} aria-hidden="true" />}
    </Link>
  );
}
