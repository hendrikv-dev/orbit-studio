import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, explorer, hook, css, home] = await Promise.all([
  readFile(new URL("../../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/components/explorer/ExplorerView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/lib/useMobileSheetDrag.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/styles/app.css", import.meta.url), "utf8"),
  readFile(new URL("../../src/components/home/OrbitStudioHome.tsx", import.meta.url), "utf8"),
]);

assert.match(hook, /MOBILE_SHEET_MAX_WIDTH_PX = 820/);
assert.match(hook, /MOBILE_SHEET_DRAG_DISMISS_PX = 82/);
assert.match(app, /useMobileSheetDrag\(closePlaygroundMobileSurface\)/);
assert.match(explorer, /useMobileSheetDrag/);
assert.match(css, /\.explorer-mobile-sheet-handle,\s*\.playground-mobile-sheet-handle\s*\{\s*display: none !important;/s);
assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.explorer-mobile-sheet-handle,[\s\S]*\.playground-mobile-sheet-handle[\s\S]*display: grid !important;/);
assert.match(css, /\.explorer-panel-header::before[\s\S]*content: none !important;/);
assert.match(home, /\/blob\/main\/README\.md/);
assert.doesNotMatch(home, /#readme/);
console.log("Shared Explorer/Playground mobile-sheet and documentation-link contract verified.");
