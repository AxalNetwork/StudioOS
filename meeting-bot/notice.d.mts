/** Shared B9 notice contract for Worker callers. */
export const MEETING_BOT_NAME: 'Eadwyn AI';
export const MEETING_BOT_NOTICE_VERSION: 2;
export const MEETING_BOT_NOTICE_PATH: '/privacy/interviews';
export const MEETING_BOT_NOTICE_APPROVED_AT: string | null;
export const MEETING_BOT_NOTICE_PUBLISHED: boolean;
export const MEETING_BOT_DISPATCH_DISCLOSURE: string;
export function meetingBotNotice(input?: { ventureName?: string | null }): string;
export function draftMeetingBotNotice(input?: { ventureName?: string | null }): string;
