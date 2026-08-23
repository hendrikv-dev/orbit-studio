/**
 * Tonight's canonical ranking, and the one place it is allowed to be decided.
 *
 * ## The bug this exists to make impossible
 *
 * Rank used to be the row's index at render time. Separately, the ranked list
 * was reordered to hoist whatever shared the open event's category to the top.
 * Either alone would have been survivable. Together they meant that opening
 * Saturn made Saturn rank 1, and opening Meteors made Meteors rank 1 — the
 * number moved because the reader navigated, not because the sky changed.
 *
 * For a product whose entire claim is "here is what is most worth looking at",
 * that is not a display bug. It is the claim being false.
 *
 * So ranking is a function, it is called once per set of observation inputs,
 * and the number it returns is carried to the view. The view chooses what to
 * *show* and in what order to show it; it never chooses what to *call* it.
 *
 * ## The invariant
 *
 * For a fixed set of scored events, `rankTonight` is a pure function of those
 * events. Nothing about selection, navigation, filtering, drill-ins or history
 * is an input to it, and there is no overload that takes one. That is enforced
 * by the signature rather than by discipline, which is the point of extracting
 * it: a caller cannot pass the selection in, because there is nowhere to put it.
 */

/** The minimum an event must carry to be ranked. */
export interface RankableEvent {
  id: string;
  /** Ordering value, higher is better. */
  strength: number;
}

export type Ranked<T extends RankableEvent> = T & {
  /** Canonical position, 1-based. */
  rank: number;
};

/**
 * Sorts by strength and assigns positions.
 *
 * Ties break on `id` rather than being left to the sort's stability, so two
 * events of identical strength cannot swap ranks between renders because their
 * input order happened to differ. A rank that flickers is a rank nobody can
 * trust, even when it is not navigation causing it.
 */
export function rankTonight<T extends RankableEvent>(events: T[]): Ranked<T>[] {
  return [...events]
    .sort((left, right) =>
      right.strength === left.strength
        ? left.id.localeCompare(right.id)
        : right.strength - left.strength,
    )
    .map((event, index) => ({ ...event, rank: index + 1 }));
}

/**
 * Which rows to show, without touching what they are called.
 *
 * The list is capped, so a selected event can fall outside it. The rule is
 * append, never promote: a reader who opens the ninth-ranked object should be
 * able to see it in the list, still labelled ninth. Promoting it to the top
 * would be the original bug wearing a different hat.
 */
export function visibleRanked<T extends RankableEvent>(
  ranked: Ranked<T>[],
  selectedId: string | null,
  limit: number,
): Ranked<T>[] {
  const visible = ranked.slice(0, limit);
  if (!selectedId) return visible;
  if (visible.some((event) => event.id === selectedId)) return visible;
  const selected = ranked.find((event) => event.id === selectedId);
  return selected ? [...visible, selected] : visible;
}
