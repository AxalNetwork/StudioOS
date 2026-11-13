/** Types for the X text parser surface StudioOS uses (#5290). */
declare module 'twitter-text' {
  const twitterText: { parseTweet(text: string): { weightedLength: number } };
  export default twitterText;
}
