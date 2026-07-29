export type PropagatorCapability =
  | "two-body"
  | "sgp4"
  | "j2"
  | "drag"
  | "third-body"
  | "numerical"
  | "heliocentric"
  | "catalog";

export interface PropagatorDescriptor {
  id: PropagatorCapability;
  label: string;
  implemented: boolean;
  notes: string;
}

export const PROPAGATOR_ROADMAP: PropagatorDescriptor[] = [
  {
    id: "two-body",
    label: "Two-body Keplerian",
    implemented: true,
    notes: "Default analytic Earth orbit propagation."
  },
  {
    id: "sgp4",
    label: "SGP4 / TLE",
    implemented: true,
    notes: "TLE propagation via satellite.js, treated as ECI/TEME for the MVP display path."
  },
  {
    id: "j2",
    label: "J2 perturbation",
    implemented: false,
    notes: "Reserved extension point for oblateness-driven precession."
  },
  {
    id: "drag",
    label: "Atmospheric drag",
    implemented: false,
    notes: "Reserved for density models and ballistic coefficient inputs."
  },
  {
    id: "third-body",
    label: "Sun / Moon perturbations",
    implemented: false,
    notes: "Reserved for multi-body force models."
  },
  {
    id: "numerical",
    label: "Numerical propagation",
    implemented: false,
    notes: "Reserved for Cowell-style integrators and custom force models."
  },
  {
    id: "heliocentric",
    label: "Asteroid / heliocentric",
    implemented: false,
    notes: "Reserved for non-Earth-centered scenarios."
  },
  {
    id: "catalog",
    label: "Full catalog rendering",
    implemented: false,
    notes: "Reserved for large object batches and debris visualization."
  }
];

export { propagateCartesianTwoBody, propagateSgp4, propagateTwoBody } from './propagators/index';
