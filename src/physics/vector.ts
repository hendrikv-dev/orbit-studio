import type { Vector3Tuple } from "../types/orbit";

export function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export const subtract = sub;

export function scale(v: Vector3Tuple, scalar: number): Vector3Tuple {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

export function dot(a: Vector3Tuple, b: Vector3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function magnitude(v: Vector3Tuple): number {
  return Math.sqrt(dot(v, v));
}

export function normalize(v: Vector3Tuple): Vector3Tuple {
  const length = magnitude(v);
  return length === 0 ? [0, 0, 0] : scale(v, 1 / length);
}

export function finiteVector(v: Vector3Tuple): boolean {
  return v.every(Number.isFinite);
}
