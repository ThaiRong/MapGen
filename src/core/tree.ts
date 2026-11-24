import type { MapId, MapNode, Project } from "./types";

export interface TreeNode {
  map: MapNode;
  children: TreeNode[];
}

export function buildTree(project: Project): TreeNode {
  const childrenOf = new Map<MapId | null, MapNode[]>();
  for (const map of Object.values(project.maps)) {
    const list = childrenOf.get(map.parentId) ?? [];
    list.push(map);
    childrenOf.set(map.parentId, list);
  }
  const byName = (a: MapNode, b: MapNode) => a.name.localeCompare(b.name, "ru");
  const build = (map: MapNode): TreeNode => ({
    map,
    children: (childrenOf.get(map.id) ?? []).sort(byName).map(build),
  });
  const root = project.maps[project.rootMapId];
  return build(root);
}

export function getPathToRoot(maps: Record<MapId, MapNode>, mapId: MapId): MapNode[] {
  const path: MapNode[] = [];
  let current: MapNode | undefined = maps[mapId];
  let guard = 0;
  while (current && guard < 10_000) {
    path.unshift(current);
    current = current.parentId ? maps[current.parentId] : undefined;
    guard += 1;
  }
  return path;
}

export function getDescendantIds(maps: Record<MapId, MapNode>, mapId: MapId): Set<MapId> {
  const result = new Set<MapId>([mapId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const map of Object.values(maps)) {
      if (map.parentId && result.has(map.parentId) && !result.has(map.id)) {
        result.add(map.id);
        changed = true;
      }
    }
  }
  return result;
}
