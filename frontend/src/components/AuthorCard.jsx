import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, MapPin, UserCircle } from 'lucide-react';
import { safeExternalUrl } from '../lib/url';
import BrandIcon from '../ui/BrandIcon.jsx';

function GlobeIcon({ size = 16 }) {
  return <Globe width={size} height={size} />;
}

// D687: each brand mark is BrandIcon's one copy, drawn in the link's colour.
const brandMark = (key) => function BrandMark({ size = 16 }) {
  return <BrandIcon provider={key} size={size} variant="bare" tone="current" />;
};

export const SOCIALS = [
  { key: 'linkedin',  label: 'LinkedIn',  Icon: brandMark('linkedin') },
  { key: 'twitter',   label: 'X',         Icon: brandMark('twitter') },
  { key: 'website',   label: 'Website',   Icon: GlobeIcon },
  { key: 'github',    label: 'GitHub',    Icon: brandMark('github') },
  { key: 'instagram', label: 'Instagram', Icon: brandMark('instagram') },
];

/**
 * Shared author card / byline component.
 *
 * Props
 *   author   — { name, headline, bio, headshot_url, socials, location, role }
 *   compact  — compact inline byline variant for article reader (default false)
 *   userId   — numeric user ID for profile link (compact variant)
 */
export default function AuthorCard({ author, compact = false, userId = null }) {
  if (!author) return null;

  const activeSocials = SOCIALS.filter(({ key }) => author.socials?.[key]);

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
          {author.headshot_url ? (
            <img
              src={author.headshot_url}
              alt={author.name || 'Author'}
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <UserCircle className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          )}
        </div>
        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2">
          {author.name && (
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {userId ? (
                <Link to={`/authors/${userId}`} className="hover:text-violet-700 hover:underline">
                  {author.name}
                </Link>
              ) : author.name}
            </span>
          )}
          {author.headline && (
            <span className="text-sm text-slate-500 dark:text-slate-400">{author.headline}</span>
          )}
        </div>
        {activeSocials.length > 0 && (
          <div className="flex items-center gap-2">
            {activeSocials.map(({ key, label, Icon }) => (
              <a
                key={key}
                href={safeExternalUrl(author.socials[key])}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition"
              >
                <Icon size={14} />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-start gap-6">
      <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
        {author.headshot_url ? (
          <img
            src={author.headshot_url}
            alt={author.name || 'Author'}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <UserCircle className="w-12 h-12 text-slate-400 dark:text-slate-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {author.name && (
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              {author.name}
            </h1>
          )}
          {author.headline && (
            <span className="text-base text-slate-500 dark:text-slate-400">{author.headline}</span>
          )}
        </div>
        {author.role && (
          <div className="mt-1">
            <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 capitalize">
              {author.role}
            </span>
          </div>
        )}
        {author.location && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{author.location}</span>
          </div>
        )}
        {author.company && (
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{author.company}</div>
        )}
        {author.bio && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
            {author.bio}
          </p>
        )}
        {activeSocials.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {activeSocials.map(({ key, label, Icon }) => (
              <a
                key={key}
                href={safeExternalUrl(author.socials[key])}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-400 transition"
              >
                <Icon size={15} />
                <span>{label}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
