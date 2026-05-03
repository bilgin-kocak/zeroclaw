import { EventEmitter } from "node:events";
import type { ConstitutionEvent } from "@zeroclaw/core";

/**
 * Pub-sub for streaming Constitution events to multiple UI surfaces (web,
 * Telegram, etc.) in parallel. Decouples Constitution from any IO surface.
 */
export class ConstitutionEventStream {
  private emitter = new EventEmitter();

  publish(event: ConstitutionEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(handler: (event: ConstitutionEvent) => void): () => void {
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }
}
