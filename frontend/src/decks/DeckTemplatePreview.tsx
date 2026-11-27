import { Thumbnail } from './Thumbnail';
import type { DeckData } from './DeckBase';
import { TEMPLATES } from './templates';

interface DeckTemplatePreviewProps {
  templateKey: string;
  data?: DeckData | null;
  slideIndex?: number;
}

/** A catalogue cover or slide rendered by the same component as the deck. */
export default function DeckTemplatePreview({ templateKey, data, slideIndex }: DeckTemplatePreviewProps) {
  const template = Object.hasOwn(TEMPLATES, templateKey) ? TEMPLATES[templateKey] : null;
  if (!template) {
    return <span className="text-xs text-axal-muted dark:text-gray-400">Preview unavailable</span>;
  }

  return (
    <figure className="m-0 w-full">
      <Thumbnail key={template.key} template={template} data={data} slideIndex={slideIndex} />
      {!data && (
        <figcaption className="mt-1 text-xs text-axal-muted dark:text-gray-400">Fictional sample</figcaption>
      )}
    </figure>
  );
}
