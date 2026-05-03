import { EventEmitter } from "node:events";
import type {
  RoleId,
  TransportBackend,
  TransportHandler,
  TransportMessage,
} from "../backend.js";

/**
 * Shared bus: multiple InProcessTransportBackend instances bound to the same
 * EventBus communicate locally. This was the test transport in the spec; with
 * Gensyn dropped from this build it is also the production transport.
 */
export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    // Higher than the default 10 — many topics will subscribe.
    this.emitter.setMaxListeners(100);
  }
  publish(msg: TransportMessage): void {
    this.emitter.emit(msg.topic, msg);
    this.emitter.emit("*", msg);
  }
  on(topic: string, handler: (msg: TransportMessage) => void): () => void {
    this.emitter.on(topic, handler);
    return () => this.emitter.off(topic, handler);
  }
}

export class InProcessTransportBackend implements TransportBackend {
  constructor(
    private readonly bus: EventBus,
    private readonly identity: RoleId,
  ) {}

  async send(msg: TransportMessage): Promise<void> {
    this.bus.publish(msg);
  }

  async subscribe(
    topic: string,
    handler: TransportHandler,
  ): Promise<() => void> {
    const unsub = this.bus.on(topic, (msg) => {
      // Filter: not from self, and addressed to us or broadcast.
      if (msg.from === this.identity) return;
      if (msg.to !== "broadcast" && msg.to !== this.identity) return;
      void handler(msg);
    });
    return unsub;
  }

  async whoami(): Promise<RoleId> {
    return this.identity;
  }
}
