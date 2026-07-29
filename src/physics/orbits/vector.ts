import type { Vector3, Vector3Tuple } from './types';

type VectorLike = Vector3 | Vector3Tuple;

export const vector = (x = 0, y = 0, z = 0): Vector3 => ({ x, y, z });

const component = (value: VectorLike, index: 0 | 1 | 2): number => {
  if (Array.isArray(value)) return value[index];
  return index === 0 ? value.x : index === 1 ? value.y : value.z;
};

export const add = (a: VectorLike, b: VectorLike): Vector3 =>
  vector(component(a, 0) + component(b, 0), component(a, 1) + component(b, 1), component(a, 2) + component(b, 2));

export const subtract = (a: VectorLike, b: VectorLike): Vector3 =>
  vector(component(a, 0) - component(b, 0), component(a, 1) - component(b, 1), component(a, 2) - component(b, 2));

export const scale = (a: VectorLike, scalar: number): Vector3 =>
  vector(component(a, 0) * scalar, component(a, 1) * scalar, component(a, 2) * scalar);

export const dot = (a: VectorLike, b: VectorLike): number =>
  component(a, 0) * component(b, 0) + component(a, 1) * component(b, 1) + component(a, 2) * component(b, 2);

export const cross = (a: VectorLike, b: VectorLike): Vector3 =>
  vector(
    component(a, 1) * component(b, 2) - component(a, 2) * component(b, 1),
    component(a, 2) * component(b, 0) - component(a, 0) * component(b, 2),
    component(a, 0) * component(b, 1) - component(a, 1) * component(b, 0),
  );

export const magnitude = (a: VectorLike): number => Math.sqrt(dot(a, a));

export const normalize = (a: VectorLike): Vector3 => {
  const mag = magnitude(a);
  return mag === 0 ? vector() : scale(a, 1 / mag);
};
