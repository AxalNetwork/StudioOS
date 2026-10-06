import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const LearningPage = lazy(() => import('../pages/learning/LearningPage'));

/**
 * The Learning center (D562, issue #1163): every Learning route, one page
 * component with a `view` per route. Learning is a new area, so its routes
 * live in this module (D528) rather than in `App.jsx`.
 *
 * THE GATES. The learner routes admit every signed-in profile, `exploring`
 * included. The user menu's "Learning" replaced "Articles", and the article
 * pages answer every visitor, so a guard that turned `exploring` away took the
 * menu's articles from it. The gate still shows that profile Articles and
 * "coming soon" for the rest. The program view is an admin's (#1159's
 * assigned admin; the Super Admin is an admin too). The studio and its
 * programs are the Super Admin's: `guard(['admin'], hqOnly(…))`, the gate every
 * HQ-only surface in `App.jsx` uses, so a plain admin reads the stated
 * boundary rather than a page whose every action would 403.
 *
 * `user` and `effectiveRole` go to the page for the coming-soon gate
 * (`pages/learning/learningAccess.js`), which asks about the role being
 * browsed, as `RoleGuard` does.
 *
 * A STANDALONE VIDEO OR READING HAS TWO ADDRESSES, ONE PAGE. `/learning/videos/:uid`
 * is the video's own (stage 2's brief), and `/learning/items/:uid` is the
 * href D557's catalog sends for every item, a reading included, so a link the
 * route hands out never lands on the 404.
 */
export default function learningRoutes({ guard, hqOnly, user, effectiveRole }) {
  return (
    <>
      <Route path="/learning" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="home" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/courses/:slug" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="course" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/courses/:slug/:lesson" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="lesson" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/videos/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="item" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/items/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="item" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/webinars/:slug" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="webinar" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/exercises/:slug" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="exercise" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/exams/:slug" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="exam" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/me" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <LearningPage view="me" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/programs" element={guard(['admin'], <LearningPage view="programs" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/programs/:program" element={guard(['admin'], <LearningPage view="program" user={user} activeRole={effectiveRole} />)} />
      <Route path="/learning/studio" element={guard(['admin'], hqOnly(<LearningPage view="studio" user={user} activeRole={effectiveRole} />))} />
      <Route path="/learning/studio/programs" element={guard(['admin'], hqOnly(<LearningPage view="studioPrograms" user={user} activeRole={effectiveRole} />))} />
      <Route path="/learning/studio/programs/:program" element={guard(['admin'], hqOnly(<LearningPage view="studioProgram" user={user} activeRole={effectiveRole} />))} />
    </>
  );
}
