import {
  addLocation,
  createProject,
  deleteMap,
  deleteMarker,
  moveMarker,
  renameMap,
  renameMarker,
  restoreMarker,
  restoreMarkerEntity,
  setMapScale,
  setMapView,
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

// 18. Сериализация сохраняет архив; старые файлы без архива читаются
const text2 = serializeProject(p);
assert(deserializeProject(text2).markerArchive.length === p.markerArchive.length, "архив переживает сохранение");
const legacy = JSON.parse(text2) as Record<string, unknown>;
delete legacy.markerArchive;
const legacyParsed = deserializeProject(JSON.stringify(legacy));
assert(legacyParsed.markerArchive.length === 0, "файл v1 без архива загружается как пустой архив");

console.log(`\nВсе ${passed} проверок пройдены`);
