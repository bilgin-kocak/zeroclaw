import type { MemoryBackend } from "../backend.js";

export class InMemoryBackend implements MemoryBackend {
  private kv = new Map<string, unknown>();
  private streams = new Map<string, unknown[]>();

  async get(key: string): Promise<unknown | null> {
    return this.kv.has(key) ? (this.kv.get(key) ?? null) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.kv.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.kv.delete(key);
  }

  async append(stream: string, entry: unknown): Promise<void> {
    const arr = this.streams.get(stream) ?? [];
    arr.push(entry);
    this.streams.set(stream, arr);
  }

  async read(
    stream: string,
    opts?: { from?: number; to?: number },
  ): Promise<unknown[]> {
    const arr = this.streams.get(stream) ?? [];
    const from = opts?.from ?? 0;
    const to = opts?.to ?? arr.length;
    return arr.slice(from, to);
  }
}
