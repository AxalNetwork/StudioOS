import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText, Globe, UserCircle, Twitter, Linkedin } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

function ArticleCard({ a }) {
  return (
    <Link
      to={`/articles/${a.slug}`}
      className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition flex flex-col hover:border-violet-400 dark:hover:border-violet-600"
    >
      {a.cover_url ? (
        <img
          src={a.cover_url}
          alt=""
          className="w-full aspect-[16/9] object-cover bg-slate-100 dark:bg-slate-800"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div className="w-full aspect-[16/9] bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600" />
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          {a.sector && <span>{a.sector.replace(/_/g, ' ')}</span>}
          {a.sector && a.read_minutes ? <span>·</span> : null}
          {a.read_minutes ? <span>{a.read_minutes} min read</span> : null}
        </div>
        <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-violet-300 line-clamp-2">
          {a.title}
        </h3>
        {a.subtitle && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{a.subtitle}</p>
        )}
      </div>
    </Link>
  );
}

export default function AuthorProfilePage() {
  const { userId } = useParams();
  const [author, setAuthor] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setErr('Invalid author ID');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await api.byAuthor(id);
        setItems(r.items || []);
        // Derive author metadata from the first article if available.
        const first = (r.items || [])[0];
        if (first) {
          setAuthor({
            name: first.author,
            role: first.author_role,
            website: first.author_website,
            bio: first.author_bio ?? null,
            twitter: first.author_twitter ?? null,
            linkedin: first.author_linkedin ?? null,
            photo_url: first.author_photo_url ?? null,
          });
        } else {
          setAuthor(null);
        }
      } catch (e) {
        reportError('AuthorProfile:byAuthor', e);
        setErr('Failed to load author profile');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <PublicNav />
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur pt-16">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <Link to="/articles" className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-violet-700 transition">
            <ArrowLeft className="w-4 h-4" /> All articles
          </Link>
        </div>
      </div>
      <main className="flex-1 w-full">
        {loading && (
          <div className="text-center text-slate-500 py-20 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" /> Loading…
          </div>
        )}
        {err && (
          <div className="text-center py-20">
            <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-600 dark:text-slate-400">{err}</p>
            <Link to="/articles" className="mt-4 inline-block text-violet-600 hover:underline">Back to articles</Link>
          </div>
        )}
        {!loading && !err && (
          <div className="max-w-7xl mx-auto px-6 py-10">
            {/* Author header */}
            <div className="mb-10">
              <div className="flex items-start gap-4">
                {/* Avatar: photo when set, UserCircle placeholder otherwise */}
                <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                  {author?.photo_url ? (
                    <img
                      src={author.photo_url}
                      alt={author.name || 'Author'}
                      className="w-16 h-16 object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                    />
                  ) : null}
                  {!author?.photo_url && (
                    <UserCircle className="w-10 h-10 text-slate-400 dark:text-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-bold">{author?.name || 'Unknown author'}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    {author?.role && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        {author.role}
                      </span>
                    )}
                    {author?.website && (
                      <a href={author.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-violet-700 dark:hover:text-violet-400 hover:underline">
                        <Globe className="w-3.5 h-3.5" /> Website
                      </a>
                    )}
                    {author?.twitter && (
                      <a href={author.twitter} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-violet-700 dark:hover:text-violet-400 hover:underline">
                        <Twitter className="w-3.5 h-3.5" /> X / Twitter
                      </a>
                    )}
                    {author?.linkedin && (
                      <a href={author.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-violet-700 dark:hover:text-violet-400 hover:underline">
                        <Linkedin className="w-3.5 h-3.5" /> LinkedIn
                      </a>
                    )}
                  </div>
                  {author?.bio && (
                    <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                      {author.bio}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {/* Articles grid */}
            {items.length > 0 ? (
              <section>
                <h2 className="text-lg font-semibold mb-6 text-slate-900 dark:text-slate-100">
                  Published articles
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {items.map((a) => (
                    <ArticleCard key={a.id} a={a} />
                  ))}
                </div>
              </section>
            ) : (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p>No published articles yet.</p>
              </div>
            )}
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
