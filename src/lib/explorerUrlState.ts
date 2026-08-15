/**
 * Explorer state that belongs in the address bar.
 *
 * Written for educators: a teacher cannot set a task against a view that has no
 * address. Before this, selecting an object, filtering to a regime and scrubbing
 * to a year all left the URL at `?app=explorer`, so a link could only ever say
 * "open Explorer and find it yourself".
 *
 * Only state a reader would expect a link to carry is encoded. Playback,
 * camera, panel open/closed and hover are deliberately excluded: they are
 * ephemeral, and putting them in the URL would make every link a snapshot of
 * someone's mouse rather than of a subject.
 */

export type ExplorerUrlView = "globe" | "population" | "debris";

export interface ExplorerUrlState {
  view: ExplorerUrlView | null;
  regime: string | null;
  /** Catalog record id of the selected object. */
  object: string | null;
  /** Snapshot year from the timeline. */
  year: number | null;
}

const VIEWS: ExplorerUrlView[] = ["globe", "population", "debris"];

/** Parse Explorer state out of a query string, ignoring anything unrecognised. */
export function readExplorerUrlState(search: string): ExplorerUrlState {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const year = Number(params.get("year"));
  return {
    view: VIEWS.includes(view as ExplorerUrlView) ? (view as ExplorerUrlView) : null,
    regime: params.get("regime"),
    object: params.get("object"),
    // A malformed year must not silently land the reader in a different era.
    year: Number.isInteger(year) && year >= 1957 && year <= 2200 ? year : null,
  };
}

/**
 * Merge Explorer state into an existing query string.
 *
 * Defaults are omitted rather than written: a link to the globe view with no
 * filter should look like a link to Explorer, not carry three redundant
 * parameters. Unrelated parameters already present are preserved.
 */
export function writeExplorerUrlState(
  search: string,
  state: {
    view: ExplorerUrlView;
    regime: string;
    object: string | null;
    year: number | null;
    defaultYear: number | null;
  },
): string {
  const params = new URLSearchParams(search);

  if (state.view === "globe") params.delete("view");
  else params.set("view", state.view);

  if (!state.regime || state.regime === "all") params.delete("regime");
  else params.set("regime", state.regime);

  if (state.object) params.set("object", state.object);
  else params.delete("object");

  if (state.year !== null && state.year !== state.defaultYear) {
    params.set("year", String(state.year));
  } else {
    params.delete("year");
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
