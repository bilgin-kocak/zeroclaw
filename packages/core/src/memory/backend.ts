export interface MemoryBackend {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  append(stream: string, entry: unknown): Promise<void>;
  read(
    stream: string,
    opts?: { from?: number; to?: number },
  ): Promise<unknown[]>;
}
