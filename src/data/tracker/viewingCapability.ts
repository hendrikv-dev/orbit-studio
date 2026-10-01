import type { Opportunity } from "./opportunity";

export type TelescopeType = "reflector" | "refractor" | "catadioptric" | "other";
export type TelescopeMount = "alt-az" | "equatorial" | "other";

export interface TelescopeSetup {
  id: string;
  name: string;
  type: TelescopeType;
  apertureMm: number;
  focalLengthMm: number | null;
  eyepiecesMm: number[];
  mount: TelescopeMount;
  tracking: boolean;
  goto: boolean;
}

export interface StoredTelescopeSetups {
  version: 1;
  activeId: string | null;
  setups: TelescopeSetup[];
}

export interface TelescopeGuidance {
  heading: string;
  eyepiece: string | null;
  magnification: string | null;
  expectation: string;
}

const STORAGE_KEY = "orbit.tracker.telescope-setups.v1";

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validSetup(value: unknown): value is TelescopeSetup {
  if (!value || typeof value !== "object") return false;
  const setup = value as Partial<TelescopeSetup>;
  return (
    typeof setup.id === "string" && setup.id.length > 0 && setup.id.length <= 80 &&
    typeof setup.name === "string" && setup.name.length > 0 && setup.name.length <= 80 &&
    ["reflector", "refractor", "catadioptric", "other"].includes(setup.type ?? "") &&
    finiteRange(setup.apertureMm, 20, 1_500) &&
    (setup.focalLengthMm === null || finiteRange(setup.focalLengthMm, 50, 20_000)) &&
    Array.isArray(setup.eyepiecesMm) && setup.eyepiecesMm.length <= 20 &&
    setup.eyepiecesMm.every((eyepiece) => finiteRange(eyepiece, 1, 100)) &&
    ["alt-az", "equatorial", "other"].includes(setup.mount ?? "") &&
    typeof setup.tracking === "boolean" &&
    typeof setup.goto === "boolean"
  );
}

export function loadTelescopeSetups(storage: Pick<Storage, "getItem"> | null): StoredTelescopeSetups {
  if (!storage) return { version: 1, activeId: null, setups: [] };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredTelescopeSetups> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.setups)) {
      return { version: 1, activeId: null, setups: [] };
    }
    const setups = parsed.setups.filter(validSetup);
    const activeId = setups.some((setup) => setup.id === parsed.activeId) ? parsed.activeId! : setups[0]?.id ?? null;
    return { version: 1, activeId, setups };
  } catch {
    return { version: 1, activeId: null, setups: [] };
  }
}

export function saveTelescopeSetups(
  storage: Pick<Storage, "setItem"> | null,
  value: StoredTelescopeSetups,
): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function activeTelescopeSetup(value: StoredTelescopeSetups): TelescopeSetup | null {
  return value.setups.find((setup) => setup.id === value.activeId) ?? null;
}

export function telescopeGuidanceFor(
  opportunity: Opportunity,
  setup: TelescopeSetup | null,
): TelescopeGuidance | null {
  if (!setup) return null;
  const eyepiece = setup.focalLengthMm && setup.eyepiecesMm.length > 0
    ? [...setup.eyepiecesMm]
        .map((eyepieceMm) => ({
          eyepieceMm,
          magnification: setup.focalLengthMm! / eyepieceMm,
        }))
        .filter((candidate) => candidate.magnification <= setup.apertureMm * 2)
        .sort((left, right) => Math.abs(left.magnification - 120) - Math.abs(right.magnification - 120))[0] ?? null
    : null;

  const title = opportunity.shortTitle ?? opportunity.title;
  const planetName = opportunity.science?.kind === "planet"
    ? opportunity.science.body.toLowerCase()
    : title.toLowerCase();
  let expectation = "Use low power to find it, then increase magnification only while the view stays sharp.";
  if (planetName.includes("saturn")) {
    expectation = setup.apertureMm >= 60
      ? "The rings should be distinct; Titan may appear as a nearby point in steady, transparent conditions."
      : "The ringed shape may separate from the disc when the atmosphere is steady.";
  } else if (planetName.includes("jupiter")) {
    expectation = setup.apertureMm >= 60
      ? "Look for the four Galilean moons and, in steady air, the two main cloud belts."
      : "The brightest moons should appear as points beside the planet.";
  } else if (planetName.includes("mars")) {
    expectation = "A small ochre disc is realistic; surface detail depends strongly on apparent size and steady air.";
  }

  return {
    heading: `Recommended view with ${setup.name}`,
    eyepiece: eyepiece ? `${Number(eyepiece.eyepieceMm.toFixed(1))} mm eyepiece` : null,
    magnification: eyepiece ? `${Math.round(eyepiece.magnification)}×` : null,
    expectation,
  };
}

export function telescopeSetupStorageKey(): string {
  return STORAGE_KEY;
}
