import { useEffect, useMemo, useRef, useState } from "react";
import {
  nestedKindChain,
  renderName,
  validateSettingProfile,
  type ProfileValidationResult,
} from "../core/profiles";
import { createRng } from "../core/generation/rng";
import { generate } from "../core/generation/generate";
import { generateStructure } from "../core/generation/structure/generateStructure";
import type {
  LegendType,
  LocationKind,
  NamingRule,
  SettingProfile,
  StructureArchetype,
  TerrainKind,
} from "../core/types";
import { readProfile } from "../storage/profiles";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

const ARCHETYPES: { value: StructureArchetype; label: string }[] = [
  { value: "cellular", label: "Ячеистая" },
  { value: "linear", label: "Линейная" },
  { value: "radial", label: "Радиальная" },
  { value: "cluster", label: "Кластерная" },
  { value: "open", label: "Открытая" },
  { value: "mixed", label: "Смешанная" },
];

const SHAPES: { value: LegendType["shape"]; label: string }[] = [
  { value: "point", label: "Точка" },
  { value: "line", label: "Линия" },
  { value: "area", label: "Область" },
  { value: "label", label: "Подпись" },
];

const SECTIONS = [
  "Общее",
  "Категории",
  "Типы легенды",
  "Правила имён",
  "Виды локаций",
  "Виды местности",
] as const;
type Section = (typeof SECTIONS)[number];

interface ProfilesDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Библиотека профилей и редактор. Профиль — чистые данные: типы,
 * категории, правила имён (шаблон + списки слов), виды локаций и
 * местности. В коде нет ни одного сеттингового слова.
 */
export default function ProfilesDialog({ open, onClose }: ProfilesDialogProps) {
  const profilesList = useAppStore((s) => s.profilesList);
  const profilesLoaded = useAppStore((s) => s.profilesLoaded);
  const refreshProfiles = useAppStore((s) => s.refreshProfiles);
  const createProfile = useAppStore((s) => s.createProfile);
  const duplicateProfileById = useAppStore((s) => s.duplicateProfileById);
  const deleteProfileById = useAppStore((s) => s.deleteProfileById);
  const importProfile = useAppStore((s) => s.importProfile);
  const exportProfile = useAppStore((s) => s.exportProfile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const applyProfileById = useAppStore((s) => s.applyProfileById);
  const detachActiveProfile = useAppStore((s) => s.detachActiveProfile);
  const project = useAppStore((s) => s.project);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<Section>("Общее");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);

  useEffect(() => {
    if (open && !profilesLoaded) void refreshProfiles();
  }, [open, profilesLoaded, refreshProfiles]);

  const loadIntoEditor = async (id: string) => {
    try {
      const raw = await readProfile(id);
      const parsed: ProfileValidationResult = validateSettingProfile(JSON.parse(raw));
      setDraft(parsed.profile);
      setDirty(false);
      setSelectedId(id);
      setSection("Общее");
    } catch (e) {
      useAppStore
        .getState()
        .setStatus(e instanceof Error ? `Профиль недоступен: ${e.message}` : "Профиль недоступен");
    }
  };

  const patchDraft = (p: Partial<SettingProfile>) => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  };

  const handleCreate = async () => {
    const id = await createProfile(`Профиль ${profilesList.length + 1}`);
    if (id) await loadIntoEditor(id);
  };

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const filtered = useMemo(
    () =>
      profilesList.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [profilesList, search],
  );

  if (!open) return null;

  const appliedId = project.activeProfileId;

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-layout">
          {/* ---- Библиотека ---- */}
          <div className="profile-list-pane">
            <div className="profile-list-header">
              <h3>Профили сеттинга</h3>
              <div className="row">
                <button className="mini" onClick={() => void handleCreate()} title="Создать пустой профиль">
                  + Создать
                </button>
                <button className="mini" onClick={() => void importProfile()} title="Импорт из JSON">
                  Импорт
                </button>
              </div>
            </div>
            <input
              type="text"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filtered.length === 0 ? (
              <div className="profile-empty">
                <p>Библиотека пуста. Профиль — это ваши типы легенды, категории, правила имён и виды генерации.</p>
                <p>Проект работает и без профиля: нейтральные типы и параметры, как раньше.</p>
                <button onClick={() => void handleCreate()}>Создать первый профиль</button>
              </div>
            ) : (
              <ul className="profile-items">
                {filtered.map((p) => (
                  <li
                    key={p.id}
                    className={`profile-item${p.id === selectedId ? " active" : ""}`}
                    onClick={() => void loadIntoEditor(p.id)}
                  >
                    <span className="profile-item-name">
                      {p.name}
                      {p.id === appliedId && <span className="profile-badge">применён</span>}
                    </span>
                    <span className="profile-item-actions">
                      <button
                        className="mini"
                        title="Применить к проекту"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmApply(p.id);
                        }}
                      >
                        Применить
                      </button>
                      <button
                        className="mini"
                        title="Дублировать"
                        onClick={(e) => {
                          e.stopPropagation();
                          void duplicateProfileById(p.id);
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        className="mini"
                        title="Экспорт в JSON"
                        onClick={(e) => {
                          e.stopPropagation();
                          void exportProfile(p.id);
                        }}
                      >
                        ⇩
                      </button>
                      <button
                        className="mini danger"
                        title="Удалить из библиотеки"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(p.id);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- Редактор ---- */}
          <div className="profile-editor-pane">
            {draft ? (
              <>
                <div className="profile-editor-header">
                  <div className="gen-tabs profile-tabs">
                    {SECTIONS.map((sct) => (
                      <button
                        key={sct}
                        className={section === sct ? "active" : undefined}
                        onClick={() => setSection(sct)}
                      >
                        {sct}
                      </button>
                    ))}
                  </div>
                  <div className="row">
                    {dirty && <span className="profile-dirty">несохранённые изменения</span>}
                    <button
                      disabled={!dirty}
                      onClick={() => {
                        void saveProfile(draft).then(() => setDirty(false));
                      }}
                    >
                      Сохранить профиль
                    </button>
                    <button onClick={requestClose}>Закрыть</button>
                  </div>
                </div>
                <div className="profile-editor-body">
                  {section === "Общее" && (
                    <GeneralSection draft={draft} onChange={patchDraft} />
                  )}
                  {section === "Категории" && (
                    <CategoriesSection draft={draft} onChange={patchDraft} />
                  )}
                  {section === "Типы легенды" && (
                    <TypesSection draft={draft} onChange={patchDraft} />
                  )}
                  {section === "Правила имён" && (
                    <NamingSection draft={draft} onChange={patchDraft} />
                  )}
                  {section === "Виды локаций" && (
                    <LocationKindsSection draft={draft} onChange={patchDraft} />
                  )}
                  {section === "Виды местности" && (
                    <TerrainKindsSection draft={draft} onChange={patchDraft} />
                  )}
                </div>
              </>
            ) : (
              <div className="profile-empty">
                <p>Выберите профиль слева или создайте новый.</p>
                {appliedId && (
                  <p>
                    Активный профиль проекта: {profilesList.find((p) => p.id === appliedId)?.name ?? appliedId}
                    {project.profileSnapshot && " (встроенный снапшот)"}
                  </p>
                )}
                {appliedId && (
                  <button onClick={() => detachActiveProfile(true)}>Отключить профиль от проекта</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Удалить профиль из библиотеки?"
        message={
          confirmDelete === appliedId
            ? "Этот профиль применён к проекту. После удаления файла проект продолжит работать на встроенном снапшоте: типы и примитивы останутся, генерация воспроизводима. Продолжить?"
            : "Файл профиля будет удалён из библиотеки. Проекты с его снапшотом продолжат работать. Продолжить?"
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          if (confirmDelete) void deleteProfileById(confirmDelete);
          if (confirmDelete === selectedId) {
            setDraft(null);
            setSelectedId(null);
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Закрыть без сохранения?"
        message="В профиле есть несохранённые изменения. Они будут потеряны."
        confirmLabel="Закрыть без сохранения"
        danger
        onConfirm={() => {
          setConfirmClose(false);
          setDirty(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
      <ConfirmDialog
        open={confirmApply !== null}
        title="Применить профиль к проекту?"
        message={
          confirmApply === null
            ? ""
            : `Профиль «${profilesList.find((p) => p.id === confirmApply)?.name ?? confirmApply}» будет применён к проекту: типы легенды добавятся или обновятся по id, существующие типы и примитивы сохранятся. Конфликты форм блокируют применение с объяснением. Действие — одна запись в журнале (Ctrl+Z откатит целиком). Продолжить?`
        }
        confirmLabel="Применить"
        onConfirm={() => {
          if (confirmApply) applyProfileById(confirmApply);
          setConfirmApply(null);
        }}
        onCancel={() => setConfirmApply(null)}
      />
    </div>
  );
}

/* ================= Разделы редактора ================= */

function GeneralSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  return (
    <>
      <div className="field">
        <label>Название профиля</label>
        <input type="text" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>Описание</label>
        <textarea
          className="textarea"
          rows={4}
          value={draft.description}
          placeholder="Для чего этот профиль, какой сеттинг он описывает — словами пользователя"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="hint">
        Профиль — данные: типы легенды, категории, правила имён, виды генерации. Смысл
        придаёте вы; ядро приложения остаётся сеттинг-агностичным.
      </div>
    </>
  );
}

function CategoriesSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  const used = (id: string) =>
    draft.legendTypes.some((t) => t.category === id) ||
    draft.locationKinds.some((k) => k.categoryId === id) ||
    draft.terrainKinds.some((k) => k.categoryId === id);

  const move = (index: number, dir: -1 | 1) => {
    const cats = [...draft.categories].sort((a, b) => a.order - b.order);
    const target = index + dir;
    if (target < 0 || target >= cats.length) return;
    [cats[index], cats[target]] = [cats[target], cats[index]];
    onChange({ categories: cats.map((c, i) => ({ ...c, order: i })) });
  };

  return (
    <>
      <button
        onClick={() =>
          onChange({
            categories: [
              ...draft.categories,
              { id: crypto.randomUUID(), name: `Категория ${draft.categories.length + 1}`, order: draft.categories.length },
            ],
          })
        }
      >
        + Категория
      </button>
      <ul className="profile-sublist">
        {[...draft.categories]
          .sort((a, b) => a.order - b.order)
          .map((c, index) => (
            <li key={c.id} className="row">
              <input
                type="text"
                value={c.name}
                onChange={(e) =>
                  onChange({
                    categories: draft.categories.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
                  })
                }
              />
              <button className="mini" disabled={index === 0} onClick={() => move(index, -1)} title="Выше">
                ↑
              </button>
              <button
                className="mini"
                disabled={index === draft.categories.length - 1}
                onClick={() => move(index, 1)}
                title="Ниже"
              >
                ↓
              </button>
              <button
                className="mini danger"
                disabled={used(c.id)}
                title={used(c.id) ? "Категория используется — сначала уберите типы и виды из неё" : "Удалить"}
                onClick={() => onChange({ categories: draft.categories.filter((x) => x.id !== c.id) })}
              >
                ✕
              </button>
            </li>
          ))}
      </ul>
    </>
  );
}

function TypesSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = draft.legendTypes.find((t) => t.id === selId) ?? null;

  const referencedByKinds = (id: string) =>
    draft.locationKinds.some(
      (k) => k.typeMapping.area === id || k.typeMapping.line === id || k.typeMapping.point === id || k.typeMapping.label === id,
    ) || draft.terrainKinds.some((k) => k.typeMapping.area === id || k.typeMapping.line === id || k.typeMapping.point === id || k.typeMapping.label === id);

  const patchType = (id: string, p: Partial<LegendType>) =>
    onChange({ legendTypes: draft.legendTypes.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  return (
    <div className="profile-two-col">
      <div>
        <button
          onClick={() => {
            const t: LegendType = {
              id: crypto.randomUUID(),
              name: `Тип ${draft.legendTypes.length + 1}`,
              category: "",
              shape: "line",
              color: "#9aa3b2",
              opacity: 1,
              strokeWidth: 2,
              strokeStyle: "solid",
              visible: true,
              isBuiltin: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            onChange({ legendTypes: [...draft.legendTypes, t] });
            setSelId(t.id);
          }}
        >
          + Тип
        </button>
        <ul className="profile-sublist">
          {draft.legendTypes.map((t) => (
            <li key={t.id} className={`profile-pick${t.id === selId ? " active" : ""}`} onClick={() => setSelId(t.id)}>
              <span className="legend-swatch" style={{ background: t.color }} />
              {t.name}
              <span className="legend-shape">
                {SHAPES.find((s) => s.value === t.shape)?.label}
                {t.category ? ` · ${t.category}` : ""}
              </span>
            </li>
          ))}
          {draft.legendTypes.length === 0 && <li className="hint">Типов пока нет — создайте первый.</li>}
        </ul>
      </div>
      <div>
        {sel && (
          <>
            <div className="field">
              <label>Название</label>
              <input type="text" value={sel.name} onChange={(e) => patchType(sel.id, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>Форма</label>
              <select
                className="select"
                value={sel.shape}
                onChange={(e) => patchType(sel.id, { shape: e.target.value as LegendType["shape"] })}
              >
                {SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Категория</label>
              <select
                className="select"
                value={sel.category}
                onChange={(e) => patchType(sel.id, { category: e.target.value })}
              >
                <option value="">—</option>
                {draft.categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Цвет</label>
                <input type="color" value={sel.color} onChange={(e) => patchType(sel.id, { color: e.target.value })} />
              </div>
              <div className="field">
                <label>Прозрачность: {Math.round(sel.opacity * 100)}%</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sel.opacity}
                  onChange={(e) => patchType(sel.id, { opacity: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Толщина</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={sel.strokeWidth}
                  onChange={(e) => patchType(sel.id, { strokeWidth: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>Стиль линии</label>
                <select
                  className="select"
                  value={sel.strokeStyle}
                  onChange={(e) => patchType(sel.id, { strokeStyle: e.target.value as LegendType["strokeStyle"] })}
                >
                  <option value="solid">Сплошная</option>
                  <option value="dashed">Пунктир</option>
                </select>
              </div>
            </div>
            <div className="buttons">
              <button
                className="danger"
                disabled={referencedByKinds(sel.id)}
                title={referencedByKinds(sel.id) ? "Тип используется видами генерации — сначала уберите из маппингов" : "Удалить тип"}
                onClick={() => {
                  onChange({ legendTypes: draft.legendTypes.filter((t) => t.id !== sel.id) });
                  setSelId(null);
                }}
              >
                Удалить тип
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NamingSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = draft.namingRules.find((r) => r.id === selId) ?? null;

  const patchRule = (id: string, p: Partial<NamingRule>) =>
    onChange({ namingRules: draft.namingRules.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  return (
    <div className="profile-two-col">
      <div>
        <button
          onClick={() => {
            const r: NamingRule = {
              id: crypto.randomUUID(),
              name: `Правило ${draft.namingRules.length + 1}`,
              appliesTo: "area",
              pattern: "{A} {B}",
              lists: { A: [], B: [] },
            };
            onChange({ namingRules: [...draft.namingRules, r] });
            setSelId(r.id);
          }}
        >
          + Правило
        </button>
        <ul className="profile-sublist">
          {draft.namingRules.map((r) => (
            <li key={r.id} className={`profile-pick${r.id === selId ? " active" : ""}`} onClick={() => setSelId(r.id)}>
              {r.name}
              <span className="legend-shape">
                {r.pattern} · для {r.appliesTo}
              </span>
            </li>
          ))}
          {draft.namingRules.length === 0 && <li className="hint">Правил нет — имена будут нейтральными счётными.</li>}
        </ul>
      </div>
      <div>
        {sel && (
          <>
            <div className="field">
              <label>Название правила</label>
              <input type="text" value={sel.name} onChange={(e) => patchRule(sel.id, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>Применяется к</label>
              <select
                className="select"
                value={sel.appliesTo}
                onChange={(e) => patchRule(sel.id, { appliesTo: e.target.value as NamingRule["appliesTo"] })}
              >
                <option value="area">Областям</option>
                <option value="line">Линиям</option>
                <option value="point">Точкам</option>
                <option value="label">Подписям</option>
                <option value="location">Локациям</option>
              </select>
            </div>
            <div className="field">
              <label>Шаблон: ключи в {'{фигурных скобках}'}</label>
              <input type="text" value={sel.pattern} onChange={(e) => patchRule(sel.id, { pattern: e.target.value })} />
            </div>
            {Object.keys(sel.lists).map((key) => (
              <div className="field" key={key}>
                <label>
                  Список «{key}» — одно слово на строку
                  <button
                    className="mini"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      const lists = { ...sel.lists };
                      delete lists[key];
                      patchRule(sel.id, { lists });
                    }}
                  >
                    удалить список
                  </button>
                </label>
                <textarea
                  className="textarea"
                  rows={4}
                  value={(sel.lists[key] ?? []).join("\n")}
                  onChange={(e) =>
                    patchRule(sel.id, {
                      lists: {
                        ...sel.lists,
                        [key]: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                />
              </div>
            ))}
            <div className="row">
              <input
                type="text"
                placeholder="Новый ключ, напр. C"
                id={`new-key-${sel.id}`}
              />
              <button
                onClick={() => {
                  const input = document.getElementById(`new-key-${sel.id}`) as HTMLInputElement | null;
                  const key = input?.value.trim();
                  if (!key || sel.lists[key]) return;
                  patchRule(sel.id, { lists: { ...sel.lists, [key]: [] } });
                  if (input) input.value = "";
                }}
              >
                + Список
              </button>
            </div>
            <RuleExamples rule={sel} />
          </>
        )}
      </div>
    </div>
  );
}

/** Живые детерминированные примеры имён по правилу. */
function RuleExamples({ rule }: { rule: NamingRule }) {
  const examples = (() => {
    const out: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const rng = createRng(`примеры::${rule.id}::${i}`);
      out.push(renderName(rule, rng) ?? "— (нейтральный счётчик)");
    }
    return out;
  })();
  return (
    <div className="gen-stats" style={{ marginTop: 8 }}>
      Примеры (детерминированы): {examples.join(" · ")}
    </div>
  );
}

function LocationKindsSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = draft.locationKinds.find((k) => k.id === selId) ?? null;

  const patchKind = (id: string, p: Partial<LocationKind>) =>
    onChange({ locationKinds: draft.locationKinds.map((k) => (k.id === id ? { ...k, ...p } : k)) });

  return (
    <div className="profile-two-col">
      <div>
        <button
          onClick={() => {
            const k: LocationKind = {
              id: crypto.randomUUID(),
              name: `Вид локации ${draft.locationKinds.length + 1}`,
              archetype: "cellular",
              defaults: {},
              typeMapping: { area: "", line: "", point: "", label: "" },
            };
            onChange({ locationKinds: [...draft.locationKinds, k] });
            setSelId(k.id);
          }}
        >
          + Вид локации
        </button>
        <ul className="profile-sublist">
          {draft.locationKinds.map((k) => (
            <li key={k.id} className={`profile-pick${k.id === selId ? " active" : ""}`} onClick={() => setSelId(k.id)}>
              {k.name}
              <span className="legend-shape">{ARCHETYPES.find((a) => a.value === k.archetype)?.label}</span>
            </li>
          ))}
          {draft.locationKinds.length === 0 && <li className="hint">Видов нет — маркеры генерируются без вида, как раньше.</li>}
        </ul>
      </div>
      <div>
        {sel && (
          <>
            <div className="field">
              <label>Название вида</label>
              <input type="text" value={sel.name} onChange={(e) => patchKind(sel.id, { name: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Категория</label>
                <select
                  className="select"
                  value={sel.categoryId ?? ""}
                  onChange={(e) => patchKind(sel.id, { categoryId: e.target.value || undefined })}
                >
                  <option value="">—</option>
                  {draft.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Архетип</label>
                <select
                  className="select"
                  value={sel.archetype}
                  onChange={(e) => patchKind(sel.id, { archetype: e.target.value as StructureArchetype })}
                >
                  {ARCHETYPES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <KindSliders
              values={sel.defaults}
              onChange={(defaults) => patchKind(sel.id, { defaults })}
              nestedCount
            />
            <MappingSelects
              profile={draft}
              mapping={sel.typeMapping}
              onChange={(typeMapping) => patchKind(sel.id, { typeMapping })}
            />
            <div className="field">
              <label>Правило имён</label>
              <RuleSelect
                rules={draft.namingRules}
                value={sel.namingRuleId}
                onChange={(namingRuleId) => patchKind(sel.id, { namingRuleId })}
              />
            </div>
            <div className="field">
              <label>Вид вложенных локаций</label>
              <select
                className="select"
                value={sel.nestedKindId ?? ""}
                onChange={(e) => patchKind(sel.id, { nestedKindId: e.target.value || undefined })}
              >
                <option value="">—</option>
                {draft.locationKinds
                  .filter((k) => k.id !== sel.id)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
              </select>
              {sel.nestedKindId && nestedKindChain(draft, sel.nestedKindId).length >= 8 && (
                <div className="hint">Цепочка вложенности достигла лимита глубины (8) — дальше обрывается.</div>
              )}
            </div>
            <KindPreview draft={draft} kind={sel} />
            <div className="buttons">
              <button
                className="danger"
                onClick={() => {
                  onChange({ locationKinds: draft.locationKinds.filter((k) => k.id !== sel.id) });
                  setSelId(null);
                }}
              >
                Удалить вид
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TerrainKindsSection({
  draft,
  onChange,
}: {
  draft: SettingProfile;
  onChange: (p: Partial<SettingProfile>) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = draft.terrainKinds.find((k) => k.id === selId) ?? null;

  const patchKind = (id: string, p: Partial<TerrainKind>) =>
    onChange({ terrainKinds: draft.terrainKinds.map((k) => (k.id === id ? { ...k, ...p } : k)) });

  return (
    <div className="profile-two-col">
      <div>
        <button
          onClick={() => {
            const k: TerrainKind = {
              id: crypto.randomUUID(),
              name: `Вид местности ${draft.terrainKinds.length + 1}`,
              defaults: {},
              typeMapping: { area: "", line: "", point: "", label: "" },
            };
            onChange({ terrainKinds: [...draft.terrainKinds, k] });
            setSelId(k.id);
          }}
        >
          + Вид местности
        </button>
        <ul className="profile-sublist">
          {draft.terrainKinds.map((k) => (
            <li key={k.id} className={`profile-pick${k.id === selId ? " active" : ""}`} onClick={() => setSelId(k.id)}>
              {k.name}
            </li>
          ))}
          {draft.terrainKinds.length === 0 && <li className="hint">Видов нет — местность генерируется по ручным параметрам.</li>}
        </ul>
      </div>
      <div>
        {sel && (
          <>
            <div className="field">
              <label>Название вида</label>
              <input type="text" value={sel.name} onChange={(e) => patchKind(sel.id, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>Категория</label>
              <select
                className="select"
                value={sel.categoryId ?? ""}
                onChange={(e) => patchKind(sel.id, { categoryId: e.target.value || undefined })}
              >
                <option value="">—</option>
                {draft.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <TerrainSliders values={sel.defaults} onChange={(defaults) => patchKind(sel.id, { defaults })} />
            <MappingSelects
              profile={draft}
              mapping={sel.typeMapping}
              onChange={(typeMapping) => patchKind(sel.id, { typeMapping })}
            />
            <div className="field">
              <label>Правило имён</label>
              <RuleSelect
                rules={draft.namingRules}
                value={sel.namingRuleId}
                onChange={(namingRuleId) => patchKind(sel.id, { namingRuleId })}
              />
            </div>
            <TerrainPreview draft={draft} kind={sel} />
            <div className="buttons">
              <button
                className="danger"
                onClick={() => {
                  onChange({ terrainKinds: draft.terrainKinds.filter((k) => k.id !== sel.id) });
                  setSelId(null);
                }}
              >
                Удалить вид
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RuleSelect({
  rules,
  value,
  onChange,
}: {
  rules: NamingRule[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">— нейтральные счётные имена —</option>
      {rules.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({r.pattern})
        </option>
      ))}
    </select>
  );
}

function MappingSelects({
  profile,
  mapping,
  onChange,
}: {
  profile: SettingProfile;
  mapping: { area: string; line: string; point: string; label: string };
  onChange: (m: { area: string; line: string; point: string; label: string }) => void;
}) {
  const typesOf = (shape: LegendType["shape"]) => profile.legendTypes.filter((t) => t.shape === shape);
  const pick = (shape: LegendType["shape"], value: string) => onChange({ ...mapping, [shape]: value });
  return (
    <>
      {SHAPES.map((s) => (
        <div className="field" key={s.value}>
          <label>Тип для {s.label.toLowerCase()}s</label>
          <select className="select" value={mapping[s.value]} onChange={(e) => pick(s.value, e.target.value)}>
            <option value="">—</option>
            {typesOf(s.value).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </>
  );
}

function KindSliders({
  values,
  onChange,
  nestedCount = false,
}: {
  values: Partial<import("../core/types").StructureSpec>;
  onChange: (v: Partial<import("../core/types").StructureSpec>) => void;
  nestedCount?: boolean;
}) {
  const slider = (key: keyof typeof values, label: string) => (
    <div className="field" key={key}>
      <label>
        {label}: {Math.round((Number(values[key] ?? 0.5)) * 100) / 100}
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={Number(values[key] ?? 0.5)}
        onChange={(e) => onChange({ ...values, [key]: Number(e.target.value) })}
      />
    </div>
  );
  return (
    <>
      {slider("density", "Плотность")}
      {slider("cellScale", "Размер элементов")}
      {slider("irregularity", "Нерегулярность")}
      {slider("connectivity", "Связность")}
      {slider("sizeVariance", "Разброс размеров")}
      {slider("pointDensity", "Плотность узлов")}
      {slider("margin", "Отступ от границ")}
      {slider("detail", "Детализация")}
      {nestedCount && (
        <div className="field">
          <label>Вложенные локации (0–8): {Math.round(Number(values.nestedCount ?? 0))}</label>
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={Number(values.nestedCount ?? 0)}
            onChange={(e) => onChange({ ...values, nestedCount: Number(e.target.value) })}
          />
        </div>
      )}
    </>
  );
}

function TerrainSliders({
  values,
  onChange,
}: {
  values: Partial<import("../core/types").GenerationSpec>;
  onChange: (v: Partial<import("../core/types").GenerationSpec>) => void;
}) {
  const slider = (key: keyof typeof values, label: string, def = 0.5, min = 0, max = 1) => (
    <div className="field" key={key}>
      <label>
        {label}: {Math.round(Number(values[key] ?? def) * 100) / 100}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={Number(values[key] ?? def)}
        onChange={(e) => onChange({ ...values, [key]: Number(e.target.value) })}
      />
    </div>
  );
  return (
    <>
      {slider("relief", "Рельеф")}
      {slider("moisture", "Влажность")}
      {slider("temperature", "Температура", 0, -1, 1)}
      {slider("fluidLevel", "Уровень жидкости")}
      {slider("areaDensity", "Плотность областей")}
      {slider("lineDensity", "Плотность линий")}
      {slider("pointDensity", "Плотность точек")}
      {slider("detail", "Детализация")}
      {slider("fieldScale", "Масштаб поля", 1, 0.5, 3)}
    </>
  );
}

/** Живой детерминированный предпросмотр вида локации. */
function KindPreview({ draft, kind }: { draft: SettingProfile; kind: LocationKind }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#16171c";
    ctx.fillRect(0, 0, w, h);
    const spec = {
      seed: "предпросмотр",
      archetype: kind.archetype,
      density: kind.defaults.density ?? 0.5,
      cellScale: kind.defaults.cellScale ?? 0.5,
      irregularity: kind.defaults.irregularity ?? 0.35,
      connectivity: kind.defaults.connectivity ?? 0.5,
      sizeVariance: kind.defaults.sizeVariance ?? 0.4,
      pointDensity: kind.defaults.pointDensity ?? 0.4,
      nestedCount: kind.defaults.nestedCount ?? 0,
      margin: kind.defaults.margin ?? 0.25,
      detail: kind.defaults.detail ?? 0.6,
      bounds: { x: 0, y: 0, width: w, height: h },
      typeMapping: {
        area: kind.typeMapping.area || "area",
        line: kind.typeMapping.line || "line",
        point: kind.typeMapping.point || "point",
        label: kind.typeMapping.label || "label",
      },
      labels: { enabled: false },
    };
    const result = generateStructure(spec);
    const typeOf = (id: string): LegendType | undefined =>
      draft.legendTypes.find((t) => t.id === id) ?? draft.legendTypes.find((t) => t.shape === id);
    const sx = (x: number) => x;
    const sy = (y: number) => y;
    for (const p of result.primitives) {
      const type = typeOf(p.typeId);
      const color = type?.color ?? "#8a94a6";
      ctx.globalAlpha = (type?.opacity ?? 1) * 0.6;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, (type?.strokeWidth ?? 2) * 0.75);
      ctx.setLineDash(type?.strokeStyle === "dashed" ? [6, 4] : []);
      if (p.kind === "area" && p.points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(sx(p.points[0].x), sy(p.points[0].y));
        for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(sx(p.points[i].x), sy(p.points[i].y));
        ctx.closePath();
        ctx.globalAlpha = (type?.opacity ?? 1) * 0.25;
        ctx.fill();
        ctx.globalAlpha = (type?.opacity ?? 1) * 0.8;
        ctx.stroke();
      } else if (p.kind === "line" && p.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(sx(p.points[0].x), sy(p.points[0].y));
        for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(sx(p.points[i].x), sy(p.points[i].y));
        ctx.stroke();
      } else if (p.kind === "point") {
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [draft, kind]);
  return (
    <div className="field">
      <label>Предпросмотр (детерминирован)</label>
      <canvas ref={canvasRef} width={300} height={200} className="profile-preview-canvas" />
    </div>
  );
}

/** Живой детерминированный предпросмотр вида местности. */
function TerrainPreview({ draft, kind }: { draft: SettingProfile; kind: TerrainKind }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#16171c";
    ctx.fillRect(0, 0, w, h);
    const spec = {
      seed: "предпросмотр",
      relief: kind.defaults.relief ?? 0.5,
      moisture: kind.defaults.moisture ?? 0.5,
      temperature: kind.defaults.temperature ?? 0,
      fluidLevel: kind.defaults.fluidLevel ?? 0.42,
      areaDensity: kind.defaults.areaDensity ?? 0.4,
      lineDensity: kind.defaults.lineDensity ?? 0.35,
      pointDensity: kind.defaults.pointDensity ?? 0.3,
      detail: kind.defaults.detail ?? 0.5,
      fieldScale: kind.defaults.fieldScale ?? 1.5,
      bounds: { x: 0, y: 0, width: w, height: h },
      typeMapping: {
        area: kind.typeMapping.area || "area",
        line: kind.typeMapping.line || "line",
        point: kind.typeMapping.point || "point",
        label: kind.typeMapping.label || "label",
      },
      labels: { enabled: false },
    };
    const result = generate(spec, { preview: true });
    const typeOf = (id: string): LegendType | undefined =>
      draft.legendTypes.find((t) => t.id === id) ?? draft.legendTypes.find((t) => t.shape === id);
    for (const p of result.primitives) {
      const type = typeOf(p.typeId);
      const color = type?.color ?? "#8a94a6";
      ctx.globalAlpha = (type?.opacity ?? 1) * 0.6;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, (type?.strokeWidth ?? 2) * 0.75);
      ctx.setLineDash(type?.strokeStyle === "dashed" ? [6, 4] : []);
      if (p.kind === "area" && p.points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(p.points[i].x, p.points[i].y);
        ctx.closePath();
        ctx.globalAlpha = (type?.opacity ?? 1) * 0.25;
        ctx.fill();
        ctx.globalAlpha = (type?.opacity ?? 1) * 0.8;
        ctx.stroke();
      } else if (p.kind === "line" && p.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i += 1) ctx.lineTo(p.points[i].x, p.points[i].y);
        ctx.stroke();
      } else if (p.kind === "point") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [draft, kind]);
  return (
    <div className="field">
      <label>Предпросмотр (детерминирован)</label>
      <canvas ref={canvasRef} width={300} height={200} className="profile-preview-canvas" />
    </div>
  );
}
