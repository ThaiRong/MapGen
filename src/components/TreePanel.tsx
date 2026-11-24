import { useMemo, useState } from "react";
import { buildTree, getDescendantIds, type TreeNode } from "../core/tree";
import type { MapNode } from "../core/types";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

interface PendingDelete {
  map: MapNode;
  totalDescendants: number;
}

export default function TreePanel() {
  const project = useAppStore((s) => s.project);
  const tree = useMemo(() => buildTree(project), [project]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const confirmDelete = (map: MapNode) => {
    const total = getDescendantIds(project.maps, map.id).size - 1;
    setPendingDelete({ map, totalDescendants: total });
  };

  return (
    <div className="tree-panel">
      <TreeItem node={tree} depth={0} onDelete={confirmDelete} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Удалить карту «${pendingDelete?.map.name ?? ""}»?`}
        message={
          pendingDelete === null
            ? ""
            : pendingDelete.totalDescendants > 0
              ? `У этой карты есть дочерние карты — всего ${pendingDelete.totalDescendants} с вложенными. Они будут удалены вместе с ней, а маркеры-ссылки на них исчезнут с карт. Действие можно отменить через Ctrl+Z.`
              : "Карта будет удалена из проекта. Действие можно отменить через Ctrl+Z."
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          if (pendingDelete) useAppStore.getState().deleteMapById(pendingDelete.map.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function TreeItem({
  node,
  depth,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  onDelete: (map: MapNode) => void;
}) {
  const activeMapId = useAppStore((s) => s.activeMapId);
  const openMap = useAppStore((s) => s.openMap);
  const renameMapById = useAppStore((s) => s.renameMapById);
  const isRoot = depth === 0;
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);

  const { map, children } = node;

  return (
    <div>
      <div
        className={`tree-row${map.id === activeMapId ? " active" : ""}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => openMap(map.id)}
        onDoubleClick={() => setEditing(true)}
      >
        <span
          className="arrow"
          onClick={(e) => {
            e.stopPropagation();
            if (children.length > 0) setCollapsed(!collapsed);
          }}
        >
          {children.length > 0 ? (collapsed ? "▸" : "▾") : ""}
        </span>
        {editing ? (
          <input
            autoFocus
            defaultValue={map.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameMapById(map.id, e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="name" title={map.name}>
            {map.name}
          </span>
        )}
        {!editing && (
          <>
            <button
              className="mini"
              title="Переименовать"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              ✎
            </button>
            {!isRoot && (
              <button
                className="mini"
                title="Удалить карту"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(map);
                }}
              >
                ✕
              </button>
            )}
          </>
        )}
      </div>
      {!collapsed &&
        children.map((child) => (
          <TreeItem key={child.map.id} node={child} depth={depth + 1} onDelete={onDelete} />
        ))}
    </div>
  );
}
