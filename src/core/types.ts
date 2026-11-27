export type MapId = string;
export type EntityId = string;

export const PROJECT_FORMAT = "mapgen-project";
export const PROJECT_VERSION = 2;

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  title: string;
  rootMapId: MapId;
  maps: Record<MapId, MapNode>;
  markerArchive: ArchivedMarker[];
  /** Типы легенды на уровне проекта (итерация 2). */
  legend: LegendType[];
  /** Активный профиль сеттинга (итерация 5). */
  activeProfileId?: string;
  /** Встроенная копия применённого профиля — самодостаточность проекта. */
  profileSnapshot?: SettingProfile;
  createdAt: string;
  updatedAt: string;
}

/**
 * Маркер, удалённый с карты. Хранит сущность в состоянии на момент
 * удаления: восстановление вернёт прежние координаты и targetMapId.
 * Записи архива переживают сохранение/загрузку проекта.
 */
export interface ArchivedMarker {
  entity: LocationLinkEntity;
  /** Карта, с которой маркер был удалён. */
  sourceMapId: MapId;
  archivedAt: string;
}

export interface MapScale {
  enabled: boolean;
  unitsPerWorldUnit?: number;
  unitLabel?: string;
}

export interface MapView {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface MapNode {
  id: MapId;
  name: string;
  parentId: MapId | null;
  scale?: MapScale;
  entities: Entity[];
  /** Нарисованные вручную примитивы (итерация 2). */
  primitives: Primitive[];
  /** Последнее применение генерации на этой карте (итерация 3/4). */
  generation?: MapGeneration;
  /** Карта создана как вложенная при генерации структуры (итерация 4). */
  createdByGeneration?: boolean;
  view?: MapView;
  createdAt: string;
  updatedAt: string;
}

export type Entity = LocationLinkEntity;

export interface LocationLinkEntity {
  id: EntityId;
  kind: "location-link";
  x: number;
  y: number;
  label: string;
  targetMapId: MapId;
  /** Происхождение: создан вручную или генерацией структуры (итерация 4). */
  origin?: PrimitiveOrigin;
  generationId?: string;
  /** Вид локации из профиля, необязательно (итерация 5). */
  kindId?: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------- Генерация (итерация 3) ---------- */

/** Сеттинг-агностичная спецификация генерации. */
export interface GenerationSpec {
  seed: string;
  /** 0..1 — амплитуда и резкость рельефа */
  relief: number;
  /** 0..1 */
  moisture: number;
  /** -1..1 */
  temperature: number;
  /** 0..1 — порог жидкости (изолиния) */
  fluidLevel: number;
  /** 0..1 */
  areaDensity: number;
  /** 0..1 */
  lineDensity: number;
  /** 0..1 */
  pointDensity: number;
  /** 0..1 — число октав и сила упрощения */
  detail: number;
  /** частота структур поля */
  fieldScale: number;
  bounds: { x: number; y: number; width: number; height: number };
  typeMapping: { area: string; line: string; point: string; label: string };
  labels: { enabled: boolean };
  /** Правила именования, встроенные в спеку для воспроизводимости (итерация 5). */
  naming?: SpecNaming;
  /** Имя вида местности из профиля — только для описаний, не влияет на расчёт. */
  kindName?: string;
}

export type MapGeneration =
  | { kind: "terrain"; spec: GenerationSpec; generationId: string; appliedAt: number }
  | { kind: "structure"; spec: StructureSpec; generationId: string; appliedAt: number };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StructureArchetype = "cellular" | "linear" | "radial" | "cluster" | "open" | "mixed";

/** Сеттинг-агностичная спецификация генерации структуры локации. */
export interface StructureSpec {
  seed: string;
  archetype: StructureArchetype;
  /** 0..1 — заполнение области */
  density: number;
  /** 0..1 — характерный размер элемента */
  cellScale: number;
  /** 0..1 — отклонение от регулярности */
  irregularity: number;
  /** 0..1 — количество связей */
  connectivity: number;
  /** 0..1 — разброс размеров */
  sizeVariance: number;
  /** 0..1 — количество узловых точек */
  pointDensity: number;
  /** 0..8 — вложенные локации */
  nestedCount: number;
  /** 0..1 — отступ от границ */
  margin: number;
  /** 0..1 — детализация и упрощение */
  detail: number;
  bounds: Rect;
  typeMapping: { area: string; line: string; point: string; label: string };
  labels: { enabled: boolean };
  /** Правила именования, встроенные в спеку для воспроизводимости (итерация 5). */
  naming?: SpecNaming;
  /** Вид вложенных локаций из профиля (итерация 5). */
  nestedKindId?: string;
  /** Имя вида локации из профиля — только для описаний, не влияет на расчёт. */
  kindName?: string;
}

/** Правила именования, вшитые в спеку генерации. */
export interface SpecNaming {
  area?: NamingRule;
  line?: NamingRule;
  point?: NamingRule;
  label?: NamingRule;
  location?: NamingRule;
}

/* ---------- Профили сеттинга (итерация 5) ---------- */

export interface ProfileCategory {
  id: string;
  name: string;
  order: number;
}

export interface NamingRule {
  id: string;
  name: string;
  appliesTo: "area" | "line" | "point" | "label" | "location";
  /** Шаблон вида "{A} {B}" — ключи подставляются из списков. */
  pattern: string;
  /** Списки слов: ключ шаблона → варианты. Всё приходит из данных пользователя. */
  lists: Record<string, string[]>;
}

export interface LocationKind {
  id: string;
  name: string;
  categoryId?: string;
  archetype: StructureArchetype;
  defaults: Partial<StructureSpec>;
  typeMapping: { area: string; line: string; point: string; label: string };
  namingRuleId?: string;
  nestedKindId?: string;
}

export interface TerrainKind {
  id: string;
  name: string;
  categoryId?: string;
  defaults: Partial<GenerationSpec>;
  typeMapping: { area: string; line: string; point: string; label: string };
  namingRuleId?: string;
}

/** Профиль сеттинга — чистые данные, без семантики в коде ядра. */
export interface SettingProfile {
  id: string;
  name: string;
  description: string;
  version: number;
  categories: ProfileCategory[];
  legendTypes: LegendType[];
  namingRules: NamingRule[];
  locationKinds: LocationKind[];
  terrainKinds: TerrainKind[];
  createdAt: number;
  updatedAt: number;
}

export interface StructureNested {
  x: number;
  y: number;
  label: string;
}

export interface StructureStats {
  areas: number;
  lines: number;
  points: number;
  labels: number;
  nested: number;
  vertices: number;
}

export interface StructureResult {
  primitives: Primitive[];
  nested: StructureNested[];
  stats: StructureStats;
  warnings: string[];
}

/* ---------- Примитивы (итерация 2) ---------- */

export type PrimitiveOrigin = "manual" | "generated";
export type PrimitiveKind = "point" | "line" | "area" | "label";
export type LegendShape = PrimitiveKind;

export interface Vec2 {
  x: number;
  y: number;
}

interface PrimitiveBase {
  id: EntityId;
  kind: PrimitiveKind;
  name: string;
  /** Ссылка на тип легенды. */
  typeId: string;
  /** Происхождение: нарисован вручную или создан генерацией. */
  origin: PrimitiveOrigin;
  /** Для origin='generated' — id применения генерации (защита правок). */
  generationId?: string;
  /** Произвольная заметка мастера. */
  note: string;
  visible: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PointPrimitive extends PrimitiveBase {
  kind: "point";
  x: number;
  y: number;
}

export interface LinePrimitive extends PrimitiveBase {
  kind: "line";
  /** Минимум 2 точки; линия не обязана быть замкнутой. */
  points: Vec2[];
}

export interface AreaPrimitive extends PrimitiveBase {
  kind: "area";
  /** Минимум 3 вершины; область — замкнутый полигон. */
  points: Vec2[];
}

export interface LabelPrimitive extends PrimitiveBase {
  kind: "label";
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type Primitive = PointPrimitive | LinePrimitive | AreaPrimitive | LabelPrimitive;

/* ---------- Легенда (итерация 2) ---------- */

export type StrokeStyleKind = "solid" | "dashed";

/** Тип легенды: нейтральный стиль, который пользователь присваивает примитивам. */
export interface LegendType {
  id: string;
  name: string;
  category: string;
  shape: LegendShape;
  color: string;
  /** 0..1 */
  opacity: number;
  strokeWidth: number;
  strokeStyle: StrokeStyleKind;
  visible: boolean;
  /** Базовые типы защищены: нельзя менять форму, можно удалить только
   *  при ненулевом остаточном покрытии формы (см. core/project.ts). */
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}
