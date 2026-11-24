import { getPathToRoot } from "../core/tree";
import { useAppStore } from "../state/store";

export default function Breadcrumbs() {
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const openMap = useAppStore((s) => s.openMap);
  const openParent = useAppStore((s) => s.openParent);

  const path = getPathToRoot(project.maps, activeMapId);
  const parent = project.maps[activeMapId]?.parentId;

  return (
    <div className="breadcrumbs">
      <button onClick={openParent} disabled={!parent}>
        ↑ Наверх
      </button>
      <span className="sep">|</span>
      {path.map((map, i) => (
        <span key={map.id}>
          {i > 0 && <span className="sep"> / </span>}
          <button
            className={`crumb${i === path.length - 1 ? " current" : ""}`}
            onClick={() => openMap(map.id)}
            disabled={i === path.length - 1}
          >
            {map.name}
          </button>
        </span>
      ))}
    </div>
  );
}
