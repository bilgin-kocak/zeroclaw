import type { MemoryBackend } from "./backend.js";

interface LogEntry<T = unknown> {
  ts: number;
  entry: T;
}

/**
 * Thin layer over MemoryBackend: namespacing + timestamps for log entries.
 * Spec §4.5.
 */
export class Memory {
  constructor(
    private backend: MemoryBackend,
    private namespace: string = "default",
    private clock: () => number = () => Date.now(),
  ) {}

  private nsKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private nsStream(stream: string): string {
    return `${this.namespace}:${stream}`;
  }

  async recall(key: string): Promise<unknown | null> {
    return this.backend.get(this.nsKey(key));
  }

  async remember(key: string, value: unknown): Promise<void> {
    return this.backend.set(this.nsKey(key), value);
  }

  async forget(key: string): Promise<void> {
    return this.backend.delete(this.nsKey(key));
  }

  async log<T>(stream: string, entry: T): Promise<void> {
    const wrapped: LogEntry<T> = { ts: this.clock(), entry };
    return this.backend.append(this.nsStream(stream), wrapped);
  }

  async history<T = unknown>(stream: string, limit?: number): Promise<T[]> {
    const all = (await this.backend.read(this.nsStream(stream))) as LogEntry<T>[];
    const slice = limit !== undefined ? all.slice(-limit) : all;
    return slice.map((e) => e.entry);
  }
}
