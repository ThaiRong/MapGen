import { useAppStore } from "../state/store";

export default function StatusBar() {
  const status = useAppStore((s) => s.status);
  const cursor = useAppStore((s) => s.cursor);
  const viewZoom = useAppStore((s) => s.viewZoom);
  const mapName = useAppStore((s) => s.project.maps[s.activeMapId]?.name ?? "—");

  return (
    <div className="status-bar">
      <span className="status">{status}</span>
      <span>Карта: {mapName}</span>
      {cursor && (
        <span>
          x: {cursor.x.toFixed(0)}, y: {cursor.y.toFixed(0)}
        </span>
      )}
      <span>Масштаб: {Math.round(viewZoom * 100)}%</span>
    </div>
  );
}
