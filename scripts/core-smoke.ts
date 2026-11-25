import {
  addLocation,
  createProject,
  deleteMap,
  deleteMarker,
  moveMarker,
  renameMap,
  renameMarker,
  restoreMarker,
  setMapScale,
  setMapView,
  validateProject,
  ValidationError,
  ROOT_MAP_NAME,
  NEW_LOCATION_NAME,
} from "../src/core/project";
import { buildTree, getPathToRoot, getDescendantIds } from "../src/core/tree";
import { commit, emptyHistory, redo, undo } from "../src/core/history";
import { deserializeProject, serializeProject } from "../src/storage/json";

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

// 12. Undo/redo
let history = emptyHistory();
const before = project;
history = commit(history, before);
const after = renameMap(project, project.rootMapId, "Другой мир");
const stepU = undo(history, after);
assert(stepU.project === before, "undo возвращает прежний проект");
const stepR = redo(stepU.history, after);
assert(stepR.project === after, "redo возвращает новый проект");
// Лимит истории
let h2 = emptyHistory();
for (let i = 0; i < 150; i += 1) h2 = commit(h2, before);
assert(h2.past.length === 100, "история ограничена 100 шагами");

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

// 17. Удаление и восстановление попадают в историю (снапшоты)
let h3 = emptyHistory();
h3 = commit(h3, beforeDelete);
const afterDelete = deleteMarker(beforeDelete, beforeDelete.rootMapId, locA.entityId);
const undoDelete = undo(h3, afterDelete);
assert(
  undoDelete.project!.markerArchive.length === 0 &&
    undoDelete.project!.maps[undoDelete.project!.rootMapId].entities.length === 1,
  "undo удаления возвращает маркер и очищает архив",
);
const h4 = commit(h3, afterDelete);
const afterRestore = restoreMarker(afterDelete, locA.entityId).project;
const undoRestore = undo(h4, afterRestore);
assert(
  undoRestore.project!.markerArchive.length === 1 &&
    undoRestore.project!.maps[undoRestore.project!.rootMapId].entities.length === 0,
  "undo восстановления возвращает маркер в архив",
);

// 18. Сериализация сохраняет архив; старые файлы без архива читаются
const text2 = serializeProject(p);
assert(deserializeProject(text2).markerArchive.length === p.markerArchive.length, "архив переживает сохранение");
const legacy = JSON.parse(text2) as Record<string, unknown>;
delete legacy.markerArchive;
const legacyParsed = deserializeProject(JSON.stringify(legacy));
assert(legacyParsed.markerArchive.length === 0, "файл v1 без архива загружается как пустой архив");

console.log(`\nВсе ${passed} проверок пройдены`);
