/**
 * CSV export for the analytical views.
 *
 * An analyst who finds something in the debris families or the lifetime bands
 * has to be able to take it away; a figure that can only be looked at is not
 * usable evidence. Exports therefore carry the same provenance the interface
 * shows — the source, the snapshot, and any model attribution — as comment
 * lines above the header, so a file that has left the app still says where its
 * numbers came from.
 */

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | null | undefined;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  provenance: readonly string[] = [],
): string {
  const lines = provenance.map((line) => `# ${line}`);
  lines.push(columns.map((column) => escapeCell(column.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** Trigger a download without a backend or a network round trip. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next task so the click has been dispatched first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
