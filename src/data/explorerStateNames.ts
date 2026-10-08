/**
 * GCAT state codes, resolved to readable names.
 *
 * The catalog records a responsible *state* alongside an *owner* organisation.
 * Only the owner was exported, so both fields in the interface fell back to it
 * and a record read "Operator KVR / Region KVR" — a code repeated twice, with
 * neither field saying what it meant. The state code is exported now and
 * resolved here.
 *
 * GCAT's codes are not ISO 3166. It uses single letters for several European
 * states (F, D, I, E, L, N, S, B, P, T), keeps historical entities distinct
 * from their successors (SU and RU are different states, as are CSSR, CSFR and
 * CZ), and prefixes international organisations with `I-`. Mapping them onto
 * ISO would erase exactly the distinctions the catalog is careful to record, so
 * this table follows GCAT rather than correcting it.
 *
 * All 123 codes present in the 2026-06-27 snapshot are covered. An unknown code
 * is returned unchanged rather than guessed at.
 */

const STATE_NAMES: Readonly<Record<string, string>> = {
  // Historical entities are deliberately distinct from their successors.
  SU: "Soviet Union",
  RU: "Russia",
  CSSR: "Czechoslovakia",
  CSFR: "Czech and Slovak Federative Republic",
  CZ: "Czechia",

  US: "United States",
  CN: "China",
  UK: "United Kingdom",
  IN: "India",
  NZ: "New Zealand",
  CA: "Canada",
  KR: "South Korea",
  KP: "North Korea",
  AU: "Australia",
  IL: "Israel",
  TR: "Türkiye",
  UY: "Uruguay",
  FI: "Finland",
  TW: "Taiwan",
  BR: "Brazil",
  IR: "Iran",
  UAE: "United Arab Emirates",
  ID: "Indonesia",
  SG: "Singapore",
  CH: "Switzerland",
  PL: "Poland",
  NL: "Netherlands",
  GR: "Greece",
  MX: "Mexico",
  SA: "Saudi Arabia",
  AR: "Argentina",
  DK: "Denmark",
  MY: "Malaysia",
  HK: "Hong Kong",
  EG: "Egypt",
  PK: "Pakistan",
  MN: "Mongolia",
  HU: "Hungary",
  LT: "Lithuania",
  ZA: "South Africa",
  PH: "Philippines",
  KZ: "Kazakhstan",
  UA: "Ukraine",
  DZ: "Algeria",
  CL: "Chile",
  VN: "Vietnam",
  RW: "Rwanda",
  NG: "Nigeria",
  BY: "Belarus",
  MA: "Morocco",
  AT: "Austria",
  PE: "Peru",
  EC: "Ecuador",
  SK: "Slovakia",
  CO: "Colombia",
  VE: "Venezuela",
  RO: "Romania",
  AZ: "Azerbaijan",
  EE: "Estonia",
  QA: "Qatar",
  MC: "Monaco",
  IE: "Ireland",
  NP: "Nepal",
  SI: "Slovenia",
  KW: "Kuwait",
  MU: "Mauritius",
  PR: "Puerto Rico",
  BD: "Bangladesh",
  AO: "Angola",
  KE: "Kenya",
  BT: "Bhutan",
  ET: "Ethiopia",
  TN: "Tunisia",
  AM: "Armenia",
  ZW: "Zimbabwe",
  DJ: "Djibouti",
  BO: "Bolivia",
  PG: "Papua New Guinea",
  LA: "Laos",
  LV: "Latvia",
  GH: "Ghana",
  CR: "Costa Rica",
  JO: "Jordan",
  LK: "Sri Lanka",
  SD: "Sudan",
  GT: "Guatemala",
  PY: "Paraguay",
  MD: "Moldova",
  UG: "Uganda",
  SN: "Senegal",
  OM: "Oman",
  HR: "Croatia",
  BW: "Botswana",
  BH: "Bahrain",
  SB: "Solomon Islands",
  ME: "Montenegro",

  // GCAT's single-letter European codes.
  F: "France",
  J: "Japan",
  D: "Germany",
  I: "Italy",
  E: "Spain",
  L: "Luxembourg",
  N: "Norway",
  S: "Sweden",
  B: "Belgium",
  P: "Portugal",
  T: "Thailand",

  // Registrations made through a dependency or overseas territory.
  BGN: "Bulgaria",
  HKUK: "Hong Kong (United Kingdom)",
  CYM: "Cayman Islands",
  BM: "Bermuda",
  MYM: "Myanmar",

  // International organisations, which GCAT prefixes with I-.
  "I-ESA": "European Space Agency",
  "I-INT": "Intelsat",
  "I-EU": "European Union",
  "I-EUM": "EUMETSAT",
  "I-EUT": "Eutelsat",
  "I-ESRO": "European Space Research Organisation",
  "I-ARAB": "Arabsat",
  "I-INM": "Inmarsat",
  "I-NATO": "NATO",
  "I-RASC": "RascomStar-QAF",
};

/**
 * Readable name for a GCAT state code.
 *
 * An unmapped code is returned as-is: showing the raw token is honest, and
 * better than inventing a country for it.
 */
export function explorerStateName(code: string | undefined | null): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  // GCAT writes "-" where no state is recorded.
  if (!trimmed || trimmed === "-") return null;
  return STATE_NAMES[trimmed] ?? trimmed;
}

/** True where the code resolved to a name rather than falling through. */
export function isKnownExplorerStateCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return Object.prototype.hasOwnProperty.call(STATE_NAMES, code.trim());
}
