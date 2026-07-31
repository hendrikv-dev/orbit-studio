import type { ExplorerCatalogEntry } from "./explorerCatalog";
import { explorerConstellationArchitectureFor } from "./explorerConstellationArchitecture";

export type ExplorerHeroKind =
  | "apollo"
  | "constellation"
  | "debris"
  | "deep-space"
  | "earth-orbit"
  | "environment"
  | "geo"
  | "ground-station"
  | "halo"
  | "lagrange"
  | "launch-vehicle"
  | "leo"
  | "meo"
  | "observatory";

export interface ExplorerHeroMedia {
  kind: ExplorerHeroKind;
  imageUrl?: string;
  imageAlt: string;
  credit?: string;
  sourceUrl?: string;
}

export interface ExplorerKeyFact {
  label: string;
  value: string;
}

export interface ExplorerRelatedTopic {
  label: string;
  entryId?: string;
}

export interface ExplorerOfficialSource {
  label: string;
  url: string;
}

export interface ExplorerEducationSection {
  title: string;
  body: string;
}

export interface ExplorerEducationContent {
  intro: string;
  whyItMatters: string;
  hero: ExplorerHeroMedia;
  /**
   * Editorial discovery priority for the Featured Objects collection.
   * This metadata affects presentation order only; it never changes catalog or scene eligibility.
   */
  featuredPriority?: number;
  keyFacts?: ExplorerKeyFact[];
  related: ExplorerRelatedTopic[];
  sources: ExplorerOfficialSource[];
  sections?: ExplorerEducationSection[];
}

const sources = {
  apollo11: {
    label: "NASA Apollo 11 overview",
    url: "https://www.nasa.gov/history/apollo-11-mission-overview/",
  },
  celestrak: {
    label: "CelesTrak GP catalog",
    url: "https://celestrak.org/NORAD/elements/",
  },
  dsn: {
    label: "NASA Deep Space Network",
    url: "https://www.nasa.gov/directorates/somd/space-communications-navigation-program/what-is-the-deep-space-network/",
  },
  dsnComplexes: {
    label: "NASA DSN complexes",
    url: "https://www.nasa.gov/directorates/somd/space-communications-navigation-program/dsn-complexes/",
  },
  esaGalileo: {
    label: "ESA Galileo",
    url: "https://www.esa.int/Applications/Satellite_navigation/Galileo/What_is_Galileo",
  },
  esaSentinel3: {
    label: "ESA Sentinel-3",
    url: "https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-3",
  },
  gps: {
    label: "Official GPS site",
    url: "https://www.gps.gov/",
  },
  hubble: {
    label: "NASA Hubble mission",
    url: "https://science.nasa.gov/mission/hubble/",
  },
  iss: {
    label: "NASA International Space Station",
    url: "https://www.nasa.gov/international-space-station/",
  },
  nasaBasics: {
    label: "NASA Spaceflight Basics",
    url: "https://science.nasa.gov/learn/basics-of-space-flight/chapter10-1/",
  },
  noaaSatellites: {
    label: "NOAA current satellites",
    url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying",
  },
  voyager: {
    label: "NASA Voyager mission",
    url: "https://science.nasa.gov/mission/voyager/",
  },
  webb: {
    label: "NASA Webb mission",
    url: "https://science.nasa.gov/mission/webb/",
  },
} satisfies Record<string, ExplorerOfficialSource>;

const nasaImages = {
  apollo:
    "https://images-assets.nasa.gov/image/jsc2007e034221/jsc2007e034221~medium.jpg",
  apolloSource: "https://images.nasa.gov/details/jsc2007e034221",
  hubble:
    "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e002151/GSFC_20171208_Archive_e002151~medium.jpg",
  hubbleSource: "https://images.nasa.gov/details/GSFC_20171208_Archive_e002151",
  voyager: "https://images-assets.nasa.gov/image/PIA14111/PIA14111~small.jpg",
  voyagerSource: "https://images.nasa.gov/details/PIA14111",
  webb:
    "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e000356/GSFC_20171208_Archive_e000356~medium.jpg",
  webbSource: "https://images.nasa.gov/details/GSFC_20171208_Archive_e000356",
};

const curatedEducation: Record<string, ExplorerEducationContent> = {
  "explorer-jwst": {
    featuredPriority: 90,
    intro:
      "The James Webb Space Telescope is a large infrared observatory working near Sun-Earth L2, where its sunshield can keep the telescope cold and pointed away from the Sun.",
    whyItMatters:
      "Webb extends space astronomy into faint infrared light, letting scientists study early galaxies, star birth, exoplanet atmospheres, and cold objects that are difficult to see from warmer telescopes.",
    hero: {
      kind: "observatory",
      imageUrl: nasaImages.webb,
      imageAlt: "James Webb Space Telescope in a clean room before launch.",
      credit: "NASA/GSFC",
      sourceUrl: nasaImages.webbSource,
    },
    keyFacts: [
      { label: "Purpose", value: "Infrared observatory" },
      { label: "Destination", value: "Sun-Earth L2 region" },
      { label: "Orbit", value: "Halo orbit near L2" },
      { label: "Status", value: "Operational" },
    ],
    related: [
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
      { label: "Lagrange Points", entryId: "explorer-lagrange-points" },
      { label: "Halo Orbit", entryId: "explorer-halo-orbit" },
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
      { label: "Hubble Space Telescope", entryId: "explorer-hubble" },
    ],
    sources: [sources.webb, sources.dsn],
    sections: [
      {
        title: "Why L2 helps",
        body:
          "At L2, the Sun, Earth, and Moon stay in roughly the same direction from Webb. That geometry lets the sunshield protect the telescope while the observatory keeps a wide view of deep space.",
      },
    ],
  },
  "explorer-voyager-1": {
    featuredPriority: 76,
    intro:
      "Voyager 1 is a NASA/JPL spacecraft launched in 1977 that flew past the outer planets and now operates in interstellar space beyond the heliosphere.",
    whyItMatters:
      "It turned a planetary flyby mission into a long-running measurement of the boundary between the Sun's influence and the surrounding interstellar environment.",
    hero: {
      kind: "deep-space",
      imageUrl: nasaImages.voyager,
      imageAlt: "Artist concept of a Voyager spacecraft.",
      credit: "NASA/JPL-Caltech",
      sourceUrl: nasaImages.voyagerSource,
    },
    keyFacts: [
      { label: "Purpose", value: "Outer planet and interstellar science" },
      { label: "Launched", value: "1977" },
      { label: "Status", value: "Operational" },
      { label: "Communications", value: "NASA Deep Space Network" },
    ],
    related: [
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
      { label: "Voyager 2", entryId: "explorer-voyager-2" },
      { label: "Lagrange Points", entryId: "explorer-lagrange-points" },
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
    ],
    sources: [sources.voyager, sources.dsn],
  },
  "explorer-voyager-2": {
    featuredPriority: 75,
    intro:
      "Voyager 2 is the only spacecraft to visit Uranus and Neptune, and it continues returning measurements from interstellar space.",
    whyItMatters:
      "Its Grand Tour flybys created the only close-up record of the ice giants while its long cruise keeps extending our direct sample of the outer heliosphere.",
    hero: {
      kind: "deep-space",
      imageUrl: nasaImages.voyager,
      imageAlt: "Artist concept of a Voyager spacecraft.",
      credit: "NASA/JPL-Caltech",
      sourceUrl: nasaImages.voyagerSource,
    },
    keyFacts: [
      { label: "Purpose", value: "Outer planet and interstellar science" },
      { label: "Launched", value: "1977" },
      { label: "Status", value: "Operational" },
      { label: "Visited", value: "Jupiter, Saturn, Uranus, Neptune" },
    ],
    related: [
      { label: "Voyager 1", entryId: "explorer-voyager-1" },
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
      { label: "Lagrange Points", entryId: "explorer-lagrange-points" },
    ],
    sources: [sources.voyager, sources.dsn],
  },
  "explorer-apollo-11-csm": {
    featuredPriority: 82,
    intro:
      "Apollo 11 carried Neil Armstrong, Michael Collins, and Buzz Aldrin from Earth toward the first crewed landing on the Moon.",
    whyItMatters:
      "The mission proved that launch, navigation, lunar orbit, landing, surface operations, and return could work as one integrated human exploration system.",
    hero: {
      kind: "apollo",
      imageUrl: nasaImages.apollo,
      imageAlt: "Apollo 11 spacecraft and Saturn V before launch.",
      credit: "NASA/JSC",
      sourceUrl: nasaImages.apolloSource,
    },
    keyFacts: [
      { label: "Purpose", value: "First crewed lunar landing" },
      { label: "Launched", value: "1969" },
      { label: "Destination", value: "Moon" },
      { label: "Launch vehicle", value: "Saturn V" },
    ],
    related: [
      { label: "Saturn V", entryId: "explorer-saturn-v" },
      { label: "Apollo Program", entryId: "explorer-apollo-program" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Moon" },
      { label: "Artemis" },
    ],
    sources: [sources.apollo11],
  },
  "explorer-apollo-program": {
    featuredPriority: 80,
    intro:
      "Apollo was NASA's human lunar exploration program, built to land astronauts on the Moon and return them safely to Earth.",
    whyItMatters:
      "Apollo shaped modern mission operations: heavy-lift launch, orbital rendezvous, lunar landing, surface science, and crewed deep-space navigation all had to work together.",
    hero: {
      kind: "apollo",
      imageUrl: nasaImages.apollo,
      imageAlt: "Apollo 11 spacecraft and Saturn V before launch.",
      credit: "NASA/JSC",
      sourceUrl: nasaImages.apolloSource,
    },
    keyFacts: [
      { label: "Program", value: "Crewed lunar exploration" },
      { label: "Agency", value: "NASA" },
      { label: "Era", value: "1960s-1970s" },
      { label: "Icon mission", value: "Apollo 11" },
    ],
    related: [
      { label: "Apollo 11", entryId: "explorer-apollo-11-csm" },
      { label: "Saturn V", entryId: "explorer-saturn-v" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Moon" },
      { label: "Artemis" },
    ],
    sources: [sources.apollo11],
  },
  "explorer-saturn-v": {
    intro:
      "Saturn V was NASA's three-stage heavy-lift rocket, powerful enough to send Apollo spacecraft from Earth orbit toward the Moon.",
    whyItMatters:
      "Its capability defined the Apollo mission architecture: without that lift and translunar injection energy, the lunar landing sequence could not begin.",
    hero: {
      kind: "launch-vehicle",
      imageUrl: nasaImages.apollo,
      imageAlt: "Apollo 11 spacecraft and Saturn V before launch.",
      credit: "NASA/JSC",
      sourceUrl: nasaImages.apolloSource,
    },
    keyFacts: [
      { label: "Capability", value: "Heavy-lift lunar launch" },
      { label: "Major missions", value: "Apollo and Skylab" },
      { label: "Operator", value: "NASA" },
      { label: "Historical role", value: "Sent crews to the Moon" },
    ],
    related: [
      { label: "Apollo 11", entryId: "explorer-apollo-11-csm" },
      { label: "Apollo Program", entryId: "explorer-apollo-program" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Moon" },
    ],
    sources: [sources.apollo11],
  },
  "explorer-hubble": {
    featuredPriority: 95,
    intro:
      "Hubble is a space telescope in low Earth orbit, above most of the atmosphere that blurs and absorbs light for ground observatories.",
    whyItMatters:
      "Its long servicing history and sharp observations transformed public and scientific understanding of galaxies, nebulae, exoplanets, and the age of the universe.",
    hero: {
      kind: "observatory",
      imageUrl: nasaImages.hubble,
      imageAlt: "Hubble Space Telescope photographed from Space Shuttle Atlantis.",
      credit: "NASA/GSFC",
      sourceUrl: nasaImages.hubbleSource,
    },
    keyFacts: [
      { label: "Purpose", value: "Visible, ultraviolet, and infrared astronomy" },
      { label: "Orbit", value: "Low Earth orbit" },
      { label: "Launched", value: "1990" },
      { label: "Status", value: "Operational" },
    ],
    related: [
      { label: "James Webb Space Telescope", entryId: "explorer-jwst" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Space Shuttle servicing" },
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
    ],
    sources: [sources.hubble],
  },
  "explorer-iss": {
    featuredPriority: 100,
    intro:
      "The International Space Station is a permanently crewed laboratory in low Earth orbit, assembled and operated by an international partnership.",
    whyItMatters:
      "The ISS makes low Earth orbit a working research environment where crews, cargo vehicles, robotics, and ground networks operate continuously.",
    hero: {
      kind: "earth-orbit",
      imageAlt: "Diagram of a crewed station orbiting Earth.",
    },
    keyFacts: [
      { label: "Purpose", value: "Crewed research laboratory" },
      { label: "Orbit", value: "Low Earth orbit" },
      { label: "Assembly began", value: "1998" },
      { label: "Status", value: "Operational" },
    ],
    related: [
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Ground stations", entryId: "explorer-goldstone" },
      { label: "Hubble Space Telescope", entryId: "explorer-hubble" },
    ],
    sources: [sources.iss, sources.celestrak],
  },
  "explorer-goldstone": {
    intro:
      "Goldstone is a major NASA Deep Space Network antenna complex in California's Mojave Desert, used to communicate with spacecraft far from Earth.",
    whyItMatters:
      "Deep-space missions depend on enormous, precisely aimed antennas. Goldstone works with Madrid and Canberra so Earth keeps a rotating, planet-wide listening network.",
    hero: {
      kind: "ground-station",
      imageAlt: "Diagram of a large ground antenna communicating with a deep-space spacecraft.",
    },
    keyFacts: [
      { label: "Location", value: "California, United States" },
      { label: "Network", value: "NASA Deep Space Network" },
      { label: "Purpose", value: "Tracking, telemetry, and command" },
      { label: "Role", value: "One of three global DSN complexes" },
    ],
    related: [
      { label: "Voyager 1", entryId: "explorer-voyager-1" },
      { label: "Voyager 2", entryId: "explorer-voyager-2" },
      { label: "James Webb Space Telescope", entryId: "explorer-jwst" },
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
    ],
    sources: [sources.dsn, sources.dsnComplexes],
  },
  "explorer-gps-constellation": {
    featuredPriority: 88,
    intro:
      "GPS is a navigation and timing constellation in medium Earth orbit, arranged so receivers can see multiple spacecraft from almost anywhere on Earth.",
    whyItMatters:
      "Modern navigation, timing, communications, finance, mapping, and emergency response all rely on the precise clocks and geometry of GNSS constellations.",
    hero: {
      kind: "constellation",
      imageAlt: "Diagram of navigation satellites in medium Earth orbit planes.",
    },
    keyFacts: [
      { label: "Purpose", value: "Positioning, navigation, and timing" },
      { label: "Orbit", value: "Medium Earth orbit" },
      { label: "Architecture", value: "Six-plane constellation" },
      { label: "Operator", value: "U.S. Space Force" },
    ],
    related: [
      { label: "Medium Earth Orbit", entryId: "explorer-meo" },
      { label: "Galileo Constellation", entryId: "explorer-galileo-constellation" },
      { label: "Ground stations", entryId: "explorer-goldstone" },
    ],
    sources: [sources.gps, sources.celestrak],
  },
  "explorer-starlink-constellation": {
    featuredPriority: 86,
    intro:
      "Starlink is a large commercial broadband constellation, using many low Earth orbit spacecraft to reduce latency and increase network capacity.",
    whyItMatters:
      "It shows how LEO can become communications infrastructure at planetary scale, while also making orbital traffic, brightness, and debris management more important.",
    hero: {
      kind: "constellation",
      imageAlt: "Diagram of many satellites arranged in low Earth orbit shells.",
    },
    keyFacts: [
      { label: "Purpose", value: "Broadband communications" },
      { label: "Orbit", value: "Low Earth orbit shells" },
      { label: "Operator", value: "SpaceX" },
      { label: "Scale", value: "Large constellation" },
    ],
    related: [
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "OneWeb Constellation", entryId: "explorer-oneweb-constellation" },
      { label: "Debris environment", entryId: "explorer-fengyun-debris" },
      { label: "Ground stations", entryId: "explorer-goldstone" },
    ],
    sources: [sources.celestrak],
  },
  "explorer-galileo-constellation": {
    featuredPriority: 84,
    intro:
      "Galileo is Europe's global navigation constellation, operating in medium Earth orbit to provide precise positioning and timing services.",
    whyItMatters:
      "It adds independent global navigation capability and makes GNSS more resilient by giving receivers another high-quality constellation to combine with GPS.",
    hero: {
      kind: "constellation",
      imageAlt: "Diagram of Galileo navigation satellites in three medium Earth orbit planes.",
    },
    keyFacts: [
      { label: "Purpose", value: "Navigation and timing" },
      { label: "Orbit", value: "Medium Earth orbit" },
      { label: "Architecture", value: "Three-plane constellation" },
      { label: "Operator", value: "EU / ESA" },
    ],
    related: [
      { label: "Medium Earth Orbit", entryId: "explorer-meo" },
      { label: "GPS", entryId: "explorer-gps-constellation" },
      { label: "Ground stations", entryId: "explorer-goldstone" },
    ],
    sources: [sources.esaGalileo, sources.celestrak],
  },
  "explorer-noaa-constellation": {
    featuredPriority: 78,
    intro:
      "NOAA environmental satellites combine polar and geostationary viewpoints to monitor weather, oceans, land, atmosphere, and hazards.",
    whyItMatters:
      "Weather forecasting depends on seeing both the global pattern and fast regional change. The mixed NOAA architecture provides both kinds of view.",
    hero: {
      kind: "constellation",
      imageAlt: "Diagram of polar and geostationary weather satellite coverage.",
    },
    keyFacts: [
      { label: "Purpose", value: "Weather and environmental monitoring" },
      { label: "Orbits", value: "Polar and geostationary" },
      { label: "Operator", value: "NOAA" },
      { label: "Use", value: "Forecasting and hazard awareness" },
    ],
    related: [
      { label: "Geostationary Orbit", entryId: "explorer-geo" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "GOES-16", entryId: "explorer-goes" },
      { label: "Sentinel Program", entryId: "explorer-sentinel-constellation" },
    ],
    sources: [sources.noaaSatellites, sources.celestrak],
  },
  "explorer-sentinel-constellation": {
    featuredPriority: 72,
    intro:
      "The Copernicus Sentinel missions are European Earth-observation spacecraft families built for systematic environmental monitoring.",
    whyItMatters:
      "Sentinel data turns orbital coverage into public infrastructure for climate records, oceans, land, ice, agriculture, emergency response, and air quality.",
    hero: {
      kind: "constellation",
      imageAlt: "Diagram of coordinated Earth-observation satellites in polar orbits.",
    },
    keyFacts: [
      { label: "Purpose", value: "Earth observation" },
      { label: "Orbit style", value: "Repeatable polar families" },
      { label: "Program", value: "Copernicus" },
      { label: "Operator", value: "ESA / European Commission" },
    ],
    related: [
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "NOAA satellites", entryId: "explorer-noaa-constellation" },
      { label: "Sentinel-3A", entryId: "explorer-sentinel" },
      { label: "Geostationary Orbit", entryId: "explorer-geo" },
    ],
    sources: [sources.esaSentinel3, sources.celestrak],
  },
  "explorer-leo": {
    intro:
      "Low Earth orbit is the region close to Earth where spacecraft circle quickly, pass over new ground every few minutes, and remain reachable with modest signal delay.",
    whyItMatters:
      "LEO is where human spaceflight, Earth observation, many science missions, broadband constellations, and most tracked debris share the same crowded neighborhood.",
    hero: {
      kind: "leo",
      imageAlt: "Diagram comparing a low orbit close to Earth with higher orbital regions.",
    },
    keyFacts: [
      { label: "Typical altitude", value: "About 160-2,000 km" },
      { label: "Period", value: "Roughly 90-130 minutes" },
      { label: "Strength", value: "Low latency and close Earth views" },
      { label: "Tradeoff", value: "Short ground passes" },
    ],
    related: [
      { label: "International Space Station", entryId: "explorer-iss" },
      { label: "Hubble Space Telescope", entryId: "explorer-hubble" },
      { label: "Starlink", entryId: "explorer-starlink-constellation" },
      { label: "Medium Earth Orbit", entryId: "explorer-meo" },
      { label: "Geostationary Orbit", entryId: "explorer-geo" },
    ],
    sources: [sources.nasaBasics, sources.celestrak],
  },
  "explorer-meo": {
    intro:
      "Medium Earth orbit sits between low Earth orbit and geostationary altitude, giving each spacecraft a broad view without requiring a full 24-hour orbit.",
    whyItMatters:
      "Navigation systems use MEO because a moderate number of satellites can cover the globe while preserving useful geometry for precise ranging.",
    hero: {
      kind: "meo",
      imageAlt: "Diagram of a medium Earth orbit navigation shell between LEO and GEO.",
    },
    keyFacts: [
      { label: "Typical use", value: "Navigation and timing" },
      { label: "Example", value: "GPS and Galileo" },
      { label: "Coverage", value: "Large Earth footprint" },
      { label: "Tradeoff", value: "Higher latency than LEO" },
    ],
    related: [
      { label: "GPS", entryId: "explorer-gps-constellation" },
      { label: "Galileo", entryId: "explorer-galileo-constellation" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Geostationary Orbit", entryId: "explorer-geo" },
    ],
    sources: [sources.gps, sources.esaGalileo, sources.celestrak],
  },
  "explorer-geo": {
    intro:
      "Geostationary orbit is a circular equatorial orbit where a spacecraft matches Earth's rotation and appears fixed above one longitude.",
    whyItMatters:
      "That fixed viewpoint is ideal for weather monitoring, broadcast, and communications because antennas and cameras can keep looking at the same region.",
    hero: {
      kind: "geo",
      imageAlt: "Diagram of a geostationary spacecraft holding position above one longitude.",
    },
    keyFacts: [
      { label: "Altitude", value: "35,786 km" },
      { label: "Period", value: "One sidereal day" },
      { label: "Best for", value: "Weather and communications" },
      { label: "Requirement", value: "Near-equatorial circular orbit" },
    ],
    related: [
      { label: "GOES-16", entryId: "explorer-goes" },
      { label: "NOAA satellites", entryId: "explorer-noaa-constellation" },
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Medium Earth Orbit", entryId: "explorer-meo" },
    ],
    sources: [sources.nasaBasics, sources.celestrak],
  },
  "explorer-lagrange-points": {
    intro:
      "Lagrange points are places in a two-body system where gravity and orbital motion combine so a smaller object can stay near a stable relative position.",
    whyItMatters:
      "They are natural mission design landmarks: some offer broad solar views, some help deep-space observatories stay cold, and some are useful staging regions.",
    hero: {
      kind: "lagrange",
      imageAlt: "Diagram of Sun-Earth Lagrange point locations.",
    },
    keyFacts: [
      { label: "System", value: "Two large bodies plus spacecraft" },
      { label: "Named points", value: "L1 through L5" },
      { label: "Use", value: "Observation and stationkeeping" },
      { label: "Example", value: "Sun-Earth L2" },
    ],
    related: [
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
      { label: "Halo Orbit", entryId: "explorer-halo-orbit" },
      { label: "James Webb Space Telescope", entryId: "explorer-jwst" },
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
    ],
    sources: [sources.nasaBasics],
  },
  "explorer-sun-earth-l2": {
    intro:
      "Sun-Earth L2 is a Lagrange region about 1.5 million km beyond Earth from the Sun, valuable for observatories that need stable shade and a wide sky view.",
    whyItMatters:
      "L2 lets missions like Webb keep the Sun, Earth, and Moon on one side, simplifying thermal control and communications while preserving deep-space visibility.",
    hero: {
      kind: "lagrange",
      imageAlt: "Diagram of Sun, Earth, and the L2 region beyond Earth.",
    },
    keyFacts: [
      { label: "Distance", value: "About 1.5 million km from Earth" },
      { label: "Used by", value: "Webb and other observatories" },
      { label: "Orbit style", value: "Halo or Lissajous paths" },
      { label: "Why useful", value: "Stable shade and sky access" },
    ],
    related: [
      { label: "James Webb Space Telescope", entryId: "explorer-jwst" },
      { label: "Lagrange Points", entryId: "explorer-lagrange-points" },
      { label: "Halo Orbit", entryId: "explorer-halo-orbit" },
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
    ],
    sources: [sources.nasaBasics, sources.webb],
  },
  "explorer-halo-orbit": {
    intro:
      "A halo orbit is a three-dimensional loop around a Lagrange point, keeping a spacecraft near a useful gravitational region without sitting exactly on it.",
    whyItMatters:
      "Halo orbits turn delicate balance regions into practical mission paths, giving observatories geometry for power, cooling, communications, and sky access.",
    hero: {
      kind: "halo",
      imageAlt: "Diagram of a looping halo orbit around Sun-Earth L2.",
    },
    keyFacts: [
      { label: "Used near", value: "Lagrange points" },
      { label: "Shape", value: "Three-dimensional loop" },
      { label: "Example", value: "Webb near Sun-Earth L2" },
      { label: "Need", value: "Regular stationkeeping" },
    ],
    related: [
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
      { label: "Lagrange Points", entryId: "explorer-lagrange-points" },
      { label: "James Webb Space Telescope", entryId: "explorer-jwst" },
    ],
    sources: [sources.nasaBasics, sources.webb],
  },
};

const curatedEducationIdByCatalogNumber: Readonly<Record<string, string>> = {
  "20580": "explorer-hubble",
  "25544": "explorer-iss",
};

function defaultHeroFor(entry: ExplorerCatalogEntry): ExplorerHeroMedia {
  if (entry.categoryId === "ground-stations") {
    return {
      kind: "ground-station",
      imageAlt: "Diagram of an Earth-based antenna communicating with a spacecraft.",
    };
  }

  if (entry.categoryId === "constellations") {
    return {
      kind: "constellation",
      imageAlt: "Diagram of coordinated spacecraft arranged around Earth.",
    };
  }

  if (entry.categoryId === "rocket-bodies") {
    return {
      kind: "launch-vehicle",
      imageAlt: "Diagram of a launch vehicle stage in orbit.",
    };
  }

  if (entry.categoryId === "debris") {
    return {
      kind: "debris",
      imageAlt: "Diagram of tracked orbital debris near Earth.",
    };
  }

  if (entry.categoryId === "missions") {
    return {
      kind: "deep-space",
      imageAlt: "Diagram of a mission path extending away from Earth.",
    };
  }

  if ((entry.orbit?.altitudeKm ?? 0) >= 30_000) {
    return {
      kind: "geo",
      imageAlt: "Diagram of a high Earth orbit spacecraft.",
    };
  }

  if ((entry.orbit?.altitudeKm ?? 0) > 2_000) {
    return {
      kind: "meo",
      imageAlt: "Diagram of a medium Earth orbit spacecraft.",
    };
  }

  return {
    kind: "earth-orbit",
    imageAlt: "Diagram of a spacecraft orbiting Earth.",
  };
}

function orbitRelated(entry: ExplorerCatalogEntry): ExplorerRelatedTopic[] {
  const altitude = entry.orbit?.altitudeKm;
  const regime =
    altitude === undefined
      ? []
      : altitude >= 30_000
        ? [{ label: "Geostationary Orbit", entryId: "explorer-geo" }]
        : altitude > 2_000
          ? [{ label: "Medium Earth Orbit", entryId: "explorer-meo" }]
          : [{ label: "Low Earth Orbit", entryId: "explorer-leo" }];

  return [
    ...regime,
    ...(entry.constellationId
      ? [{ label: "Parent constellation", entryId: entry.constellationId }]
      : []),
    { label: "Ground stations", entryId: "explorer-goldstone" },
  ];
}

function fallbackSources(entry: ExplorerCatalogEntry): ExplorerOfficialSource[] {
  if (entry.catalogNumber) {
    return [sources.celestrak];
  }

  if (entry.operator.includes("NASA")) {
    return [sources.nasaBasics];
  }

  return [sources.celestrak, sources.nasaBasics];
}

function fallbackRelated(entry: ExplorerCatalogEntry): ExplorerRelatedTopic[] {
  if (entry.categoryId === "ground-stations") {
    return [
      { label: "Deep Space Network", entryId: "explorer-goldstone" },
      { label: "Voyager 1", entryId: "explorer-voyager-1" },
      { label: "Sun-Earth L2", entryId: "explorer-sun-earth-l2" },
    ];
  }

  if (entry.categoryId === "constellations") {
    const architecture = explorerConstellationArchitectureFor(entry.id);
    const orbitTopic = architecture?.orbitalClassification.toLowerCase().includes("medium")
      ? { label: "Medium Earth Orbit", entryId: "explorer-meo" }
      : architecture?.orbitalClassification.toLowerCase().includes("geo")
        ? { label: "Geostationary Orbit", entryId: "explorer-geo" }
        : { label: "Low Earth Orbit", entryId: "explorer-leo" };

    return [
      orbitTopic,
      { label: "Ground stations", entryId: "explorer-goldstone" },
      { label: "Orbital environment", entryId: "explorer-leo" },
    ];
  }

  if (entry.categoryId === "debris") {
    return [
      { label: "Low Earth Orbit", entryId: "explorer-leo" },
      { label: "Starlink", entryId: "explorer-starlink-constellation" },
      { label: "Ground stations", entryId: "explorer-goldstone" },
    ];
  }

  return orbitRelated(entry);
}

function fallbackIntro(entry: ExplorerCatalogEntry): string {
  if (entry.categoryId === "constellations") {
    const architecture = explorerConstellationArchitectureFor(entry.id);
    return architecture
      ? `${entry.name} is ${architecture.purpose.toLowerCase()} infrastructure arranged as a ${architecture.orbitalClassification.toLowerCase()}.`
      : entry.summary;
  }

  return entry.summary;
}

function fallbackWhy(entry: ExplorerCatalogEntry): string {
  if (entry.categoryId === "debris") {
    return "Debris matters because orbital space is shared infrastructure: fragments can remain for years and shape how missions plan collision avoidance, disposal, and traffic coordination.";
  }

  if (entry.categoryId === "rocket-bodies") {
    return "Launch vehicle stages are part of the real orbital environment. They connect mission history to the long-term catalog of objects that operators must track.";
  }

  if (entry.categoryId === "ground-stations") {
    return "Ground stations turn spacecraft from isolated machines into operated missions by providing tracking, telemetry, commands, and data return.";
  }

  if (entry.categoryId === "constellations") {
    return "Constellations show that coverage is an architectural problem: altitude, inclination, planes, and spacing matter as much as individual spacecraft.";
  }

  return "This object is part of the space ecosystem, where purpose, orbit, operator, and lifetime all affect how it is tracked and understood.";
}

export function explorerEducationForEntry(entry: ExplorerCatalogEntry): ExplorerEducationContent {
  const educationId = entry.catalogNumber
    ? curatedEducationIdByCatalogNumber[entry.catalogNumber] ?? entry.id
    : entry.id;
  const curated = curatedEducation[educationId];
  if (curated) return curated;

  return {
    intro: fallbackIntro(entry),
    whyItMatters: fallbackWhy(entry),
    hero: defaultHeroFor(entry),
    related: fallbackRelated(entry).slice(0, 5),
    sources: fallbackSources(entry),
  };
}

export function explorerFeaturedEducationPriority(entry: ExplorerCatalogEntry): number | null {
  const educationId = entry.catalogNumber
    ? curatedEducationIdByCatalogNumber[entry.catalogNumber] ?? entry.id
    : entry.id;
  return curatedEducation[educationId]?.featuredPriority ?? null;
}

export function explorerEducationSourceCatalog(): Record<string, ExplorerOfficialSource> {
  return sources;
}
