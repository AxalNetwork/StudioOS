export default {
  id: 'changelog',
  title: "What's new",
  icon: 'History',
  subsections: [
    {
      id: 'release-notes',
      title: "What's new",
      overview:
        "A plain-English summary of recent changes to StudioOS, written for everyone using the platform. New items are added at the top. The detailed engineering log (with task IDs and code references) lives on GitHub.",
      markdownUrl: '/CHANGELOG-user.md',
      tips: [
        'Use Ctrl/Cmd-F to search the page for a feature name or month.',
        'Looking for technical detail? Each release has a matching entry in the GitHub changelog linked at the top of the page.',
      ],
    },
  ],
};
