/**
 * Скалярные поля генерации: высота, влажность, температура.
 * Каждое поле — независимый fBm со своим смещением от зерна.
 * В коде нет сеттинговых сущностей — только числа.
 */

import { fbm2 } from "./noise";

export type FieldKind = "height" | "moisture" | "temperature";

const SEED_OFFSETS: Record<FieldKind, number> = {
  height: 7919,
  moisture: 104729,
  temperature: 1299709,
};

export interface FieldOptions {
  seed: string;
  kind: FieldKind;
  /** частота структур */
  fieldScale: number;
  /** число октав (зависит от detail) */
  octaves: number;
  /** 0..1 — амплитуда и резкость (контрастная кривая) */
  relief: number;
  /** 0..1 — смещение уровня (влажность) */
  bias: number;
}

/** Одно значение поля в точке (x, y), нормализовано в [0, 1]. */
export function sampleField(x: number, y: number, o: FieldOptions): number {
  const base = fbm2(x * o.fieldScale, y * o.fieldScale, SEED_OFFSETS[o.kind], o.octaves);
  // Контрастная кривая вокруг 0.5: relief усиливает перепады.
  const contrast = 1 + o.relief * 2.2;
  let v = 0.5 + (base - 0.5) * contrast;
  v += (o.bias - 0.5) * 0.6;
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  return v;
}

/**
 * Сетка поля (res+1)² узлов, покрывающая bounds.
 * Возвращает row-major Float32Array; нормализация к max стороне bounds.
 */
export function buildFieldGrid(
  bounds: { x: number; y: number; width: number; height: number },
  res: number,
  o: FieldOptions,
): Float32Array {
  const size = res + 1;
  const grid = new Float32Array(size * size);
  const scale = Math.max(bounds.width, bounds.height) || 1;
  for (let j = 0; j <= res; j += 1) {
    for (let i = 0; i <= res; i += 1) {
      const wx = bounds.x + (i / res) * bounds.width;
      const wy = bounds.y + (j / res) * bounds.height;
      grid[j * size + i] = sampleField(wx / scale, wy / scale, o);
    }
  }
  return grid;
}
