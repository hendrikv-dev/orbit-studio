import { describe, expect, it } from "vitest";
import { rankTonight, visibleRanked, type RankableEvent } from "./tonightRanking";

/**
 * The invariant these tests exist for.
 *
 * Tracker's whole claim is that it answers "what is most worth looking at from
 * here tonight". That answer must be a function of the night, not of which page
 * the reader happens to have open. It was not: rank was the row's index and the
 * list was reordered around the open event, so opening Saturn made Saturn
 * first and opening Meteors made Meteors first.
 */

/**
 * A night with a clear, deliberately non-alphabetical order.
 *
 * The values are priorities rather than raw strengths: ordering moved onto the
 * significance band when novelty was introduced, so a routine target with a
 * high strength can sit below an unusual one. `rankTonight` only ever sees the
 * final ordering value, which is what these fixtures are.
 */
const NIGHT: RankableEvent[] = [
  { id: "saturn", priority: 0.61 },
  { id: "mars", priority: 0.55 },
  { id: "jupiter", priority: 0.52 },
  { id: "meteors", priority: 0.41 },
  { id: "moon", priority: 0.33 },
  { id: "aurora", priority: -0.5 },
  { id: "mercury", priority: 0.18 },
  { id: "neptune", priority: 0.16 },
];

const EXPECTED = ["saturn", "mars", "jupiter", "meteors", "moon", "mercury", "neptune", "aurora"];

describe("tonight's canonical ranking", () => {
  it("orders by priority, highest first", () => {
    expect(rankTonight(NIGHT).map((event) => event.id)).toEqual(EXPECTED);
  });

  it("numbers from one, with no gaps and no repeats", () => {
    const ranks = rankTonight(NIGHT).map((event) => event.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not depend on the order the events arrive in", () => {
    // Otherwise the ranking would change when an upstream list is rebuilt in a
    // different order for reasons that have nothing to do with the sky.
    const shuffled = [...NIGHT].reverse();
    expect(rankTonight(shuffled).map((event) => event.id)).toEqual(EXPECTED);
  });

  it("breaks ties deterministically rather than leaving them to sort stability", () => {
    const tied: RankableEvent[] = [
      { id: "beta", priority: 0.4 },
      { id: "alpha", priority: 0.4 },
    ];
    expect(rankTonight(tied).map((event) => event.id)).toEqual(["alpha", "beta"]);
    expect(rankTonight([...tied].reverse()).map((event) => event.id)).toEqual(["alpha", "beta"]);
  });

  it("has no way to be told what is selected", () => {
    // The structural guarantee. `rankTonight` takes the events and nothing
    // else, so a future call site cannot reintroduce the defect by passing the
    // open page in — there is nowhere to put it.
    expect(rankTonight.length).toBe(1);
  });
});

describe("the invariant: rank does not move when the reader navigates", () => {
  const ranked = rankTonight(NIGHT);
  const canonical = new Map(ranked.map((event) => [event.id, event.rank]));

  it("gives every event the same rank whichever event is open", () => {
    // The exact reported defect: on the Saturn page Saturn was 1 and Meteors 4;
    // on the Meteors page Meteors was 1 and Saturn 2. Every selection is tried,
    // including no selection at all.
    for (const selectedId of [null, ...NIGHT.map((event) => event.id)]) {
      const rows = visibleRanked(ranked, selectedId, 6);
      for (const row of rows) {
        expect(row.rank).toBe(canonical.get(row.id));
      }
    }
  });

  it("never promotes the selected event to the top of the list", () => {
    for (const selectedId of NIGHT.map((event) => event.id)) {
      const rows = visibleRanked(ranked, selectedId, 6);
      expect(rows[0].id).toBe(EXPECTED[0]);
      expect(rows[0].rank).toBe(1);
    }
  });

  it("keeps the visible rows in canonical order for every selection", () => {
    for (const selectedId of [null, ...NIGHT.map((event) => event.id)]) {
      const rows = visibleRanked(ranked, selectedId, 6);
      const ranks = rows.map((row) => row.rank);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it("appends a selection from outside the window instead of promoting it", () => {
    // Neptune is eighth. Opening it must make it reachable without making it
    // look like the best thing in the sky.
    const rows = visibleRanked(ranked, "neptune", 6);
    expect(rows).toHaveLength(7);
    expect(rows[rows.length - 1].id).toBe("neptune");
    expect(rows[rows.length - 1].rank).toBe(canonical.get("neptune"));
    expect(rows[0].id).toBe("saturn");
  });

  it("does not duplicate a selection that is already visible", () => {
    const rows = visibleRanked(ranked, "mars", 6);
    expect(rows.filter((row) => row.id === "mars")).toHaveLength(1);
    expect(rows).toHaveLength(6);
  });

  it("tolerates a selection that no longer exists", () => {
    // A plan refresh can drop an event while its page is open. That must not
    // throw, and must not disturb the ranking of what remains.
    const rows = visibleRanked(ranked, "comet-that-left", 6);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("changes rank when an input genuinely changes, and only then", () => {
    // The other half of the invariant: ranking is not frozen, it is caused. A
    // real change in priority — worse sky, a shower peaking, an eclipse
    // arriving — must move it.
    const clouded = NIGHT.map((event) =>
      event.id === "saturn" ? { ...event, priority: 0.12 } : event,
    );
    const after = rankTonight(clouded);
    expect(after.find((event) => event.id === "saturn")!.rank).toBeGreaterThan(
      canonical.get("saturn")!,
    );
    expect(after[0].id).toBe("mars");

    // And an identical set of inputs produces an identical ranking.
    expect(rankTonight(NIGHT).map((event) => [event.id, event.rank])).toEqual(
      ranked.map((event) => [event.id, event.rank]),
    );
  });
});
