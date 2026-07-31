import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  createConstellation,
  createDefaultScenario,
  createSatellite,
  type CameraSettings,
  type Scenario,
} from "../lib/scenario";

export type LibraryItemId =
  | "apollo-11"
  | "iss"
  | "jwst"
  | "hohmann-transfer"
  | "why-orbits-work"
  | "starlink"
  | "gps";

export type LibraryItemKind = "mission" | "concept" | "system";

export interface LibraryItem {
  id: LibraryItemId;
  title: string;
  eyebrow: string;
  kind: LibraryItemKind;
  summary: string;
  image: string;
  imageTone: "earth" | "night" | "clouds";
  featured?: boolean;
}

export interface LibraryCategory {
  id: "featured" | "missions" | "concepts" | "systems";
  title: string;
  itemIds: LibraryItemId[];
}

export interface GuidedEvent {
  id: string;
  title: string;
  timeLabel: string;
  timestampIso: string;
  context: string;
  stateNote: string;
  frame: GuidedMissionFrame;
  scenario: Scenario;
}

export interface GuidedSequence {
  item: LibraryItem;
  events: GuidedEvent[];
}

export type GuidedMissionFocus = "earth" | "transit" | "moon" | "surface" | "return";

const PUBLIC_EARTH_REFERENCE_IMAGE = "/earth/nasa-blue-marble-january-5400.jpg";

export interface GuidedMissionFrame {
  focus: GuidedMissionFocus;
  cameraLabel: string;
  cameraPositionKm: [number, number, number];
  cameraTargetKm: [number, number, number];
  cameraFov: number;
  primaryBody: "Earth" | "Moon" | "Earth and Moon";
  distanceLabel: string;
  moonVisible: boolean;
  moonPositionKm: [number, number, number];
  moonMap: {
    x: number;
    y: number;
    scale: number;
  };
  spacecraftVisible: boolean;
  spacecraftLabel: string;
  spacecraftPositionKm: [number, number, number];
  spacecraftMap: {
    x: number;
    y: number;
  };
}

export const libraryItems: LibraryItem[] = [
  {
    id: "apollo-11",
    title: "Apollo 11",
    eyebrow: "Featured Mission",
    kind: "mission",
    summary: "A guided path through launch, Earth orbit, injection, orbital arrival, and landing context.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "earth",
    featured: true,
  },
  {
    id: "iss",
    title: "ISS",
    eyebrow: "Mission",
    kind: "mission",
    summary: "Low Earth orbit operations, visibility, and ground-track exploration.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "night",
    featured: true,
  },
  {
    id: "jwst",
    title: "JWST",
    eyebrow: "Mission",
    kind: "mission",
    summary: "A placeholder guided sequence for transfer geometry and stationkeeping context.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "clouds",
  },
  {
    id: "hohmann-transfer",
    title: "Hohmann Transfer",
    eyebrow: "Concept",
    kind: "concept",
    summary: "Step through the classic two-burn transfer between circular orbits.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "earth",
    featured: true,
  },
  {
    id: "why-orbits-work",
    title: "Why Orbits Work",
    eyebrow: "Concept",
    kind: "concept",
    summary: "A minimal guided model for velocity, altitude, and orbital period.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "clouds",
  },
  {
    id: "starlink",
    title: "Starlink",
    eyebrow: "System",
    kind: "system",
    summary: "A system-scale placeholder for shells, planes, and coverage exploration.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "night",
  },
  {
    id: "gps",
    title: "GPS",
    eyebrow: "System",
    kind: "system",
    summary: "Medium Earth orbit coverage and timing architecture as an explorable state.",
    image: PUBLIC_EARTH_REFERENCE_IMAGE,
    imageTone: "earth",
  },
];

export const libraryCategories: LibraryCategory[] = [
  { id: "featured", title: "Featured", itemIds: ["apollo-11", "hohmann-transfer", "iss"] },
  { id: "missions", title: "Missions", itemIds: ["apollo-11", "iss", "jwst"] },
  { id: "concepts", title: "Concepts", itemIds: ["hohmann-transfer", "why-orbits-work"] },
  { id: "systems", title: "Systems", itemIds: ["starlink", "gps"] },
];

export function getLibraryItem(itemId: LibraryItemId): LibraryItem {
  const item = libraryItems.find((candidate) => candidate.id === itemId);

  if (!item) {
    throw new Error(`Unknown library item: ${itemId}`);
  }

  return item;
}

interface ScenarioEventOptions {
  itemId: LibraryItemId;
  eventId: string;
  scenarioName: string;
  objectName: string;
  isoTime: string;
  color: string;
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argumentOfPeriapsisDeg: number;
  trueAnomalyDeg: number;
  timeScale?: number;
  viewPreset?: CameraSettings["viewPreset"];
  showGroundTrack?: boolean;
  showCoverageLayer?: boolean;
  frame?: GuidedMissionFrame;
}

function createEventScenario(options: ScenarioEventOptions): Scenario {
  const frame = options.frame ?? createGenericMissionFrame(options);
  const epoch = new Date(options.isoTime);
  const scenario = createDefaultScenario(epoch);
  const satellite = createSatellite(options.objectName, epoch, {
    id: `${options.itemId}-${options.eventId}-vehicle`,
    keplerian: {
      semiMajorAxisKm: options.semiMajorAxisKm,
      eccentricity: options.eccentricity,
      inclinationDeg: options.inclinationDeg,
      raanDeg: options.raanDeg,
      argumentOfPeriapsisDeg: options.argumentOfPeriapsisDeg,
      trueAnomalyDeg: options.trueAnomalyDeg,
      epoch: options.isoTime,
    },
    visualization: {
      color: options.color,
      visible: true,
      showTrail: true,
      showGroundTrack: options.showGroundTrack ?? true,
    },
    sensor: {
      enabled: false,
      halfAngleDeg: 18,
      maxRangeKm: null,
      showCone: false,
      showFootprint: false,
    },
  });
  const constellation = createConstellation(`${options.scenarioName} Track`, [satellite.id], {
    id: `${options.itemId}-${options.eventId}-track`,
    color: options.color,
    generator: {
      kind: "manual",
      createdAt: options.isoTime,
    },
  });

  satellite.constellationId = constellation.id;

  return {
    ...scenario,
    name: options.scenarioName,
    simulationEpoch: options.isoTime,
    simulationTimeUtc: options.isoTime,
    timeScale: options.timeScale ?? 1,
    isReverse: false,
    renderSettings: {
      ...scenario.renderSettings,
      showCoverageLayer: options.showCoverageLayer ?? false,
      educationalOverlay: "none",
      showLatLonGrid: frame.focus === "earth",
      showEciGrid: false,
      showEcefGrid: false,
      showGeoValidationOverlay: false,
      showStarOcclusionDiagnostics: false,
      earthDebugMode: "full",
    },
    cameraSettings: {
      cameraMode: "free",
      viewPreset: options.viewPreset ?? "free",
      followSelectedObject: false,
      followSatelliteId: null,
      groundStationViewId: null,
    },
    teacherMode: false,
    coverageSettings: {
      ...scenario.coverageSettings,
      enabled: options.showCoverageLayer ?? false,
      targetType: "satellite",
      targetId: satellite.id,
    },
    selectedObjectType: "satellite",
    selectedObjectId: satellite.id,
    satellites: [satellite],
    constellations: [constellation],
    groundStations: [],
    regions: [],
    catalogLayers: [],
  };
}

function event(
  options: Omit<ScenarioEventOptions, "scenarioName"> & {
    title: string;
    timeLabel: string;
    context: string;
    stateNote: string;
    scenarioName?: string;
  },
): GuidedEvent {
  return {
    id: options.eventId,
    title: options.title,
    timeLabel: options.timeLabel,
    timestampIso: options.isoTime,
    context: options.context,
    stateNote: options.stateNote,
    frame: options.frame ?? createGenericMissionFrame(options),
    scenario: createEventScenario({
      ...options,
      scenarioName: options.scenarioName ?? options.title,
    }),
  };
}

const APOLLO_MOON_POSITION: [number, number, number] = [156000, 16000, -22000];

function createGenericMissionFrame(options: Pick<ScenarioEventOptions, "objectName" | "semiMajorAxisKm">): GuidedMissionFrame {
  return {
    focus: "earth",
    cameraLabel: "Orbit inspection",
    cameraPositionKm: [15000, 8200, 19000],
    cameraTargetKm: [0, 0, 0],
    cameraFov: 38,
    primaryBody: "Earth",
    distanceLabel: "Representative orbit state",
    moonVisible: false,
    moonPositionKm: APOLLO_MOON_POSITION,
    moonMap: { x: 76, y: 32, scale: 1 },
    spacecraftVisible: true,
    spacecraftLabel: options.objectName,
    spacecraftPositionKm: [Math.max(7800, Math.min(options.semiMajorAxisKm, 26000)), 1200, -1200],
    spacecraftMap: { x: 32, y: 48 },
  };
}

function missionFrame(options: Partial<GuidedMissionFrame> & Pick<GuidedMissionFrame, "focus" | "cameraLabel" | "cameraPositionKm" | "cameraTargetKm" | "primaryBody" | "distanceLabel" | "spacecraftLabel" | "spacecraftPositionKm" | "spacecraftMap">): GuidedMissionFrame {
  return {
    cameraFov: options.cameraFov ?? 38,
    moonVisible: options.moonVisible ?? false,
    moonPositionKm: options.moonPositionKm ?? APOLLO_MOON_POSITION,
    moonMap: options.moonMap ?? { x: 76, y: 32, scale: 1 },
    spacecraftVisible: options.spacecraftVisible ?? true,
    ...options,
  };
}

function apolloEvents(): GuidedEvent[] {
  const itemId = "apollo-11";

  return [
    event({
      itemId,
      eventId: "launch",
      title: "Launch",
      timeLabel: "T+00:00",
      context: "Saturn V lifts off from Kennedy Space Center and begins the climb to orbit.",
      stateNote: "Guided Mode frames the launch stack near Earth while the mission clock begins at liftoff.",
      scenarioName: "Apollo 11 - Launch",
      objectName: "Apollo 11 Stack",
      isoTime: "1969-07-16T13:32:00.000Z",
      color: "#f8d36a",
      semiMajorAxisKm: EARTH_RADIUS_KM + 190,
      eccentricity: 0.018,
      inclinationDeg: 28.5,
      raanDeg: 72,
      argumentOfPeriapsisDeg: 18,
      trueAnomalyDeg: 8,
      timeScale: 1,
      viewPreset: "equatorial",
      frame: missionFrame({
        focus: "earth",
        cameraLabel: "Launch ascent",
        cameraPositionKm: [0, 5200, 21500],
        cameraTargetKm: [0, 0, 0],
        cameraFov: 34,
        primaryBody: "Earth",
        distanceLabel: "Earth departure begins",
        spacecraftLabel: "Saturn V / Apollo 11",
        spacecraftPositionKm: [6900, -700, 1200],
        spacecraftMap: { x: 19, y: 58 },
      }),
    }),
    event({
      itemId,
      eventId: "earth-orbit",
      title: "Earth Orbit",
      timeLabel: "T+00:12",
      context: "The spacecraft enters parking orbit while the crew and controllers verify the vehicle.",
      stateNote: "The camera stays close to Earth and the spacecraft remains the primary object.",
      scenarioName: "Apollo 11 - Earth Orbit",
      objectName: "Apollo CSM + LM",
      isoTime: "1969-07-16T13:44:00.000Z",
      color: "#8bd3ff",
      semiMajorAxisKm: EARTH_RADIUS_KM + 185,
      eccentricity: 0.003,
      inclinationDeg: 32.5,
      raanDeg: 84,
      argumentOfPeriapsisDeg: 24,
      trueAnomalyDeg: 48,
      timeScale: 10,
      viewPreset: "free",
      frame: missionFrame({
        focus: "earth",
        cameraLabel: "Parking orbit",
        cameraPositionKm: [15000, 7800, 17800],
        cameraTargetKm: [0, 0, 0],
        cameraFov: 38,
        primaryBody: "Earth",
        distanceLabel: "Low Earth orbit",
        spacecraftLabel: "Columbia + Eagle",
        spacecraftPositionKm: [8100, 1400, -900],
        spacecraftMap: { x: 25, y: 52 },
      }),
    }),
    event({
      itemId,
      eventId: "translunar-coast",
      title: "Translunar Coast",
      timeLabel: "T+03:20",
      context: "After translunar injection, Apollo 11 coasts across cislunar space.",
      stateNote: "Earth and Moon are both in frame while the spacecraft moves along the outbound corridor.",
      scenarioName: "Apollo 11 - Translunar Coast",
      objectName: "Apollo 11 Coast",
      isoTime: "1969-07-16T16:52:00.000Z",
      color: "#f4a261",
      semiMajorAxisKm: 182000,
      eccentricity: 0.958,
      inclinationDeg: 31.4,
      raanDeg: 92,
      argumentOfPeriapsisDeg: 42,
      trueAnomalyDeg: 54,
      timeScale: 100,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "transit",
        cameraLabel: "Earth-Moon coast",
        cameraPositionKm: [70000, 78000, 170000],
        cameraTargetKm: [76000, 9000, -12000],
        cameraFov: 62,
        primaryBody: "Earth and Moon",
        distanceLabel: "Outbound translunar coast",
        moonVisible: true,
        moonMap: { x: 80, y: 31, scale: 1 },
        spacecraftLabel: "Apollo 11",
        spacecraftPositionKm: [58000, 8000, -9000],
        spacecraftMap: { x: 52, y: 42 },
      }),
    }),
    event({
      itemId,
      eventId: "moon-arrival",
      title: "Moon Arrival",
      timeLabel: "T+75:50",
      context: "Apollo 11 reaches the Moon and prepares for lunar orbit insertion.",
      stateNote: "The Moon becomes the dominant body and the spacecraft is framed near arrival.",
      scenarioName: "Apollo 11 - Moon Arrival",
      objectName: "Apollo 11 Moon Arrival",
      isoTime: "1969-07-19T17:22:00.000Z",
      color: "#c4b5fd",
      semiMajorAxisKm: 205000,
      eccentricity: 0.82,
      inclinationDeg: 28.6,
      raanDeg: 112,
      argumentOfPeriapsisDeg: 68,
      trueAnomalyDeg: 166,
      timeScale: 100,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "moon",
        cameraLabel: "Moon arrival",
        cameraPositionKm: [183000, 42000, 18000],
        cameraTargetKm: APOLLO_MOON_POSITION,
        cameraFov: 36,
        primaryBody: "Moon",
        distanceLabel: "Entering lunar sphere of influence",
        moonVisible: true,
        moonMap: { x: 74, y: 33, scale: 1.12 },
        spacecraftLabel: "Apollo 11",
        spacecraftPositionKm: [145000, 14000, -19000],
        spacecraftMap: { x: 68, y: 35 },
      }),
    }),
    event({
      itemId,
      eventId: "lunar-orbit",
      title: "Lunar Orbit",
      timeLabel: "T+80:12",
      context: "Columbia and Eagle orbit the Moon while landing preparations continue.",
      stateNote: "The camera is anchored to lunar orbit instead of returning to an Earth-centered lesson view.",
      scenarioName: "Apollo 11 - Lunar Orbit",
      objectName: "Columbia + Eagle",
      isoTime: "1969-07-19T21:44:00.000Z",
      color: "#d8b4fe",
      semiMajorAxisKm: 210000,
      eccentricity: 0.79,
      inclinationDeg: 28.7,
      raanDeg: 124,
      argumentOfPeriapsisDeg: 86,
      trueAnomalyDeg: 190,
      timeScale: 100,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "moon",
        cameraLabel: "Lunar orbit",
        cameraPositionKm: [172000, 34000, 10000],
        cameraTargetKm: APOLLO_MOON_POSITION,
        cameraFov: 32,
        primaryBody: "Moon",
        distanceLabel: "Orbiting the Moon",
        moonVisible: true,
        moonMap: { x: 74, y: 34, scale: 1.18 },
        spacecraftLabel: "Columbia + Eagle",
        spacecraftPositionKm: [153000, 18000, -20500],
        spacecraftMap: { x: 76, y: 35 },
      }),
    }),
    event({
      itemId,
      eventId: "landing",
      title: "Landing",
      timeLabel: "T+102:45",
      context: "Eagle descends to the Sea of Tranquility and lands on the lunar surface.",
      stateNote: "The Moon fills the mission frame and Eagle remains visible as the active spacecraft state.",
      scenarioName: "Apollo 11 - Landing",
      objectName: "Eagle",
      isoTime: "1969-07-20T20:17:00.000Z",
      color: "#fef3c7",
      semiMajorAxisKm: 218000,
      eccentricity: 0.76,
      inclinationDeg: 27.9,
      raanDeg: 126,
      argumentOfPeriapsisDeg: 82,
      trueAnomalyDeg: 212,
      timeScale: 1,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "surface",
        cameraLabel: "Powered descent",
        cameraPositionKm: [157900, 18300, -18300],
        cameraTargetKm: [157200, 16200, -21900],
        cameraFov: 38,
        primaryBody: "Moon",
        distanceLabel: "Sea of Tranquility",
        moonVisible: true,
        moonMap: { x: 73, y: 39, scale: 1.32 },
        spacecraftLabel: "Eagle",
        spacecraftPositionKm: [157200, 16200, -21900],
        spacecraftMap: { x: 77, y: 55 },
      }),
    }),
    event({
      itemId,
      eventId: "moonwalk",
      title: "Moonwalk",
      timeLabel: "T+109:24",
      context: "Armstrong and Aldrin begin surface operations while Eagle is parked on the Moon.",
      stateNote: "This event is a surface milestone: the lunar surface and lander are the focal context.",
      scenarioName: "Apollo 11 - Moonwalk",
      objectName: "Eagle Surface State",
      isoTime: "1969-07-21T02:56:00.000Z",
      color: "#fff7ed",
      semiMajorAxisKm: 218000,
      eccentricity: 0.76,
      inclinationDeg: 27.9,
      raanDeg: 126,
      argumentOfPeriapsisDeg: 92,
      trueAnomalyDeg: 218,
      timeScale: 1,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "surface",
        cameraLabel: "Lunar surface",
        cameraPositionKm: [157950, 17750, -18450],
        cameraTargetKm: [157350, 16100, -21850],
        cameraFov: 38,
        primaryBody: "Moon",
        distanceLabel: "Surface EVA",
        moonVisible: true,
        moonMap: { x: 73, y: 40, scale: 1.36 },
        spacecraftLabel: "Eagle",
        spacecraftPositionKm: [157350, 16100, -21850],
        spacecraftMap: { x: 78, y: 57 },
      }),
    }),
    event({
      itemId,
      eventId: "return",
      title: "Return",
      timeLabel: "T+135:24",
      context: "The crew departs lunar orbit and begins the coast home.",
      stateNote: "The camera widens back to Earth-Moon space as Apollo 11 returns.",
      scenarioName: "Apollo 11 - Return",
      objectName: "Apollo 11 Return Coast",
      isoTime: "1969-07-22T04:56:00.000Z",
      color: "#93c5fd",
      semiMajorAxisKm: 188000,
      eccentricity: 0.95,
      inclinationDeg: 30.2,
      raanDeg: 144,
      argumentOfPeriapsisDeg: 124,
      trueAnomalyDeg: 238,
      timeScale: 100,
      viewPreset: "free",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "return",
        cameraLabel: "Return coast",
        cameraPositionKm: [82000, 76000, 166000],
        cameraTargetKm: [62000, 8000, -12000],
        cameraFov: 62,
        primaryBody: "Earth and Moon",
        distanceLabel: "Inbound to Earth",
        moonVisible: true,
        moonMap: { x: 70, y: 34, scale: 0.96 },
        spacecraftLabel: "Apollo 11",
        spacecraftPositionKm: [88000, 6000, -18000],
        spacecraftMap: { x: 48, y: 43 },
      }),
    }),
    event({
      itemId,
      eventId: "splashdown",
      title: "Splashdown",
      timeLabel: "T+195:18",
      context: "Apollo 11 reenters and splashes down in the Pacific Ocean.",
      stateNote: "The mission resolves back at Earth with the command module as the active spacecraft.",
      scenarioName: "Apollo 11 - Splashdown",
      objectName: "Columbia Command Module",
      isoTime: "1969-07-24T16:50:00.000Z",
      color: "#7dd3fc",
      semiMajorAxisKm: EARTH_RADIUS_KM + 120,
      eccentricity: 0.01,
      inclinationDeg: 28.5,
      raanDeg: 168,
      argumentOfPeriapsisDeg: 18,
      trueAnomalyDeg: 298,
      timeScale: 1,
      viewPreset: "equatorial",
      showGroundTrack: false,
      frame: missionFrame({
        focus: "earth",
        cameraLabel: "Earth return",
        cameraPositionKm: [-3000, 6400, 22000],
        cameraTargetKm: [0, 0, 0],
        cameraFov: 34,
        primaryBody: "Earth",
        distanceLabel: "Pacific splashdown",
        spacecraftLabel: "Columbia",
        spacecraftPositionKm: [6900, -900, 1400],
        spacecraftMap: { x: 23, y: 62 },
      }),
    }),
  ];
}

function hohmannEvents(): GuidedEvent[] {
  const itemId = "hohmann-transfer";

  return [
    event({
      itemId,
      eventId: "initial-orbit",
      title: "Initial Orbit",
      timeLabel: "Step 1",
      context: "The vehicle begins in a stable circular orbit close to Earth.",
      stateNote: "The starting orbit is circular so the transfer burn change is easy to compare.",
      objectName: "Transfer Vehicle",
      isoTime: "2026-01-01T00:00:00.000Z",
      color: "#67e8f9",
      semiMajorAxisKm: EARTH_RADIUS_KM + 550,
      eccentricity: 0,
      inclinationDeg: 28,
      raanDeg: 20,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 0,
      timeScale: 10,
    }),
    event({
      itemId,
      eventId: "transfer-burn",
      title: "Transfer Burn",
      timeLabel: "Step 2",
      context: "A prograde burn raises the far side of the orbit.",
      stateNote: "The orbit is now elliptical, connecting the initial orbit to a higher target orbit.",
      objectName: "Transfer Vehicle",
      isoTime: "2026-01-01T00:08:00.000Z",
      color: "#fbbf24",
      semiMajorAxisKm: EARTH_RADIUS_KM + 5200,
      eccentricity: 0.42,
      inclinationDeg: 28,
      raanDeg: 20,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 6,
      timeScale: 100,
    }),
    event({
      itemId,
      eventId: "coast",
      title: "Coast",
      timeLabel: "Step 3",
      context: "The vehicle coasts along the transfer arc toward apoapsis.",
      stateNote: "Jumping here advances the anomaly while preserving the same transfer ellipse.",
      objectName: "Transfer Vehicle",
      isoTime: "2026-01-01T01:10:00.000Z",
      color: "#fbbf24",
      semiMajorAxisKm: EARTH_RADIUS_KM + 5200,
      eccentricity: 0.42,
      inclinationDeg: 28,
      raanDeg: 20,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 154,
      timeScale: 100,
    }),
    event({
      itemId,
      eventId: "circularization",
      title: "Circularization",
      timeLabel: "Step 4",
      context: "A second burn turns the transfer ellipse into the higher circular orbit.",
      stateNote: "The final state shows a larger circular orbit ready for free exploration.",
      objectName: "Transfer Vehicle",
      isoTime: "2026-01-01T01:32:00.000Z",
      color: "#5eead4",
      semiMajorAxisKm: EARTH_RADIUS_KM + 8800,
      eccentricity: 0,
      inclinationDeg: 28,
      raanDeg: 20,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 180,
      timeScale: 10,
    }),
  ];
}

function placeholderEvents(item: LibraryItem): GuidedEvent[] {
  const itemId = item.id;
  const baseAltitude =
    itemId === "gps" ? 20200 : itemId === "jwst" ? 22000 : itemId === "starlink" ? 550 : 420;
  const inclination =
    itemId === "gps" ? 55 : itemId === "starlink" ? 53 : itemId === "iss" ? 51.64 : 23.5;
  const color = item.kind === "system" ? "#7dd3fc" : item.kind === "mission" ? "#c4b5fd" : "#5eead4";

  return [
    event({
      itemId,
      eventId: "overview",
      title: "Overview",
      timeLabel: "Step 1",
      context: `${item.title} opens with a representative orbit state for guided inspection.`,
      stateNote: "This placeholder state proves the framework: load, inspect, and continue into Orbit Mode.",
      scenarioName: `${item.title} - Overview`,
      objectName: `${item.title} Reference`,
      isoTime: "2026-01-01T00:00:00.000Z",
      color,
      semiMajorAxisKm: EARTH_RADIUS_KM + baseAltitude,
      eccentricity: itemId === "jwst" ? 0.62 : 0.001,
      inclinationDeg: inclination,
      raanDeg: 42,
      argumentOfPeriapsisDeg: 12,
      trueAnomalyDeg: 28,
      timeScale: 10,
      showCoverageLayer: item.kind === "system",
    }),
    event({
      itemId,
      eventId: "orbit-context",
      title: "Orbit Context",
      timeLabel: "Step 2",
      context: "Guided Mode advances to a second predefined simulation state.",
      stateNote: "The event list, jump controls, and simulation handoff are the important foundation here.",
      scenarioName: `${item.title} - Orbit Context`,
      objectName: `${item.title} Reference`,
      isoTime: "2026-01-01T00:32:00.000Z",
      color,
      semiMajorAxisKm: EARTH_RADIUS_KM + baseAltitude,
      eccentricity: itemId === "jwst" ? 0.62 : 0.001,
      inclinationDeg: inclination,
      raanDeg: 58,
      argumentOfPeriapsisDeg: 32,
      trueAnomalyDeg: 112,
      timeScale: 10,
      showCoverageLayer: item.kind === "system",
    }),
    event({
      itemId,
      eventId: "explore",
      title: "Explore",
      timeLabel: "Step 3",
      context: "The guided sequence is ready to hand the current state to Orbit Mode.",
      stateNote: "Open Orbit Mode to rotate, zoom, inspect, and explore this same simulation state.",
      scenarioName: `${item.title} - Explore`,
      objectName: `${item.title} Reference`,
      isoTime: "2026-01-01T01:04:00.000Z",
      color,
      semiMajorAxisKm: EARTH_RADIUS_KM + baseAltitude,
      eccentricity: itemId === "jwst" ? 0.62 : 0.001,
      inclinationDeg: inclination,
      raanDeg: 72,
      argumentOfPeriapsisDeg: 48,
      trueAnomalyDeg: 196,
      timeScale: 10,
      showCoverageLayer: item.kind === "system",
    }),
  ];
}

export function createGuidedSequence(itemId: LibraryItemId): GuidedSequence {
  const item = getLibraryItem(itemId);
  const events =
    itemId === "apollo-11"
      ? apolloEvents()
      : itemId === "hohmann-transfer"
        ? hohmannEvents()
        : placeholderEvents(item);

  return { item, events };
}
