export default function AccountCard({ title, description, children, footer, id, cardRef }) {
  return (
    <div ref={cardRef} id={id} data-card className="scroll-mt-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div data-card-header className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      <div data-card-body className="p-5">{children}</div>
      {footer && <div data-card-footer className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">{footer}</div>}
    </div>
  );
}

