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
  createdAt: string;
  updatedAt: string;
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
