import {
  addLegendType,
  addLocation,
  addPrimitive,
  clearMarkerArchive,
  countLegendTypeUsage,
  createAreaPrimitive,
  createDefaultLegend,
  createLabelPrimitive,
  createLinePrimitive,
  createPointPrimitive,
  createProject,
  deleteArchivedMarker,
  deleteLegendType,
  deleteMap,
  deleteMarker,
  deletePrimitive,
  moveMarker,
  movePrimitive,
  movePrimitives,
  primitiveCenter,
  renameMap,
  renameMarker,
  restoreMarker,
  restoreMarkerEntity,
  restoreMarkerFromRecord,
  restorePrimitiveToMap,
  rotatePrimitive,
  insertPrimitiveCopy,
  deletePrimitives,
  movePrimitiveVertex,
  insertPrimitiveVertex,
  setMapScale,
  setMapView,
  updateLegendType,
  updatePrimitive,
  validateProject,
  ValidationError,
  ROOT_MAP_NAME,
  NEW_LOCATION_NAME,
} from "../src/core/project";
import { buildTree, getPathToRoot, getDescendantIds } from "../src/core/tree";
import {
  canRedo,
  canUndo,
  createHistory,
  jumpTo,
  makeEntry,
  record,
  redo,
  toHistoryFile,
  undo,
  validateHistoryFile,
} from "../src/core/history";
import {
  deserializeProject,
  deserializeSave,
  serializeProject,
  serializeSave,
} from "../src/storage/json";

let passed = 0;
function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok: ${label}`);
}

// 1. Создание проекта
let project = createProject("Тест");
assert(project.format === "mapgen-project", "формат проекта");
assert(project.version === 1, "версия формата");
const root = project.maps[project.rootMapId];
assert(root.name === ROOT_MAP_NAME, "корневая карта называется «Глобальная карта»");
assert(root.parentId === null, "у корня нет родителя");

// 2. Создание локации: маркер + дочерняя карта одной транзакцией
const loc1 = addLocation(project, project.rootMapId, 100, -50);
project = loc1.project;
const child1 = project.maps[loc1.mapId];
assert(child1.name === NEW_LOCATION_NAME, "дочерняя карта «Новая локация»");
assert(child1.parentId === project.rootMapId, "parentId указывает на родителя");
assert(root.entities.length + 1 === project.maps[project.rootMapId].entities.length, "маркер добавлен на родительскую карту");
const marker1 = project.maps[project.rootMapId].entities.find((e) => e.id === loc1.entityId)!;
assert(marker1.kind === "location-link" && marker1.targetMapId === loc1.mapId, "маркер хранит targetMapId");

// 3. Вложенность: локация внутри локации
const loc2 = addLocation(project, loc1.mapId, 10, 20);
project = loc2.project;
assert(project.maps[loc2.mapId].parentId === loc1.mapId, "вложенная локация второго уровня");

// 4. Дерево и путь
const tree = buildTree(project);
assert(tree.map.id === project.rootMapId, "корень дерева");
assert(tree.children.length === 1 && tree.children[0].children.length === 1, "вложенность дерева 1 → 1");
const path = getPathToRoot(project.maps, loc2.mapId);
assert(path.length === 3, "путь из 3 карт для глубины 2");
assert(getDescendantIds(project.maps, project.rootMapId).size === 3, "потомки корня: 3 карты");

// 5. Переименование и перемещение
project = renameMap(project, loc1.mapId, "Город");
project = renameMarker(project, project.rootMapId, loc1.entityId, "Город у реки");
project = moveMarker(project, project.rootMapId, loc1.entityId, 42, 43);
const moved = project.maps[project.rootMapId].entities.find((e) => e.id === loc1.entityId)!;
assert(project.maps[loc1.mapId].name === "Город", "переименование карты");
assert(moved.label === "Город у реки" && moved.x === 42 && moved.y === 43, "переименование и перемещение маркера");

// 6. Удаление маркера не удаляет карту
project = deleteMarker(project, project.rootMapId, loc1.entityId);
assert(!project.maps[project.rootMapId].entities.some((e) => e.id === loc1.entityId), "маркер удалён");
assert(!!project.maps[loc1.mapId], "карта осталась в дереве");

// 7. Удаление карты каскадом + чистка битых ссылок
const loc3 = addLocation(project, loc1.mapId, 1, 2);
project = loc3.project;
project = deleteMap(project, loc1.mapId);
assert(!project.maps[loc1.mapId] && !project.maps[loc2.mapId] && !project.maps[loc3.mapId], "каскадное удаление");
for (const m of Object.values(project.maps)) {
  assert(m.entities.every((e) => !!project.maps[e.targetMapId]), "нет ссылок на удалённые карты");
}

// 8. Корень защищён
try {
  deleteMap(project, project.rootMapId);
  assert(false, "удаление корня должно бросить ошибку");
} catch {
  assert(true, "удаление корня запрещено");
}

// 9. Масштаб и вид
project = setMapScale(project, project.rootMapId, { enabled: true, unitsPerWorldUnit: 10, unitLabel: "км" });
assert(project.maps[project.rootMapId].scale?.unitLabel === "км", "масштаб сохранён");
project = setMapView(project, project.rootMapId, { centerX: 5, centerY: 6, zoom: 2 });
assert(project.maps[project.rootMapId].view?.zoom === 2, "вид сохранён");

// 10. Сериализация / валидация круга
const text = serializeProject(project);
const restored = deserializeProject(text);
assert(restored.id === project.id, "загрузка из .mapkg JSON");

// 11. Повреждённые файлы — понятные ошибки
try {
  deserializeProject("not json {{{");
  assert(false, "невалидный JSON должен бросить ValidationError");
} catch (e) {
  assert(e instanceof ValidationError, "невалидный JSON → ValidationError");
}
try {
  deserializeProject(JSON.stringify({ format: "other" }));
  assert(false, "чужой формат должен бросить ValidationError");
} catch (e) {
  assert(e instanceof ValidationError, "чужой формат → ValidationError");
}
try {
  deserializeProject(JSON.stringify({ ...JSON.parse(text), rootMapId: "missing" }));
  assert(false, "отсутствие корня должно бросить ValidationError");
} catch (e) {
  assert(e instanceof ValidationError, "отсутствие корня → ValidationError");
}
// Битая ссылка маркера
const broken = JSON.parse(text);
broken.maps[broken.rootMapId].entities.push({
  id: "x",
  kind: "location-link",
  x: 0,
  y: 0,
  label: "битая",
  targetMapId: "missing",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
try {
  validateProject(broken);
  assert(false, "битая ссылка должна бросить ValidationError");
} catch (e) {
  assert(e instanceof ValidationError, "битая ссылка маркера → ValidationError");
}

// 12. Журнал изменений: записи, переходы, undo/redo, лимит
const projectX = createProject("Журнал");
let hist = createHistory(projectX);
assert(hist.position === -1 && hist.entries.length === 0, "пустой журнал: позиция -1, записей нет");
const emptyUndo = undo(hist);
const emptyRedo = redo(hist);
assert(emptyUndo === null && emptyRedo === null, "undo/redo на пустом журнале — null, не падение");

const renamedX = renameMap(projectX, projectX.rootMapId, "Мир Журнала");
hist = record(
  hist,
  makeEntry(
    {
      operationType: "map.renamed",
      description: "Карта «Глобальная карта» переименована в «Мир Журнала»",
      mapId: projectX.rootMapId,
    },
    renamedX,
  ),
);
assert(hist.entries.length === 1 && hist.position === 0, "запись добавлена, позиция обновлена");
assert(hist.entries[0].description.includes("Мир Журнала"), "человекочитаемое описание записи");
assert(hist.entries[0].snapshot === renamedX, "снимок хранит состояние после действия");

const stepBack = undo(hist);
assert(stepBack !== null && stepBack.history.position === -1 && stepBack.project === projectX, "undo возвращает к базовому состоянию");
const stepFwd = redo(stepBack!.history);
assert(stepFwd !== null && stepFwd.history.position === 0 && stepFwd.project === renamedX, "redo возвращает вперёд");
assert(canUndo(hist) && !canRedo(hist), "доступность undo/redo по позиции");

// Лимит журнала: старые записи вытесняются, база сдвигается
let hCap = createHistory(projectX);
let twentieth: unknown = null;
for (let i = 0; i < 120; i += 1) {
  const snap = renameMap(projectX, projectX.rootMapId, `Итерация ${i}`);
  const entry = makeEntry({ operationType: "map.renamed", description: `Шаг ${i}` }, snap);
  if (i === 19) twentieth = snap;
  hCap = record(hCap, entry);
}
assert(hCap.entries.length === 100, "журнал ограничен 100 записями");
assert(hCap.position === 99, "позиция на последней записи");
assert(hCap.base === twentieth, "база сдвинулась на состояние последней вытесненной записи");

// Ветвление: запись после возврата назад перезаписывает будущую ветвь
const secondX = renameMap(renamedX, renamedX.rootMapId, "Шаг 2");
hist = record(hist, makeEntry({ operationType: "map.renamed", description: "Шаг 2" }, secondX));
const backToFirst = jumpTo(hist, 0);
assert(backToFirst.history.position === 0 && canRedo(backToFirst.history), "возврат назад: ветвь впереди доступна");
const thirdX = renameMap(backToFirst.project, projectX.rootMapId, "Шаг 3");
const afterRewrite = record(
  backToFirst.history,
  makeEntry({ operationType: "map.renamed", description: "Шаг 3" }, thirdX),
);
assert(afterRewrite.entries.length === 2 && afterRewrite.position === 1, "новая запись перезаписала отменённую ветвь");
assert(afterRewrite.entries[1].description === "Шаг 3", "перезаписанная ветвь заменена новой записью");
assert(!canRedo(afterRewrite), "после перезаписи redo недоступно");

// 12.1 Коалесцирование: непрерывная правка одного объекта — одна запись
let hcoal = createHistory(projectX);
hcoal = record(
  hcoal,
  makeEntry({ operationType: "legend.updated", description: "Тип «Линия» изменён", coalesceKey: "legend:t1" }, renamedX),
);
const coalSnap2 = renameMap(renamedX, renamedX.rootMapId, "Коалесцение 2");
hcoal = record(
  hcoal,
  makeEntry({ operationType: "legend.updated", description: "Тип «Линия» изменён", coalesceKey: "legend:t1" }, coalSnap2),
);
const coalSnap3 = renameMap(coalSnap2, coalSnap2.rootMapId, "Коалесцение 3");
hcoal = record(
  hcoal,
  makeEntry({ operationType: "legend.updated", description: "Тип «Линия» изменён", coalesceKey: "legend:t1" }, coalSnap3),
);
assert(hcoal.entries.length === 1, "три правки подряд — одна запись в журнале");
assert(hcoal.entries[0].snapshot === coalSnap3, "запись хранит конечное состояние правки");
hcoal = record(
  hcoal,
  makeEntry({ operationType: "legend.updated", description: "Другой тип", coalesceKey: "legend:t2" }, coalSnap3),
);
assert(hcoal.entries.length === 2, "правка другого объекта — новая запись");
// Коалесцирование не работает на отменённой ветви (запись не в конце)
const backCoal = jumpTo(hcoal, 0);
const coalSnap4 = renameMap(coalSnap3, coalSnap3.rootMapId, "Ветка");
const hcoal2 = record(
  backCoal.history,
  makeEntry({ operationType: "legend.updated", description: "После возврата", coalesceKey: "legend:t2" }, coalSnap4),
);
assert(hcoal2.entries.length === 2, "после возврата назад запись не сливается с отменённой ветвью");

// 13. Архив удалённых маркеров: удаление сохраняет маркер
let p = createProject("Архив");
const locA = addLocation(p, p.rootMapId, 111, 222);
p = locA.project;
const beforeDelete = p;
p = deleteMarker(p, p.rootMapId, locA.entityId);
assert(p.markerArchive.length === 1, "удалённый маркер попал в архив");
assert(!p.maps[p.rootMapId].entities.some((e) => e.id === locA.entityId), "маркер убран с карты");
assert(!!p.maps[locA.mapId], "связанная карта не удалена");
assert(
  p.markerArchive[0].entity.x === 111 && p.markerArchive[0].entity.y === 222,
  "архив хранит прежние координаты",
);

// 14. Восстановление: прежние координаты и связь с картой
const restoreResult = restoreMarker(p, locA.entityId);
p = restoreResult.project;
assert(p.markerArchive.length === 0, "архив очищается после восстановления");
const restoredEntity = p.maps[p.rootMapId].entities.find((e) => e.id === locA.entityId)!;
assert(restoredEntity.x === 111 && restoredEntity.y === 222, "маркер вернулся на прежние координаты");
assert(restoredEntity.targetMapId === locA.mapId, "маркер снова ссылается на прежнюю карту");

// 15. Восстановление невозможно, если целевая карта удалена — понятное сообщение
let p2 = createProject("Архив 2");
const locB = addLocation(p2, p2.rootMapId, 0, 0);
p2 = locB.project;
p2 = deleteMarker(p2, p2.rootMapId, locB.entityId);
p2 = deleteMap(p2, locB.mapId);
assert(p2.markerArchive.length === 1, "архив сохранился после удаления целевой карты");
try {
  restoreMarker(p2, locB.entityId);
  assert(false, "восстановление с удалённой целевой картой должно бросить ошибку");
} catch (e) {
  assert(
    e instanceof Error && e.message.includes("связанная карта удалена"),
    "понятное сообщение об удалённой целевой карте",
  );
}

// 16. Восстановление невозможно, если удалена карта-источник
let p3 = createProject("Архив 3");
const locC = addLocation(p3, p3.rootMapId, 0, 0);
p3 = locC.project;
p3 = deleteMarker(p3, p3.rootMapId, locC.entityId);
try {
  deleteMap(p3, p3.rootMapId);
  assert(false, "удаление корня должно бросить ошибку");
} catch {
  assert(true, "корень защищён от удаления");
}
// Прямой сценарий «источник удалён»: корень защищён, поэтому проверяем
// сообщение на состоянии с отсутствующей картой-источником.
const brokenSource: typeof p3 = { ...p3, maps: {} };
try {
  restoreMarker(brokenSource, locC.entityId);
  assert(false, "восстановление с удалённым источником должно бросить ошибку");
} catch (e) {
  assert(
    e instanceof Error && e.message.includes("на которой стоял маркер, удалена"),
    "понятное сообщение об удалённой карте-источнике",
  );
}

// 17. Удаление и восстановление двигают позицию журнала
let hd = createHistory(beforeDelete);
const delSnap = deleteMarker(beforeDelete, beforeDelete.rootMapId, locA.entityId);
hd = record(
  hd,
  makeEntry(
    { operationType: "marker.deleted", description: "Маркер «Новая локация» удалён", mapId: beforeDelete.rootMapId, entityId: locA.entityId },
    delSnap,
  ),
);
const undoDel = undo(hd);
assert(
  undoDel !== null &&
    undoDel.project.markerArchive.length === 0 &&
    undoDel.project.maps[undoDel.project.rootMapId].entities.length === 1,
  "undo удаления возвращает маркер и очищает архив",
);
const redoDel = redo(undoDel!.history);
assert(
  redoDel !== null &&
    redoDel.project.markerArchive.length === 1 &&
    redoDel.project.maps[redoDel.project.rootMapId].entities.length === 0,
  "redo удаления возвращает маркер в архив",
);

// 19. restoreInfo в записи marker.deleted и восстановление из истории
let pm = createProject("История маркеров");
const locM = addLocation(pm, pm.rootMapId, 7, 8);
pm = locM.project;
const markerM = pm.maps[pm.rootMapId].entities[0];
const afterDelM = deleteMarker(pm, pm.rootMapId, locM.entityId);
const delEntry = makeEntry(
  {
    operationType: "marker.deleted",
    description: `Маркер «${markerM.label}» удалён`,
    mapId: pm.rootMapId,
    entityId: locM.entityId,
    restoreInfo: { sourceMapId: pm.rootMapId, entity: { ...markerM } },
  },
  afterDelM,
);
assert(delEntry.restoreInfo?.entity.x === 7 && delEntry.restoreInfo.entity.y === 8, "restoreInfo хранит прежние координаты");
const fromHistory = restoreMarkerEntity(
  afterDelM,
  delEntry.restoreInfo!.sourceMapId,
  delEntry.restoreInfo!.entity,
);
const reEntity = fromHistory.project.maps[fromHistory.project.rootMapId].entities.find(
  (e) => e.id === locM.entityId,
)!;
assert(
  reEntity.x === 7 && reEntity.y === 8 && reEntity.targetMapId === locM.mapId,
  "восстановление из истории: прежние координаты и связь с картой",
);
try {
  restoreMarkerEntity(fromHistory.project, pm.rootMapId, markerM);
  assert(false, "повторное восстановление должно бросить ошибку");
} catch {
  assert(true, "дубликаты маркеров при восстановлении блокируются");
}

// 19.1 Восстановление через журнал сбрасывает запись в архиве
let pj = createProject("История vs архив");
const locJ = addLocation(pj, pj.rootMapId, 30, 40);
pj = locJ.project;
const markerJ = pj.maps[pj.rootMapId].entities[0];
const afterDelJ = deleteMarker(pj, pj.rootMapId, locJ.entityId);
assert(afterDelJ.markerArchive.length === 1, "маркер удалён и в архиве");
const viaHistory = restoreMarkerFromRecord(
  afterDelJ,
  pj.rootMapId,
  { ...markerJ },
);
assert(
  viaHistory.project.markerArchive.length === 0,
  "восстановление через журнал убирает маркер из архива",
);
const jEntity = viaHistory.project.maps[pj.rootMapId].entities.find((e) => e.id === locJ.entityId)!;
assert(
  jEntity.x === 30 && jEntity.y === 40 && jEntity.targetMapId === locJ.mapId,
  "восстановление через журнал: прежние координаты и связь с картой",
);
// Повторное восстановление из архива теперь невозможно: записи нет,
// а дубликат на карте заблокирован.
try {
  restoreMarker(viaHistory.project, locJ.entityId);
  assert(false, "восстановление из архива после восстановления через журнал должно бросить ошибку");
} catch {
  assert(true, "двойного восстановления (журнал + архив) не возникает");
}
// Маркер, которого нет в архиве, восстанавливается без побочных эффектов
const noArchive = restoreMarkerFromRecord(afterDelJ, pj.rootMapId, { ...markerJ });
assert(
  noArchive.project.maps[pj.rootMapId].entities.length === 1,
  "восстановление по записи работает и без архивной копии",
);

// 20. Журнал переживает сериализацию; повреждения не ломают загрузку
const histFile = toHistoryFile(afterRewrite);
const parsedHist = validateHistoryFile(JSON.parse(JSON.stringify(histFile)), projectX);
assert(
  parsedHist !== null &&
    parsedHist.entries.length === afterRewrite.entries.length &&
    parsedHist.position === afterRewrite.position,
  "журнал переживает сериализацию",
);
const corrupt = JSON.parse(JSON.stringify(histFile));
corrupt.entries[0] = { broken: true };
const parsedCorrupt = validateHistoryFile(corrupt, projectX);
assert(
  parsedCorrupt !== null && parsedCorrupt.entries.length === afterRewrite.entries.length - 1,
  "повреждённая запись отбрасывается без падения",
);
const farPos = JSON.parse(JSON.stringify(histFile));
farPos.position = 999;
const parsedFar = validateHistoryFile(farPos, projectX);
assert(parsedFar !== null && parsedFar.position === parsedFar.entries.length - 1, "позиция прижата к диапазону");
assert(validateHistoryFile("garbage", projectX) === null, "мусорная история → null");
assert(validateHistoryFile(undefined, projectX) === null, "отсутствующая история → null");

// 21. Файл .mapkg: история сохраняется вместе с проектом
const saveText = serializeSave(projectX, afterRewrite);
const loaded = deserializeSave(saveText);
assert(loaded.history !== null && loaded.history.entries.length === afterRewrite.entries.length, "история загружена из файла");
assert(!("history" in loaded.project), "у проекта нет поля history после загрузки");
const legacyNoHistory = JSON.parse(serializeProject(projectX)) as Record<string, unknown>;
const loadedLegacy = deserializeSave(JSON.stringify(legacyNoHistory));
assert(loadedLegacy.history === null, "старый файл без истории загружается (history = null)");

// 22. Легенда: 4 нейтральных базовых типа по умолчанию
let pl = createProject("Примитивы");
assert(pl.legend.length === 4, "по умолчанию ровно 4 типа легенды");
assert(
  ["point", "line", "area", "label"].every((s) => pl.legend.some((t) => t.shape === s)),
  "базовые типы покрывают все 4 формы",
);
assert(pl.legend.every((t) => t.isBuiltin && t.category === "Базовые"), "базовые типы помечены isBuiltin");
assert(createDefaultLegend().length === 4, "createDefaultLegend отдаёт 4 типа");

// 23. Примитивы: создание, именование, геометрия
const rootMap = pl.maps[pl.rootMapId];
const pointType = pl.legend.find((t) => t.shape === "point")!;
const lineType = pl.legend.find((t) => t.shape === "line")!;
const areaType = pl.legend.find((t) => t.shape === "area")!;
const labelType = pl.legend.find((t) => t.shape === "label")!;
const p1 = createPointPrimitive(rootMap, pointType.id, 10, 20);
assert(p1.name === "Точка 1" && p1.kind === "point", "точка создаётся с базовым именем");
pl = addPrimitive(pl, pl.rootMapId, p1);
const l1 = createLinePrimitive(pl.maps[pl.rootMapId], lineType.id, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
pl = addPrimitive(pl, pl.rootMapId, l1);
const a1 = createAreaPrimitive(pl.maps[pl.rootMapId], areaType.id, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
pl = addPrimitive(pl, pl.rootMapId, a1);
const lbl1 = createLabelPrimitive(pl.maps[pl.rootMapId], labelType.id, 3, 4, "Вход");
pl = addPrimitive(pl, pl.rootMapId, lbl1);
assert(pl.maps[pl.rootMapId].primitives.length === 4, "четыре примитива на карте");
assert(l1.name === "Линия 1" && a1.name === "Область 1" && lbl1.name === "Подпись 1", "нумерация имён по виду");
try {
  createLinePrimitive(rootMap, lineType.id, [{ x: 0, y: 0 }]);
  assert(false, "линия из 1 точки должна бросить ошибку");
} catch {
  assert(true, "линия: минимум 2 точки");
}
try {
  createAreaPrimitive(rootMap, areaType.id, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert(false, "область из 2 вершин должна бросить ошибку");
} catch {
  assert(true, "область: минимум 3 вершины");
}

// 24. Перемещение: точка — x/y, линия — все точки
pl = movePrimitive(pl, pl.rootMapId, p1.id, 5, -5);
const p1m = pl.maps[pl.rootMapId].primitives.find((p) => p.id === p1.id)!;
assert(p1m.kind === "point" && p1m.x === 15 && p1m.y === 15, "точка смещена по x/y");
pl = movePrimitive(pl, pl.rootMapId, l1.id, 100, 100);
const l1m = pl.maps[pl.rootMapId].primitives.find((p) => p.id === l1.id)!;
assert(
  l1m.kind === "line" && l1m.points[0].x === 100 && l1m.points[1].y === 105,
  "линия: смещены все точки",
);

// 25. Обновление: смена типа только совместимой формы, no-op не меняет проект
pl = updatePrimitive(pl, pl.rootMapId, p1.id, { note: "Ключевая точка", locked: true });
const p1u = pl.maps[pl.rootMapId].primitives.find((p) => p.id === p1.id)!;
assert(p1u.note === "Ключевая точка" && p1u.locked === true, "заметка и блокировка сохранены");
const beforeNoop = pl;
pl = updatePrimitive(pl, pl.rootMapId, p1.id, { note: "Ключевая точка" });
assert(pl === beforeNoop, "no-op патч не меняет проект (нет шумных записей)");
try {
  updatePrimitive(pl, pl.rootMapId, p1.id, { typeId: lineType.id });
  assert(false, "точке нельзя назначить тип линии");
} catch (e) {
  assert(e instanceof Error && e.message.includes("не подходит"), "несовместимая форма типа отклонена");
}

// 26. Удаление и восстановление примитива (атомарно, без дубликатов)
const snapshotOfA1 = pl.maps[pl.rootMapId].primitives.find((p) => p.id === a1.id)!;
pl = deletePrimitive(pl, pl.rootMapId, a1.id);
assert(!pl.maps[pl.rootMapId].primitives.some((p) => p.id === a1.id), "область удалена");
pl = restorePrimitiveToMap(pl, pl.rootMapId, snapshotOfA1);
assert(pl.maps[pl.rootMapId].primitives.some((p) => p.id === a1.id), "область восстановлена");
try {
  restorePrimitiveToMap(pl, pl.rootMapId, snapshotOfA1);
  assert(false, "повторное восстановление должно бросить ошибку");
} catch {
  assert(true, "дубликат примитива при восстановлении блокируется");
}
try {
  restorePrimitiveToMap(pl, "no-such-map", snapshotOfA1);
  assert(false, "восстановление на удалённую карту должно бросить ошибку");
} catch {
  assert(true, "понятная ошибка при удалённой карте-источнике");
}

// 27. Легенда: пользовательские типы, редактирование, правила удаления
const added = addLegendType(pl, { name: "Стена", shape: "line" });
pl = added.project;
const wall = pl.legend.find((t) => t.id === added.typeId)!;
assert(!wall.isBuiltin && wall.shape === "line", "пользовательский тип «Стена» (line)");
pl = updateLegendType(pl, wall.id, { color: "#ff0000", strokeWidth: 4, strokeStyle: "dashed", category: "Стены" });
const wallU = pl.legend.find((t) => t.id === wall.id)!;
assert(wallU.strokeStyle === "dashed" && wallU.category === "Стены", "тип легенды отредактирован");
const builtinPoint = pl.legend.find((t) => t.isBuiltin && t.shape === "point")!;
try {
  updateLegendType(pl, builtinPoint.id, { shape: "line" });
  assert(false, "форму базового типа менять нельзя");
} catch {
  assert(true, "форма базового типа защищена");
}
// Тип используется → удаление запрещено
pl = updatePrimitive(pl, pl.rootMapId, l1.id, { typeId: wall.id });
assert(countLegendTypeUsage(pl, wall.id) === 1, "подсчёт использования типа");
try {
  deleteLegendType(pl, wall.id);
  assert(false, "используемый тип удалять нельзя");
} catch (e) {
  assert(e instanceof Error && e.message.includes("используют"), "понятная причина: тип используется");
}
// Пользовательский неиспользуемый тип → удаляется
const extra = addLegendType(pl, { name: "Временный", shape: "area" });
pl = deleteLegendType(extra.project, extra.typeId);
assert(!pl.legend.some((t) => t.name === "Временный"), "неиспользуемый пользовательский тип удалён");
// Базовый тип — единственный своей формы → удаление запрещено
try {
  deleteLegendType(pl, builtinPoint.id);
  assert(false, "единственный базовый тип формы удалять нельзя");
} catch {
  assert(true, "покрытие формы базовыми типами защищено");
}

// 28. Миграция: старый проект без legend/primitives получает значения по умолчанию
const legacyProject = JSON.parse(serializeSave(pl, afterRewrite)) as Record<string, unknown>;
delete legacyProject.legend;
const mapsRaw = legacyProject.maps as Record<string, Record<string, unknown>>;
for (const m of Object.values(mapsRaw)) delete m.primitives;
const migrated = deserializeSave(JSON.stringify(legacyProject));
assert(migrated.project.legend.length === 4, "миграция: созданы 4 базовых типа легенды");
assert(
  Object.values(migrated.project.maps).every((m) => Array.isArray(m.primitives) && m.primitives.length === 0),
  "миграция: пустые списки примитивов на всех картах",
);
assert(legacyProject.rootMapId === migrated.project.rootMapId, "миграция: маркеры и карты не потеряны");

// 29. Валидация примитивов: битый typeId → фолбэк; битая геометрия → отбраковка
const brokenType = JSON.parse(serializeProject(pl)) as Record<string, unknown>;
const brokenMaps = brokenType.maps as Record<string, Record<string, unknown>>;
const rootRaw = brokenMaps[pl.rootMapId];
rootRaw.primitives = [
  { ...JSON.parse(JSON.stringify(p1m)), typeId: "no-such-type" }, // фолбэк на тип формы point
  { id: "bad-line", kind: "line", typeId: wall.id, name: "x", note: "", visible: true, locked: false, points: [{ x: 0, y: 0 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, // <2 точек → отбраковка
  { kind: "alien" }, // неизвестный вид → отбраковка
];
const repaired = deserializeProject(JSON.stringify(brokenType));
const repairedRoot = repaired.maps[repaired.rootMapId];
const repairedP1 = repairedRoot.primitives.find((p) => p.id === p1.id)!;
assert(repairedP1.typeId !== "no-such-type", "битый typeId заменён фолбэком");
assert(
  repaired.legend.find((t) => t.id === repairedP1.typeId)?.shape === "point",
  "фолбэк — тип формы point",
);
assert(!repairedRoot.primitives.some((p) => p.id === "bad-line"), "линия из 1 точки отброшена");
assert(!repairedRoot.primitives.some((p) => p.kind === ("alien" as never)), "неизвестный вид отброшен");

// 30. Сериализация: примитивы и легенда переживают сохранение
const roundTrip = deserializeSave(serializeSave(pl, afterRewrite));
assert(roundTrip.project.legend.length === pl.legend.length, "легенда переживает сохранение");
assert(
  roundTrip.project.maps[pl.rootMapId].primitives.length === pl.maps[pl.rootMapId].primitives.length,
  "примитивы переживают сохранение",
);

// 31. Управление архивом: удаление записей и очистка
let pa = createProject("Архив-управление");
const locA1 = addLocation(pa, pa.rootMapId, 1, 1);
pa = locA1.project;
const locA2 = addLocation(pa, pa.rootMapId, 2, 2);
pa = locA2.project;
pa = deleteMarker(pa, pa.rootMapId, locA1.entityId);
pa = deleteMarker(pa, pa.rootMapId, locA2.entityId);
assert(pa.markerArchive.length === 2, "в архиве две записи");
pa = deleteArchivedMarker(pa, locA1.entityId);
assert(pa.markerArchive.length === 1, "запись удалена из архива по одной");
assert(!pa.maps[pa.rootMapId].entities.some((e) => e.id === locA1.entityId), "маркер при этом на карту не вернулся");
try {
  deleteArchivedMarker(pa, locA1.entityId);
  assert(false, "повторное удаление той же записи должно бросить ошибку");
} catch {
  assert(true, "отсутствующая запись — понятная ошибка");
}
const paBeforeClear = pa;
pa = clearMarkerArchive(pa);
assert(pa.markerArchive.length === 0, "архив очищен полностью");
assert(clearMarkerArchive(pa) === pa, "очистка пустого архива — no-op");
assert(pa.maps[pa.rootMapId].entities.length === 0, "очистка архива не трогает карту");
void paBeforeClear;

// 32. Размер шрифта подписи: кламп 8–72
let pf = createProject("Шрифт подписи");
const lf = addLocation(pf, pf.rootMapId, 0, 0);
pf = lf.project;
const labelFontType = pf.legend.find((t) => t.shape === "label")!;
const labelP = createLabelPrimitive(pf.maps[pf.rootMapId], labelFontType.id, 5, 5, "Большая");
pf = addPrimitive(pf, pf.rootMapId, labelP);
pf = updatePrimitive(pf, pf.rootMapId, labelP.id, { fontSize: 500 });
const labelBig = pf.maps[pf.rootMapId].primitives.find((p) => p.id === labelP.id)!;
assert(labelBig.kind === "label" && labelBig.fontSize === 72, "fontSize ограничен сверху (72)");
pf = updatePrimitive(pf, pf.rootMapId, labelP.id, { fontSize: 1 });
const labelSmall = pf.maps[pf.rootMapId].primitives.find((p) => p.id === labelP.id)!;
assert(labelSmall.kind === "label" && labelSmall.fontSize === 8, "fontSize ограничен снизу (8)");

// 33. Поворот, копирование, пакетное перемещение/удаление
let pr = createProject("Поворот");
const lr = addLocation(pr, pr.rootMapId, 0, 0);
pr = lr.project;
const rLineType = pr.legend.find((t) => t.shape === "line")!;
const rLine = createLinePrimitive(
  pr.maps[pr.rootMapId],
  rLineType.id,
  [{ x: 0, y: 0 }, { x: 100, y: 0 }],
);
pr = addPrimitive(pr, pr.rootMapId, rLine);
// центр bbox = (50, 0); поворот на 90° вокруг центра
pr = rotatePrimitive(pr, pr.rootMapId, rLine.id, Math.PI / 2);
const rLineRot = pr.maps[pr.rootMapId].primitives.find((p) => p.id === rLine.id)!;
assert(rLineRot.kind === "line", "повёрнутая линия на месте");
if (rLineRot.kind === "line") {
  const xs = rLineRot.points.map((p) => Math.round(p.x));
  const ys = rLineRot.points.map((p) => Math.round(p.y));
  assert(xs.every((x) => x === 50) && ys.includes(-50) && ys.includes(50), "поворот 90° вокруг центра bbox");
}
// поворот точки запрещён
const rPoint = createPointPrimitive(pr.maps[pr.rootMapId], pr.legend.find((t) => t.shape === "point")!.id, 5, 5);
pr = addPrimitive(pr, pr.rootMapId, rPoint);
try {
  rotatePrimitive(pr, pr.rootMapId, rPoint.id, 1);
  assert(false, "поворот точки должен бросить ошибку");
} catch {
  assert(true, "поворот только для линий и областей");
}
// копирование: новый id, имя со счётчиком, смещение, свойства сохранены
const copyRes = insertPrimitiveCopy(pr, pr.rootMapId, rLineRot, { x: 20, y: 20 });
pr = copyRes.project;
const rCopy = pr.maps[pr.rootMapId].primitives.find((p) => p.id === copyRes.primitiveId)!;
assert(rCopy.id !== rLineRot.id && rCopy.name === "Линия 2", "копия: новый id и имя");
assert(
  rCopy.kind === "line" && rCopy.points[0].x === rLineRot.points[0].x + 20,
  "копия: геометрия смещена",
);
// пакетное перемещение — оба примитива
pr = movePrimitives(pr, pr.rootMapId, [rLine.id, copyRes.primitiveId], 10, 0);
const movedLine = pr.maps[pr.rootMapId].primitives.find((p) => p.id === rLine.id)!;
const movedCopy = pr.maps[pr.rootMapId].primitives.find((p) => p.id === copyRes.primitiveId)!;
assert(
  (movedLine.kind === "line" ? movedLine.points[0].x : 0) === (rLineRot.kind === "line" ? rLineRot.points[0].x + 10 : 0) &&
  (movedCopy.kind === "line" ? movedCopy.points[0].x : 0) === (rCopy.kind === "line" ? rCopy.points[0].x + 10 : 0),
  "пакетное перемещение: оба примитива смещены",
);
// пакетное удаление
const beforeBatch = pr.maps[pr.rootMapId].primitives.length;
pr = deletePrimitives(pr, pr.rootMapId, [rLine.id, copyRes.primitiveId]);
assert(
  pr.maps[pr.rootMapId].primitives.length === beforeBatch - 2,
  "пакетное удаление: оба примитива удалены одной транзакцией",
);

// 34. Редактирование вершин: перемещение и вставка
const editLine = createLinePrimitive(
  pr.maps[pr.rootMapId],
  rLineType.id,
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
);
pr = addPrimitive(pr, pr.rootMapId, editLine);
pr = movePrimitiveVertex(pr, pr.rootMapId, editLine.id, 1, 10, 50);
const editLineMoved = pr.maps[pr.rootMapId].primitives.find((p) => p.id === editLine.id)!;
assert(
  editLineMoved.kind === "line" && editLineMoved.points[1].x === 10 && editLineMoved.points[1].y === 50,
  "вершина линии перемещена",
);
pr = insertPrimitiveVertex(pr, pr.rootMapId, editLine.id, 0, { x: 5, y: -5 });
const editLineInsert = pr.maps[pr.rootMapId].primitives.find((p) => p.id === editLine.id)!;
assert(
  editLineInsert.kind === "line" &&
    editLineInsert.points.length === 4 &&
    editLineInsert.points[1].x === 5 &&
    editLineInsert.points[1].y === -5,
  "вершина вставлена в сегмент двойным кликом",
);
try {
  movePrimitiveVertex(pr, pr.rootMapId, editLine.id, 99, 0, 0);
  assert(false, "перемещение несуществующей вершины должно бросить ошибку");
} catch {
  assert(true, "проверка индекса вершины");
}

// 18. Сериализация сохраняет архив; старые файлы без архива читаются
const text2 = serializeProject(p);
assert(deserializeProject(text2).markerArchive.length === p.markerArchive.length, "архив переживает сохранение");
const legacy = JSON.parse(text2) as Record<string, unknown>;
delete legacy.markerArchive;
const legacyParsed = deserializeProject(JSON.stringify(legacy));
assert(legacyParsed.markerArchive.length === 0, "файл v1 без архива загружается как пустой архив");

console.log(`\nВсе ${passed} проверок пройдены`);
