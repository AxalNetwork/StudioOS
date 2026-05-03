import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { GraduationCap, ArrowLeft } from 'lucide-react';

// Phase 0.2 — Minimal academy lesson route. The full Academy LMS is a
// downstream task; this page exists so cmd-K hits to academy lessons
// resolve to a real route rather than a 404. When the LMS lands it
// will replace this with a content-rendering surface.
export default function AcademyLessonPage() {
  const { slug } = useParams();
  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 mb-4">
        <ArrowLeft size={14} /> Back to dashboard
      </Link>
      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center">
            <GraduationCap size={20} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500">Academy lesson</div>
            <h1 className="text-xl font-semibold text-gray-900">{slug || 'Lesson'}</h1>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          The full Academy experience is coming soon. This lesson stub is
          here so global search results have a place to land.
        </p>
      </div>
    </div>
  );
}
