import { chunkTranslation } from "@/lib/chunk-text";
import { interpreterOutputSchema } from "@/lib/schema";
import { isEnglishTranslation, localRuntime } from "./runtime";

export const LOCAL_TRANSLATION_PROVIDER = "local-onnx";
export const LOCAL_TRANSLATION_MODEL = "Xenova/opus-mt-ko-en";

const WON = /(\d[\d,]*)\s*원(?=(?:을|를|으로|은|이|에|입니다|만|부터|까지)?(?:[\s,.!?]|$))/g;

export function prepareLocalTranslation(source: string) {
  const amounts = new Set<string>();
  const text = source.replace(WON, (_, raw: string) => {
    const amount = raw.replace(/,/g, "");
    amounts.add(amount);
    return `${amount} 한국 원`;
  });
  return {
    text,
    accepts(english: string) {
      if (!isEnglishTranslation(source, english)) return false;
      const amountsInEnglish = [...english.matchAll(
        /\b(?:([\d,]+)\s+(?:South Korean |Korean )?(?:won|KRW)|(?:won|KRW)\s+([\d,]+))\b/gi,
      )].map((match) => (match[1] ?? match[2]).replace(/,/g, ""));
      return [...amounts].every((amount) => amountsInEnglish.includes(amount));
    },
  };
}

export async function translateLocally(text: string, signal: AbortSignal) {
  if (localRuntime.snapshot().translation.status !== "ready" || signal.aborted) return null;
  try {
    const preparation = prepareLocalTranslation(text);
    const { text: english, reply } = await localRuntime.run("translation", preparation.text, signal);
    if (signal.aborted || !preparation.accepts(english)) return null;
    const parsed = interpreterOutputSchema.safeParse({
      safeChunks: chunkTranslation(english).map((line) => ({ text: line, confidence: "low" })),
      confidence: "low",
    });
    if (!parsed.success || !parsed.data.safeChunks.length) return null;
    localRuntime.record("translation", reply);
    return parsed.data;
  } catch {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return null;
  }
}
