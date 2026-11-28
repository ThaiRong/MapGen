/**
 * Валидация и санитизация вывода модели (итерация 6, фаза 6.2).
 *
 * Чистая функция: разбирает текст ответа, приводит к контрактам спек
 * итераций 3–4 (диапазоны, допустимые значения), отбрасывает мусор с
 * предупреждениями. Ничего не применяет — только формирует предложение
 * параметров. Невалидный ответ целиком отклоняется понятной ошибкой.
 */

import type { GenerationSpec, StructureArchetype, StructureSpec } from "../types";
import { ModelError, type ModelMode, type SpecSuggestion } from "./adapter";

const ARCHETYPES: StructureArchetype[] = ["cellular", "linear", "radial", "cluster", "open", "mixed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Достаёт первый JSON-объект из ответа: голый JSON, блок ```json или проза вокруг. */
function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidates = [fence?.[1], trimmed];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    } catch {
      // пробуем следующий вариант
    }
  }
  throw new ModelError("Ответ модели не является JSON-объектом", "invalid-response");
}

function readNumber(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  warnings: string[],
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    warnings.push(`Поле «${key}» пропущено: ожидалось число`);
    return undefined;
  }
  const clamped = Math.min(max, Math.max(min, value));
  if (clamped !== value) {
    warnings.push(`Поле «${key}» приведено к диапазону [${min}, ${max}]`);
  }
  return clamped;
}

const TERRAIN_NUMBERS: { key: keyof GenerationSpec; min: number; max: number }[] = [
  { key: "relief", min: 0, max: 1 },
  { key: "moisture", min: 0, max: 1 },
  { key: "temperature", min: -1, max: 1 },
  { key: "fluidLevel", min: 0, max: 1 },
  { key: "areaDensity", min: 0, max: 1 },
  { key: "lineDensity", min: 0, max: 1 },
  { key: "pointDensity", min: 0, max: 1 },
  { key: "detail", min: 0, max: 1 },
  { key: "fieldScale", min: 0.5, max: 3 },
];

const STRUCTURE_NUMBERS: { key: keyof StructureSpec; min: number; max: number }[] = [
  { key: "density", min: 0, max: 1 },
  { key: "cellScale", min: 0, max: 1 },
  { key: "irregularity", min: 0, max: 1 },
  { key: "connectivity", min: 0, max: 1 },
  { key: "sizeVariance", min: 0, max: 1 },
  { key: "pointDensity", min: 0, max: 1 },
  { key: "margin", min: 0, max: 1 },
  { key: "detail", min: 0, max: 1 },
];

/**
 * Санитизация ответа модели в предложение параметров.
 * Бросает ModelError, если распознать нечего — ничего не применяется.
 */
export function sanitizeModelOutput(text: string, mode: ModelMode): SpecSuggestion {
  const raw = extractJson(text);
  const warnings: string[] = [];
  const recognized: { key: string; value: string }[] = [];

  if (mode === "terrain") {
    const spec: Partial<GenerationSpec> = {};
    for (const { key, min, max } of TERRAIN_NUMBERS) {
      const value = readNumber(raw, key, min, max, warnings);
      if (value !== undefined) {
        (spec as Record<string, unknown>)[key] = value;
        recognized.push({ key, value: String(Math.round(value * 100) / 100) });
      }
    }
    if (Object.keys(spec).length === 0) {
      throw new ModelError(
        "Модель не распознала ни одного параметра местности — попробуйте переформулировать описание",
        "invalid-response",
      );
    }
    return { mode, spec, recognized, warnings };
  }

  const spec: Partial<StructureSpec> = {};
  const archetypeRaw = raw.archetype;
  if (archetypeRaw !== undefined) {
    if (typeof archetypeRaw === "string" && (ARCHETYPES as string[]).includes(archetypeRaw)) {
      spec.archetype = archetypeRaw as StructureArchetype;
      recognized.push({ key: "archetype", value: archetypeRaw });
    } else {
      warnings.push("Поле «archetype» пропущено: неизвестное значение");
    }
  }
  for (const { key, min, max } of STRUCTURE_NUMBERS) {
    const value = readNumber(raw, key, min, max, warnings);
    if (value !== undefined) {
      (spec as Record<string, unknown>)[key] = value;
      recognized.push({ key, value: String(Math.round(value * 100) / 100) });
    }
  }
  const nestedRaw = raw.nestedCount;
  if (nestedRaw !== undefined) {
    if (typeof nestedRaw === "number" && Number.isFinite(nestedRaw)) {
      const nested = Math.min(8, Math.max(0, Math.round(nestedRaw)));
      spec.nestedCount = nested;
      recognized.push({ key: "nestedCount", value: String(nested) });
      if (nested !== nestedRaw) warnings.push("Поле «nestedCount» приведено к диапазону [0, 8]");
    } else {
      warnings.push("Поле «nestedCount» пропущено: ожидалось число");
    }
  }
  if (Object.keys(spec).length === 0) {
    throw new ModelError(
      "Модель не распознала ни одного параметра структуры — попробуйте переформулировать описание",
      "invalid-response",
    );
  }
  return { mode, spec, recognized, warnings };
}
