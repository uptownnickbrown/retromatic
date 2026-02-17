// Get today's date as YYYY-MM-DD in US Eastern Time.
// The game day resets at midnight ET, not UTC.
export function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
