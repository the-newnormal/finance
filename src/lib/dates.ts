/** Today's date in Singapore, as YYYY-MM-DD. */
export function singaporeToday(now: Date = new Date()): string {
  return singaporeDate(now);
}

/** A moment's calendar date in Singapore, as YYYY-MM-DD. */
export function singaporeDate(at: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date(at));
}
