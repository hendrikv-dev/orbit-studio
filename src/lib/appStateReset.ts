const LEGACY_PERSISTED_STATE_KEYS = [
  "orbit-studio",
  "orbit-studio-state",
  "orbitStudioState",
  "apsis-store",
  "apsis-simulation-store",
  "simulation-store",
  "zustand-orbit-studio",
];

function clearStorage(storage: Storage | null): void {
  if (!storage) {
    return;
  }

  storage.clear();
}

export function resetLocalAppState(): void {
  try {
    clearStorage(window.localStorage);
  } catch {
    // Ignore storage access failures; reload still gives the app a clean runtime.
  }

  try {
    clearStorage(window.sessionStorage);
  } catch {
    // Ignore storage access failures; reload still gives the app a clean runtime.
  }
}

export function resetLocalAppStateAndReload(): void {
  resetLocalAppState();
  window.location.replace(window.location.origin + window.location.pathname);
}

function removeInvalidJsonValue(storage: Storage, key: string): void {
  const value = storage.getItem(key);

  if (value === null) {
    return;
  }

  try {
    JSON.parse(value);
  } catch {
    storage.removeItem(key);
  }
}

function sanitizeStorage(storage: Storage | null): void {
  if (!storage) {
    return;
  }

  LEGACY_PERSISTED_STATE_KEYS.forEach((key) => removeInvalidJsonValue(storage, key));
}

export function sanitizeLocalAppStateOnBoot(): void {
  try {
    sanitizeStorage(window.localStorage);
  } catch {
    // If the browser blocks storage access, startup should continue without persisted state.
  }

  try {
    sanitizeStorage(window.sessionStorage);
  } catch {
    // If the browser blocks storage access, startup should continue without persisted state.
  }
}
