/** Minimal class-name join. No dependency needed for what this app does. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
