export default {
  id: 'changelog',
  title: 'Changelog',
  icon: 'History',
  subsections: [
    {
      id: 'release-notes',
      title: 'Release notes',
      overview:
        "A running log of every notable change shipped to StudioOS — features, fixes, security updates, and operator-facing notes. Entries are appended newest-first and reference the originating task or commit so you can trace anything back to the underlying work.",
      markdownUrl: '/CHANGELOG.md',
      tips: [
        'Use Ctrl/Cmd-F to search the page for a feature name or date if you remember roughly when something shipped.',
        'Each entry links to the relevant section of the app — click through to see the feature in its current form.',
      ],
    },
  ],
};
