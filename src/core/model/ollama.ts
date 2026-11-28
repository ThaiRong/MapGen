/**
 * Реализация ModelAdapter через локальный Ollama (только последняя
 * версия API: /api/tags, /api/generate с format:"json").
 *
 * Изоляция: генераторы и ядро не импортируют этот модуль. HTTP идёт
 * строго на 127.0.0.1/localhost и только когда пользователь включил
 * модель в настройках. fetch инъецируем — тесты подставляют заглушку.
 */

import {
  ModelError,
  type ModelAdapter,
  type ModelMode,
  type ModelSettings,
  type SpecSuggestion,
} from "./adapter";
import { sanitizeModelOutput } from "./validate";

const TIMEOUT_MS = 30_000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

interface OllamaTagsResponse {
  models?: { name?: string; model?: string }[];
}

function ensureLocalHost(host: string): string {
  const normalized = host.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(normalized)) {
    throw new ModelError(
      "Разрешён только локальный адрес модели: 127.0.0.1 или localhost",
      "not-enabled",
    );
  }
  return normalized;
}

function buildPrompt(text: string, mode: ModelMode): string {
  if (mode === "terrain") {
    return [
      "Ты переводишь описание карты настольной ролевой игры в JSON-параметры генерации местности.",
      "Ответь СТРОГО одним JSON-объектом без пояснений. Поля (все необязательные):",
      "- relief, moisture, fluidLevel, areaDensity, lineDensity, pointDensity, detail — числа от 0 до 1;",
      "- temperature — число от -1 до 1;",
      "- fieldScale — число от 0.5 до 3 (частота структур поля).",
      "Интерпретируй слова пользователя нейтрально, без сеттинговых типов.",
      "Описание:",
      text,
    ].join("\n");
  }
  return [
    "Ты переводишь описание внутренней карты локации настольной ролевой игры в JSON-параметры генерации структуры.",
    "Ответь СТРОГО одним JSON-объектом без пояснений. Поля (все необязательные):",
    "- archetype — строка: cellular | linear | radial | cluster | open | mixed;",
    "- density, cellScale, irregularity, connectivity, sizeVariance, pointDensity, margin, detail — числа от 0 до 1;",
    "- nestedCount — целое 0..8 (число вложенных локаций).",
    "Выбери архетип по смыслу: ячеистая — разбиение на области, линейная — ось с ответвлениями, радиальная — лучи и кольца, кластерная — группы пятен, открытая — редкое размещение, смешанная — комбинация.",
    "Интерпретируй слова пользователя нейтрально, без сеттинговых типов.",
    "Описание:",
    text,
  ].join("\n");
}

export class OllamaAdapter implements ModelAdapter {
  private readonly host: string;
  private readonly model: string;
  private readonly fetchFn: FetchFn;

  constructor(settings: ModelSettings, fetchFn: FetchFn = fetch.bind(window)) {
    this.host = ensureLocalHost(settings.host);
    this.model = settings.model;
    this.fetchFn = fetchFn;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchFn(`${this.host}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ModelError(
          `Локальный сервер модели вернул HTTP ${response.status}`,
          "unavailable",
        );
      }
      return (await response.json()) as T;
    } catch (e) {
      if (e instanceof ModelError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new ModelError("Таймаут ответа локальной модели", "timeout");
      }
      throw new ModelError(
        "Локальный сервер модели недоступен. Проверьте, что Ollama запущен на 127.0.0.1.",
        "unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const data = await this.request<OllamaTagsResponse>("/api/tags");
      return Array.isArray(data.models);
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OllamaTagsResponse>("/api/tags");
    return (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  }

  async parseDescription(text: string, mode: ModelMode): Promise<SpecSuggestion> {
    if (!this.model) {
      throw new ModelError("Не выбрана модель в настройках", "not-enabled");
    }
    const data = await this.request<OllamaGenerateResponse>("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: buildPrompt(text, mode),
        format: "json",
        stream: false,
        options: { temperature: 0.2 },
      }),
    });
    if (data.error) {
      throw new ModelError(`Модель вернула ошибку: ${data.error}`, "invalid-response");
    }
    if (typeof data.response !== "string" || !data.response.trim()) {
      throw new ModelError("Модель вернула пустой ответ", "invalid-response");
    }
    return sanitizeModelOutput(data.response, mode);
  }
}

/** Фабрика адаптера из настроек (глобальный fetch, только локальный хост). */
export function createAdapter(settings: ModelSettings): ModelAdapter {
  return new OllamaAdapter(settings);
}
