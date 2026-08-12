import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppState } from "../src/types";

export interface StateStore {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  reset(state: AppState): Promise<void>;
}

export class JsonStateStore implements StateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AppState | null> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as AppState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }

  async reset(state: AppState): Promise<void> {
    await this.save(state);
  }
}

export class MemoryStateStore implements StateStore {
  private state: AppState | null = null;

  async load() {
    return this.state ? structuredClone(this.state) : null;
  }

  async save(state: AppState) {
    this.state = structuredClone(state);
  }

  async reset(state: AppState) {
    await this.save(state);
  }
}
