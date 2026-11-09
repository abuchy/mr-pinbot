export function isBlockedMetadata(value: unknown): boolean {
  return typeof value === "string" &&
    /^(?:(?:http\s+)?(?:401|403|429|503)\s*[:–—-]?\s*)?(?:page blocked|access denied|access forbidden|forbidden|request blocked|request rejected|unauthorized|too many requests|service unavailable|just a moment|attention required|verify (?:that )?you are human)(?:$|[\s.!:|–—-])/i.test(value.trim());
}
