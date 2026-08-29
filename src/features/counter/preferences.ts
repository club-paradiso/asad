/** Safe, non-conversational preferences for repeat Counter use. */
import { findLanguage } from "@/counter/languages";
import { createLocalStore } from "@/lib/local-store";

export interface CounterPreferences {
  configured: boolean;
  hostLang: string;
  deskLabel: string;
}

const FALLBACK: CounterPreferences = {
  configured: false,
  hostLang: "ko-KR",
  deskLabel: "",
};

const STORAGE_KEY = "tong-yuck:counter-preferences:v1";

export const counterPreferencesStore = createLocalStore<CounterPreferences>({
  fallback: FALLBACK,
  read: () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return FALLBACK;
      const value = JSON.parse(raw) as Partial<CounterPreferences>;
      return {
        configured: value.configured === true,
        hostLang:
          typeof value.hostLang === "string" && findLanguage(value.hostLang)
            ? value.hostLang
            : FALLBACK.hostLang,
        deskLabel:
          typeof value.deskLabel === "string" ? value.deskLabel.slice(0, 60) : "",
      };
    } catch {
      return FALLBACK;
    }
  },
  write: (value) => {
    try {
      // Only these UI preferences are persisted. Never add transcript,
      // translation, room code, visitor data, or message history here.
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          configured: value.configured,
          hostLang: value.hostLang,
          deskLabel: value.deskLabel.slice(0, 60),
        } satisfies CounterPreferences),
      );
    } catch {
      // Private browsing and managed devices may reject localStorage.
    }
  },
});

export { STORAGE_KEY as COUNTER_PREFERENCES_STORAGE_KEY };
