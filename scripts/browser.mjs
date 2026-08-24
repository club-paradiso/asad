/**
 * Resolve a Chromium for the browser-driven scripts.
 *
 * The dev sandbox ships a prebuilt Chromium at a fixed path and blocks
 * Playwright from downloading its own; a GitHub runner is the opposite, with no
 * such path and `playwright install` available. Hard-coding either one breaks
 * the other, which is exactly what kept `npm run e2e` out of CI.
 *
 * So: use CHROMIUM_PATH if set, else the sandbox build if it is actually there,
 * else let Playwright resolve whatever it installed.
 */
import { existsSync } from "node:fs";

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";

export function chromiumLaunchOptions(extra = {}) {
  const explicit = process.env.CHROMIUM_PATH?.trim();
  const executablePath = explicit || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);
  return executablePath ? { executablePath, ...extra } : { ...extra };
}
