/**
 * Room codes.
 *
 * Four characters from an alphabet with no visually or audibly confusable
 * pairs. A staff member has to be able to read the code out across a counter
 * to someone who does not speak their language, and a visitor has to be able to
 * type it if the camera fails — so `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` are all
 * excluded.
 *
 * 25^4 = 390,625 combinations, which is far more than the handful of sessions
 * a venue runs concurrently. Collisions are resolved by retrying, not by adding
 * length.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export const CODE_LENGTH = 4;
export const CODE_PREFIX = "TY";

/** Cryptographically random where available; `Math.random` is not good enough
 *  for something that gates access to a conversation. */
function randomIndices(count: number, max: number): number[] {
  const out: number[] = [];
  const globalCrypto = globalThis.crypto;
  if (globalCrypto?.getRandomValues) {
    const bytes = new Uint8Array(count * 2);
    globalCrypto.getRandomValues(bytes);
    // Rejection-free modulo bias is not a concern at this scale, but use two
    // bytes per index so the bias is negligible.
    for (let i = 0; i < count; i += 1) {
      out.push(((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % max);
    }
    return out;
  }
  for (let i = 0; i < count; i += 1) out.push(Math.floor(Math.random() * max));
  return out;
}

export function generateCode(): string {
  return randomIndices(CODE_LENGTH, ALPHABET.length)
    .map((i) => ALPHABET[i])
    .join("");
}

/** `TY-4821` — the form shown on screen and spoken aloud. */
export const formatCode = (code: string): string => `${CODE_PREFIX}-${code}`;

const isCode = (value: string): boolean =>
  value.length === CODE_LENGTH && [...value].every((char) => ALPHABET.includes(char));

/**
 * Accept anything a human might type: with or without the prefix, any case,
 * with or without the hyphen or spaces.
 *
 * The bare form is tested BEFORE the prefix is stripped, because `T` and `Y`
 * are both in the alphabet and a generated code can therefore begin with `TY`.
 * Stripping first would mangle roughly one code in 625 into two characters and
 * reject it — a visitor holding a perfectly valid code, unable to get in.
 */
export function normaliseCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]+/g, "");
  if (isCode(cleaned)) return cleaned;

  const unprefixed = cleaned.startsWith(CODE_PREFIX)
    ? cleaned.slice(CODE_PREFIX.length)
    : cleaned;
  return isCode(unprefixed) ? unprefixed : null;
}

/** The URL a QR code encodes. Short, because QR density matters at a distance. */
export const joinUrl = (origin: string, code: string): string =>
  `${origin.replace(/\/$/, "")}/c/${code}`;
