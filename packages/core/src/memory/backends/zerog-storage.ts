import { ethers } from "ethers";
import type { MemoryBackend } from "../backend.js";

export interface ZeroGStorageConfig {
  rpcUrl: string;
  privateKey: string;
  /** Indexer URL (Turbo recommended). */
  indexerRpc: string;
  /**
   * Optional: legacy KV endpoint. We do not depend on it (the public testnet
   * KV node `http://3.101.147.150:6789` was offline when this was written —
   * see feedback/ZEROG_FEEDBACK.md). Reserved for future use.
   */
  kvEndpoint?: string;
  /** Flow contract address (Galileo testnet: 0x22E03a6A89B950F1c82ec5e74F8eCa321a105296). */
  flowContract?: string;
  /** Logical stream id; reserved for future on-chain indexing. */
  streamId?: string;
}

/**
 * 0G Storage backend implemented as blob uploads through the Turbo indexer.
 *
 * Each `set` / `append` call uploads a small blob (JSON-stringified value)
 * via `Indexer.upload`. The returned root hash is stored in an in-process
 * map so subsequent `get` / `read` calls can fetch the blob via
 * `Indexer.downloadToBlob`.
 *
 * **Limitation (documented in ZEROG_FEEDBACK.md):** root-hash index is
 * in-memory only, so values are not visible across processes. The right
 * primitive for cross-process persistence is the on-chain Stream KV via the
 * public KV node, which was offline at the time of integration. For demos
 * within a single process (which is our submission shape), this is fine.
 */
export class ZeroGStorageBackend implements MemoryBackend {
  private wallet: ethers.Wallet;
  private indexerCache: unknown | null = null;
  private kvIndex = new Map<string, string>();
  private streamIndex = new Map<string, string[]>();

  constructor(private cfg: ZeroGStorageConfig) {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new ethers.Wallet(cfg.privateKey, provider);
  }

  async get(key: string): Promise<unknown | null> {
    const rootHash = this.kvIndex.get(key);
    if (!rootHash) return null;
    const text = await this.downloadText(rootHash);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    const rootHash = await this.uploadText(text);
    this.kvIndex.set(key, rootHash);
  }

  async delete(key: string): Promise<void> {
    this.kvIndex.delete(key);
  }

  async append(stream: string, entry: unknown): Promise<void> {
    const text = JSON.stringify(entry);
    const rootHash = await this.uploadText(text);
    const arr = this.streamIndex.get(stream) ?? [];
    arr.push(rootHash);
    this.streamIndex.set(stream, arr);
  }

  async read(
    stream: string,
    opts?: { from?: number; to?: number },
  ): Promise<unknown[]> {
    const arr = this.streamIndex.get(stream) ?? [];
    const from = opts?.from ?? 0;
    const to = opts?.to ?? arr.length;
    const slice = arr.slice(from, to);
    const out: unknown[] = [];
    for (const rh of slice) {
      const text = await this.downloadText(rh);
      if (text === null) continue;
      try {
        out.push(JSON.parse(text));
      } catch {
        out.push(text);
      }
    }
    return out;
  }

  /** Returns the latest root hash recorded for a stream — useful as the
   *  ENS reputation pointer (the agent's "where its mind lives" signal). */
  latestRootForStream(stream: string): string | null {
    const arr = this.streamIndex.get(stream);
    return arr && arr.length > 0 ? arr[arr.length - 1] ?? null : null;
  }

  // ---- internals ----

  private async getSdk(): Promise<{
    Indexer: new (rpc: string) => unknown;
    MemData: new (data: Uint8Array) => unknown;
  }> {
    const mod = (await import("@0gfoundation/0g-storage-ts-sdk")) as Record<
      string,
      unknown
    >;
    return {
      Indexer: mod.Indexer as never,
      MemData: mod.MemData as never,
    };
  }

  private async getIndexer(): Promise<{
    upload: (
      file: unknown,
      rpc: string,
      signer: ethers.Wallet,
    ) => Promise<[{ rootHash?: string; tx?: { rootHash?: string } }, unknown]>;
    downloadToBlob: (
      rootHash: string,
      opts?: { proof?: boolean },
    ) => Promise<[Uint8Array | null, unknown]>;
  }> {
    if (!this.indexerCache) {
      const { Indexer } = await this.getSdk();
      this.indexerCache = new Indexer(this.cfg.indexerRpc);
    }
    return this.indexerCache as ReturnType<
      ZeroGStorageBackend["getIndexer"]
    > extends Promise<infer R>
      ? R
      : never;
  }

  private async uploadText(text: string): Promise<string> {
    const { MemData } = await this.getSdk();
    const indexer = await this.getIndexer();
    const bytes = new TextEncoder().encode(text);
    const file = new MemData(bytes);
    const [tx, err] = await indexer.upload(
      file,
      this.cfg.rpcUrl,
      this.wallet,
    );
    if (err) {
      throw new Error(`0G Storage upload failed: ${stringifyErr(err)}`);
    }
    const rootHash =
      (tx as { rootHash?: string; tx?: { rootHash?: string } }).rootHash ??
      (tx as { tx?: { rootHash?: string } }).tx?.rootHash;
    if (!rootHash) {
      throw new Error("0G Storage upload returned no rootHash");
    }
    return rootHash;
  }

  private async downloadText(rootHash: string): Promise<string | null> {
    const indexer = await this.getIndexer();
    const [blob, err] = (await indexer.downloadToBlob(rootHash, {
      proof: false,
    })) as [unknown, unknown];
    if (err || !blob) return null;
    // SDK returns a standard Web Blob.
    if (blob instanceof Blob) return await blob.text();
    if (blob instanceof Uint8Array) return new TextDecoder().decode(blob);
    const inner = (blob as { blob?: unknown }).blob;
    if (inner instanceof Uint8Array) return new TextDecoder().decode(inner);
    return null;
  }
}

const stringifyErr = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};
