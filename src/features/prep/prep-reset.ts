import type { PrepSheet } from "@/types";
import { emptyPrepSheet } from "@/types";

export function hasPrepContent(prep: PrepSheet): boolean {
  return Boolean(
    prep.speaker?.trim() ||
      prep.title?.trim() ||
      prep.organisation?.trim() ||
      prep.scripture?.trim() ||
      prep.notes?.trim() ||
      prep.outline?.trim() ||
      prep.glossary.length > 0 ||
      prep.entities.length > 0,
  );
}

/**
 * A new service gets a new Prep sheet. App settings and saved sessions live in
 * different stores and are deliberately outside this reset boundary.
 */
export function freshPrepSheet(): PrepSheet {
  return emptyPrepSheet();
}
