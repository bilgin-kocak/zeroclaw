export type RoleId = string;

export interface TransportMessage {
  from: RoleId;
  to: RoleId | "broadcast";
  topic: string;
  payload: unknown;
  nonce: string;
}

export type TransportHandler = (msg: TransportMessage) => Promise<void>;

export interface TransportBackend {
  send(msg: TransportMessage): Promise<void>;
  subscribe(topic: string, handler: TransportHandler): Promise<() => void>;
  whoami(): Promise<RoleId>;
}
