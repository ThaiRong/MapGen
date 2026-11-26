export type MapId = string;
export type EntityId = string;

export const PROJECT_FORMAT = "mapgen-project";
export const PROJECT_VERSION = 1;

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
  /** Последнее применение генерации на этой карте (итерация 3). */
  generation?: MapGeneration;
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
}

export interface MapGeneration {
  spec: GenerationSpec;
  generationId: string;
  appliedAt: number;
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
