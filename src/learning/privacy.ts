import { extractCriticalValues } from "@/counter/integrity";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /https?:\/\/[^\s]+/gi;
const KOREAN_ID = /\b\d{6}-?[1-4]\d{6}\b/g;
const LONG_IDENTIFIER = /\b[A-Z]{1,3}\d{6,12}\b/gi;
const HANGUL_LABELLED_NAME = /((?:제\s*)?이름(?:은|이)?|성명(?:은|이)?|저는|나는)\s*([가-힣]{2,5})/g;
const HANGUL_HONORIFIC_NAME = /([가-힣]{2,4})\s*(씨|님)(?=[이가은는을를와과,.\s]|$)/g;

const tokenFor = (kind: string): string => `[${kind.toUpperCase().replace(/-/g, "_")}]`;

/**
 * Remove values that could turn a translation example back into a person.
 * This is deliberately deterministic and conservative: learning utility loses
 * a little context so the vault never needs the raw identity-bearing turn.
 */
export function redactForLearning(text: string): {
  text: string;
  redacted: boolean;
  kinds: string[];
} {
  let value = text;
  const kinds = new Set<string>();

  const critical = extractCriticalValues(text).sort((a, b) => b.text.length - a.text.length);
  for (const item of critical) {
    if (!item.text) continue;
    const token = tokenFor(item.kind);
    if (value.includes(item.text)) {
      value = value.split(item.text).join(token);
      kinds.add(item.kind);
    }
  }

  const replace = (pattern: RegExp, token: string, kind: string) => {
    const next = value.replace(pattern, token);
    if (next !== value) kinds.add(kind);
    value = next;
  };

  replace(EMAIL, "[EMAIL]", "email");
  replace(URL, "[URL]", "url");
  replace(KOREAN_ID, "[IDENTIFIER]", "identifier");
  replace(LONG_IDENTIFIER, "[IDENTIFIER]", "identifier");

  const labelled = value.replace(
    HANGUL_LABELLED_NAME,
    (_match, label: string) => `${label} [NAME]`,
  );
  if (labelled !== value) kinds.add("name");
  value = labelled;

  const honorific = value.replace(
    HANGUL_HONORIFIC_NAME,
    (_match, _name: string, suffix: string) => `[NAME]${suffix}`,
  );
  if (honorific !== value) kinds.add("name");
  value = honorific;

  return {
    text: value.replace(/\s+/g, " ").trim(),
    redacted: value !== text,
    kinds: [...kinds].sort(),
  };
}
