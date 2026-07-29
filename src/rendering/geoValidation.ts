export interface GeoValidationPoint {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  kind: "city" | "dsn";
}

export const GEO_VALIDATION_POINTS: GeoValidationPoint[] = [
  {
    id: "portland-or",
    name: "Portland, OR",
    latitudeDeg: 45.5152,
    longitudeDeg: -122.6784,
    kind: "city",
  },
  {
    id: "seattle-wa",
    name: "Seattle, WA",
    latitudeDeg: 47.6062,
    longitudeDeg: -122.3321,
    kind: "city",
  },
  {
    id: "new-york",
    name: "New York",
    latitudeDeg: 40.7128,
    longitudeDeg: -74.006,
    kind: "city",
  },
  {
    id: "london",
    name: "London",
    latitudeDeg: 51.5074,
    longitudeDeg: -0.1278,
    kind: "city",
  },
  {
    id: "tokyo",
    name: "Tokyo",
    latitudeDeg: 35.6762,
    longitudeDeg: 139.6503,
    kind: "city",
  },
  {
    id: "sydney",
    name: "Sydney",
    latitudeDeg: -33.8688,
    longitudeDeg: 151.2093,
    kind: "city",
  },
  {
    id: "goldstone-dss-14",
    name: "Goldstone DSS-14",
    latitudeDeg: 35.4267,
    longitudeDeg: -116.89,
    kind: "dsn",
  },
  {
    id: "madrid-dss-63",
    name: "Madrid DSS-63",
    latitudeDeg: 40.4314,
    longitudeDeg: -4.2486,
    kind: "dsn",
  },
  {
    id: "canberra-dss-43",
    name: "Canberra DSS-43",
    latitudeDeg: -35.402,
    longitudeDeg: 148.981,
    kind: "dsn",
  },
];
