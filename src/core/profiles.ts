/**
 * Профили сеттинга — чистые данные пользователя.
 * В модуле нет ни одного сеттингового слова и ветвлений по содержимому:
 * только структура, ссылки, шаблоны и списки слов из данных.
 */

import type {
  LegendType,
  NamingRule,
  PrimitiveKind,
  SettingProfile,
  SpecNaming,
  StructureArchetype,
} from "./types";
import { createRng, type Rng } from "./generation/rng";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ARCHETYPES = new Set<string>(["cellular", "linear", "radial", "cluster", "open", "mixed"]);
const SHAPES = new Set<string>(["point", "line", "area", "label"]);
const APPLIES_TO = new Set<string>(["area", "line", "point", "label", "location"]);

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateNamingRule(raw: unknown, where: string): NamingRule | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.name !== "string") return null;
  if (typeof raw.appliesTo !== "string" || !APPLIES_TO.has(raw.appliesTo)) return null;
  if (typeof raw.pattern !== "string") return null;
  const lists: Record<string, string[]> = {};
  if (isRecord(raw.lists)) {
    for (const [k, v] of Object.entries(raw.lists)) {
      if (Array.isArray(v)) lists[k] = v.filter((w): w is string => typeof w === "string" && w.trim().length > 0);
    }
  }
  void where;
  return { id: raw.id, name: raw.name, appliesTo: raw.appliesTo as NamingRule["appliesTo"], pattern: raw.pattern, lists };
}

function validateTypeMapping(raw: unknown): { area: string; line: string; point: string; label: string } | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.area === "string" &&
    typeof raw.line === "string" &&
    typeof raw.point === "string" &&
    typeof raw.label === "string"
  ) {
    return { area: raw.area, line: raw.line, point: raw.point, label: raw.label };
  }
  return null;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Новый профиль создаётся пустым, с нуля — без встроенных наборов. */
export function createEmptyProfile(name: string): SettingProfile {
  const ts = Date.now();
  return {
    id: newId(),
    name: name.trim() || "Новый профиль",
    description: "",
    version: 1,
    categories: [],
    legendTypes: [],
    namingRules: [],
    locationKinds: [],
    terrainKinds: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export interface ProfileValidationResult {
  profile: SettingProfile;
  warnings: string[];
}

/**
 * Разбирает профиль из JSON-данных. Битые ссылки и записи не роняют
 * загрузку — они пропускаются с предупреждениями.
 */
export function validateSettingProfile(raw: unknown): ProfileValidationResult {
  if (!isRecord(raw)) throw new ProfileError("Файл профиля повреждён: это не JSON-объект");
  if (typeof raw.id !== "string" || !raw.id) throw new ProfileError("В профиле отсутствует id");
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new ProfileError("В профиле отсутствует название");
  const warnings: string[] = [];

  const categories: SettingProfile["categories"] = [];
  if (Array.isArray(raw.categories)) {
    for (const c of raw.categories) {
      if (isRecord(c) && typeof c.id === "string" && typeof c.name === "string") {
        categories.push({ id: c.id, name: c.name, order: num(c.order) ? c.order : categories.length });
      }
    }
  }
  const categoryIds = new Set(categories.map((c) => c.id));

  const legendTypes: LegendType[] = [];
  const typeIds = new Set<string>();
  if (Array.isArray(raw.legendTypes)) {
    for (const t of raw.legendTypes) {
      if (!isRecord(t)) continue;
      if (typeof t.id !== "string" || !t.id || typeIds.has(t.id)) {
        warnings.push("Тип легенды с дублирующимся или пустым id пропущен");
        continue;
      }
      if (typeof t.name !== "string" || !t.name.trim()) continue;
      if (typeof t.shape !== "string" || !SHAPES.has(t.shape)) continue;
      typeIds.add(t.id);
      legendTypes.push({
        id: t.id,
        name: t.name.trim(),
        category: typeof t.category === "string" ? t.category : "",
        shape: t.shape as LegendType["shape"],
        color: typeof t.color === "string" && t.color ? t.color : "#9aa3b2",
        opacity: num(t.opacity) ? Math.min(1, Math.max(0, t.opacity)) : 1,
        strokeWidth: num(t.strokeWidth) ? Math.min(20, Math.max(1, t.strokeWidth)) : 2,
        strokeStyle: t.strokeStyle === "dashed" ? "dashed" : "solid",
        visible: t.visible !== false,
        isBuiltin: false,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
        updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : new Date(0).toISOString(),
      });
    }
  }

  const namingRules: NamingRule[] = [];
  const ruleIds = new Set<string>();
  if (Array.isArray(raw.namingRules)) {
    for (const r of raw.namingRules) {
      const rule = validateNamingRule(r, "namingRules");
      if (!rule) {
        warnings.push("Правило именования повреждено и пропущено");
        continue;
      }
      if (ruleIds.has(rule.id)) {
        warnings.push(`Правило именования «${rule.name}» с дублирующимся id пропущено`);
        continue;
      }
      ruleIds.add(rule.id);
      namingRules.push(rule);
    }
  }

  const locationKinds: SettingProfile["locationKinds"] = [];
  const locationKindIds = new Set<string>();
  const checkMappingRefs = (kindName: string, mapping: { area: string; line: string; point: string; label: string }) => {
    for (const [shape, id] of Object.entries(mapping)) {
      const target = legendTypes.find((t) => t.id === id);
      if (!target) {
        warnings.push(`Вид «${kindName}» ссылается на отсутствующий тип «${id}» (${shape})`);
      } else if (target.shape !== shape) {
        warnings.push(`Вид «${kindName}»: тип «${target.name}» имеет форму «${target.shape}», а нужна «${shape}»`);
      }
    }
  };
  if (Array.isArray(raw.locationKinds)) {
    for (const k of raw.locationKinds) {
      if (!isRecord(k) || typeof k.id !== "string" || !k.id) continue;
      if (typeof k.name !== "string" || !k.name.trim()) continue;
      if (typeof k.archetype !== "string" || !ARCHETYPES.has(k.archetype)) continue;
      const mapping = validateTypeMapping(k.typeMapping);
      if (!mapping) {
        warnings.push(`Вид локации «${k.name}» без маппинга типов пропущен`);
        continue;
      }
      if (locationKindIds.has(k.id)) {
        warnings.push(`Вид локации «${k.name}» с дублирующимся id пропущен`);
        continue;
      }
      locationKindIds.add(k.id);
      const kind: SettingProfile["locationKinds"][number] = {
        id: k.id,
        name: k.name.trim(),
        archetype: k.archetype as StructureArchetype,
        defaults: isRecord(k.defaults) ? (k.defaults as SettingProfile["locationKinds"][number]["defaults"]) : {},
        typeMapping: mapping,
      };
      if (typeof k.categoryId === "string" && categoryIds.has(k.categoryId)) kind.categoryId = k.categoryId;
      else if (typeof k.categoryId === "string") warnings.push(`Вид локации «${kind.name}» ссылается на несуществующую категорию`);
      if (typeof k.namingRuleId === "string" && ruleIds.has(k.namingRuleId)) kind.namingRuleId = k.namingRuleId;
      else if (typeof k.namingRuleId === "string") warnings.push(`Вид локации «${kind.name}» ссылается на несуществующее правило имён`);
      if (typeof k.nestedKindId === "string" && locationKindIds.has(k.nestedKindId)) kind.nestedKindId = k.nestedKindId;
      else if (typeof k.nestedKindId === "string") warnings.push(`Вид локации «${kind.name}» ссылается на несуществующий вложенный вид`);
      checkMappingRefs(kind.name, mapping);
      locationKinds.push(kind);
    }
  }

  const terrainKinds: SettingProfile["terrainKinds"] = [];
  const terrainKindIds = new Set<string>();
  if (Array.isArray(raw.terrainKinds)) {
    for (const k of raw.terrainKinds) {
      if (!isRecord(k) || typeof k.id !== "string" || !k.id) continue;
      if (typeof k.name !== "string" || !k.name.trim()) continue;
      const mapping = validateTypeMapping(k.typeMapping);
      if (!mapping) {
        warnings.push(`Вид местности «${String(k.name)}» без маппинга типов пропущен`);
        continue;
      }
      if (terrainKindIds.has(k.id)) {
        warnings.push(`Вид местности «${String(k.name)}» с дублирующимся id пропущен`);
        continue;
      }
      terrainKindIds.add(k.id);
      const kind: SettingProfile["terrainKinds"][number] = {
        id: k.id,
        name: (k.name as string).trim(),
        defaults: isRecord(k.defaults) ? (k.defaults as SettingProfile["terrainKinds"][number]["defaults"]) : {},
        typeMapping: mapping,
      };
      if (typeof k.categoryId === "string" && categoryIds.has(k.categoryId)) kind.categoryId = k.categoryId;
      else if (typeof k.categoryId === "string") warnings.push(`Вид местности «${kind.name}» ссылается на несуществующую категорию`);
      if (typeof k.namingRuleId === "string" && ruleIds.has(k.namingRuleId)) kind.namingRuleId = k.namingRuleId;
      else if (typeof k.namingRuleId === "string") warnings.push(`Вид местности «${kind.name}» ссылается на несуществующее правило имён`);
      checkMappingRefs(kind.name, mapping);
      terrainKinds.push(kind);
    }
  }

  // Второй проход: ссылки nestedKindId могут указывать вперёд —
  // проверяем их уже по полному множеству видов.
  for (const kind of locationKinds) {
    const rawKind = Array.isArray(raw.locationKinds)
      ? raw.locationKinds.find((k) => isRecord(k) && k.id === kind.id)
      : undefined;
    if (!kind.nestedKindId && isRecord(rawKind) && typeof rawKind.nestedKindId === "string") {
      if (locationKindIds.has(rawKind.nestedKindId)) kind.nestedKindId = rawKind.nestedKindId;
    }
  }

  const profile: SettingProfile = {
    id: raw.id,
    name: raw.name.trim(),
    description: typeof raw.description === "string" ? raw.description : "",
    version: num(raw.version) ? raw.version : 1,
    categories,
    legendTypes,
    namingRules,
    locationKinds,
    terrainKinds,
    createdAt: num(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: num(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
  return { profile, warnings };
}

/**
 * Рендерит имя по правилу: ключи {A} подставляются из списков
 * детерминированным выбором через seeded PRNG. null — правило не
 * применилось (битый шаблон/пустые списки) → нейтральный счётчик.
 */
export function renderName(rule: NamingRule | undefined, rng: Rng): string | null {
  if (!rule) return null;
  const pattern = rule.pattern.trim();
  if (!pattern) return null;
  let out = pattern;
  const keys = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const key of keys) {
    const list = rule.lists[key];
    if (!list || list.length === 0) return null;
    const pick = list[Math.floor(rng() * list.length)];
    out = out.split(`{${key}}`).join(pick);
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Детерминированный RNG для имени объекта: seed + kind + порядковый индекс. */
export function namingRng(seed: string, kind: string, index: number): Rng {
  return createRng(`${seed}::name::${kind}::${index}`);
}

/** Имя для спекового правила; fallback — нейтральный счётчик. */
export function nameFor(
  specNaming: SpecNaming | undefined,
  kind: PrimitiveKind | "location",
  seed: string,
  index: number,
  counterName: () => string,
): string {
  const rule = specNaming?.[kind === "location" ? "location" : kind];
  const rendered = renderName(rule, namingRng(seed, kind, index));
  return rendered ?? counterName();
}

const MAX_NESTED_CHAIN = 8;

/** Цепочка вложенных видов A → nestedKindId(A) → ...; обрывается на циклах. */
export function nestedKindChain(
  profile: SettingProfile,
  startKindId: string,
): SettingProfile["locationKinds"] {
  const chain: SettingProfile["locationKinds"] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = startKindId;
  while (currentId && chain.length < MAX_NESTED_CHAIN) {
    if (seen.has(currentId)) break; // цикл — обрываем
    seen.add(currentId);
    const kind = profile.locationKinds.find((k) => k.id === currentId);
    if (!kind) break;
    chain.push(kind);
    currentId = kind.nestedKindId;
  }
  return chain;
}

/** Правила именования профиля в форму для встройки в спеку. */
export function specNamingFromProfile(
  profile: SettingProfile | undefined,
  ruleIds: { area?: string; line?: string; point?: string; label?: string; location?: string },
): SpecNaming | undefined {
  if (!profile) return undefined;
  const find = (id: string | undefined): NamingRule | undefined =>
    id ? profile.namingRules.find((r) => r.id === id) : undefined;
  const naming: SpecNaming = {
    area: find(ruleIds.area),
    line: find(ruleIds.line),
    point: find(ruleIds.point),
    label: find(ruleIds.label),
    location: find(ruleIds.location),
  };
  return naming.area || naming.line || naming.point || naming.label || naming.location
    ? naming
    : undefined;
}
