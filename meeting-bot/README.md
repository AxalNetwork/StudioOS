# meeting-bot — the visible meeting participant

The runtime for D886 (#2577) belongs here. B2 (#2580) builds the lifecycle;
B3–B5 supply Zoom, Google Meet and Microsoft Teams adapters; B8 deploys it.
The host and runtime packaging follow B0 (#2578), rather than this folder
choosing a host before that study lands.

`notice.mjs` is B9's dependency-free notice contract. Import `meetingBotNotice`
and `MEETING_BOT_NAME` from it. The caller supplies the authorized venture's
display name, never a meeting link, passcode or instructions from chat.
The gated function refuses while `MEETING_BOT_NOTICE_PUBLISHED` is false.
The public page uses that same publication gate. The announcement links to
the matching notice version, not the default legacy page. B1 must refuse
dispatch and scheduled starts while this gate is false, even in canary.
`draftMeetingBotNotice` is for tests and approval previews only; it is never
the runtime entry. Publishing requires B1/B2/B6 safeguards to be verified.
Set the actual `MEETING_BOT_NOTICE_APPROVED_AT` date after approval and those
checks. A valid date derives the shared publication gate, publishes version 2,
makes it current and supplies the page's update date together. A missing or
invalid date cannot publish. Legacy chat-consent links retain version 1.

After publication the notice returns plain text. B2 posts it once after
admission and before capturing audio. B2 owns the durable once-only record, failure handling and
the stop/leave behavior; importing this module implements none of those.

The founder has already confirmed recording consent before dispatch. The
announcement does not obtain that agreement. B7 imports the same module's
`MEETING_BOT_DISPATCH_DISCLOSURE` beside D757's existing consent control;
`MeetingBotConsentNotice.jsx` is its presentational wrapper.

Owner steps, failure codes and live checks are in
`documentation/operations/MEETING_BOT.md`. Never print meeting URLs,
credentials, display names, roster contents or transcript text in logs or
GitHub reports. Report counts and states only.
