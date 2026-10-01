/**
 * Asking the browser where the user is, and saying what happened.
 *
 * The previous version had one success path and one failure path, and the
 * failure path said "denied" whatever had actually gone wrong. In a Chrome that
 * had already blocked the site that produced a button which, when pressed, did
 * nothing observable at all: no prompt, because Chrome does not re-prompt after
 * a block; no error, because the state it moved to looked the same as the state
 * it was already in; and no way out, because nothing told the user that the
 * decision lived in the browser rather than in the page.
 *
 * So the states are enumerated, the reasons are kept apart, and where the
 * browser is the thing standing in the way the interface says which browser and
 * which control.
 */

export type GeolocationPhase =
  /** Nothing asked yet. */
  | "idle"
  /** The browser is showing its permission dialog. */
  | "prompting"
  /** Permission is granted; waiting for a fix. */
  | "locating"
  | "granted"
  /** Blocked. `recovery` says how to undo it in this browser. */
  | "denied"
  /** The device could not produce a position — no GPS, no network fix. */
  | "unavailable"
  /** The fix took too long. Retrying is reasonable. */
  | "timeout"
  /** No geolocation API at all, or an insecure page. */
  | "unsupported";

export interface GeolocationOutcome {
  phase: GeolocationPhase;
  /** One sentence, addressed to the reader. */
  message: string;
  /** Steps to undo a block, for the browser actually in use. */
  recovery: string[] | null;
  /** True where pressing the button again could plausibly work. */
  retryable: boolean;
  coords?: { latitude: number; longitude: number; accuracyM: number };
}

/**
 * The browser, only to the resolution the recovery text needs.
 *
 * Order matters: every Chromium browser claims to be Chrome, and Chrome claims
 * to be Safari, so the more specific tokens have to be tested first.
 */
export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari" | "other";

export function detectBrowser(userAgent: string = navigator.userAgent): BrowserFamily {
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

/**
 * How to unblock location, in the browser the reader is holding.
 *
 * Generic advice is close to useless here: the control is in a different place
 * in every browser and is not in the page at all, so "please enable location"
 * leaves somebody hunting through settings. These are the actual controls.
 */
export function recoverySteps(browser: BrowserFamily = detectBrowser()): string[] {
  switch (browser) {
    case "chrome":
      return [
        "Click the icon at the left of the address bar — a tune or lock symbol.",
        "Set Location to Allow.",
        "Reload this page.",
      ];
    case "edge":
      return [
        "Click the lock icon at the left of the address bar.",
        "Set Location to Allow.",
        "Reload this page.",
      ];
    case "firefox":
      return [
        "Click the padlock at the left of the address bar.",
        "Under Permissions, clear the blocked Access Your Location setting.",
        "Reload this page.",
      ];
    case "safari":
      return [
        "Open Safari → Settings → Websites → Location.",
        "Set this site to Ask or Allow.",
        "Reload this page.",
      ];
    default:
      return [
        "Open your browser's site settings for this page.",
        "Allow location access.",
        "Reload this page.",
      ];
  }
}

/**
 * What the browser will do if asked, before asking.
 *
 * This is the piece that turns an inert button into an honest one. Where the
 * Permissions API reports `denied`, pressing the button cannot produce a
 * prompt, so the interface should offer the way out instead of pretending a
 * request is about to happen. Not every browser implements the query for
 * geolocation, so an unknown answer means "just try it".
 */
export async function permissionState(): Promise<PermissionState | "unknown"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Maps a `GeolocationPositionError` onto the states above. */
export function outcomeForError(
  error: Pick<GeolocationPositionError, "code" | "message">,
  browser: BrowserFamily = detectBrowser(),
): GeolocationOutcome {
  // The numeric codes rather than the constants: the constants live on the
  // instance, and a plain object from a test would not carry them.
  if (error.code === 1) {
    return {
      phase: "denied",
      message: "Your browser is blocking location for this site, so it never asked.",
      recovery: recoverySteps(browser),
      retryable: false,
    };
  }
  if (error.code === 3) {
    return {
      phase: "timeout",
      message: "Finding you took too long. Indoors this can happen — try again, or search for a place.",
      recovery: null,
      retryable: true,
    };
  }
  return {
    phase: "unavailable",
    message:
      "Your device could not work out where it is. This is usually temporary — try again, or search for a place.",
    recovery: null,
    retryable: true,
  };
}

export interface RequestOptions {
  timeoutMs?: number;
  maximumAgeMs?: number;
  browser?: BrowserFamily;
}

/**
 * Request a position, reporting each step as it happens.
 *
 * `onPhase` fires before the browser dialog so the interface can show that
 * something is happening, which is the difference between a button that works
 * and a button that appears not to.
 */
export async function requestPosition(
  onPhase: (phase: GeolocationPhase) => void,
  options: RequestOptions = {},
): Promise<GeolocationOutcome> {
  const browser = options.browser ?? detectBrowser();

  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return {
      phase: "unsupported",
      message: "This browser cannot report a location. Search for a place instead.",
      recovery: null,
      retryable: false,
    };
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      phase: "unsupported",
      message:
        "Browsers only share location over a secure connection, and this page is not on one.",
      recovery: null,
      retryable: false,
    };
  }

  const state = await permissionState();
  if (state === "denied") {
    // Asking anyway would fire the error callback with no dialog, which is
    // exactly the silence this function exists to remove.
    onPhase("denied");
    return {
      phase: "denied",
      message: "Your browser is blocking location for this site, so it never asked.",
      recovery: recoverySteps(browser),
      retryable: false,
    };
  }

  onPhase(state === "granted" ? "locating" : "prompting");

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onPhase("granted");
        resolve({
          phase: "granted",
          message: "Found you.",
          recovery: null,
          retryable: false,
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
          },
        });
      },
      (error) => {
        const outcome = outcomeForError(error, browser);
        onPhase(outcome.phase);
        resolve(outcome);
      },
      {
        timeout: options.timeoutMs ?? 10_000,
        maximumAge: options.maximumAgeMs ?? 300_000,
        enableHighAccuracy: false,
      },
    );
  });
}
