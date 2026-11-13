import type { CiphersuiteImpl, ClientConfig, ClientState } from "ts-mls";
import { toBase64 } from "../e2ee";
import { MemoryDeliveryService } from "./delivery";
import {
  addDevices,
  clientConfig,
  createDevice,
  encodeKeyPackage,
  encryptText,
  joinFromWelcome,
  loadState,
  receive,
  rosterCode,
  saveState,
  startGroup,
  type MlsDevice,
} from "./group";
import { mlsCiphersuite } from "./provider";

/**
 * A phone in a chat, as the app would hold it: its group state, how far it has
 * read the server's log, and which entries it sent itself (MLS can't apply its
 * own commit twice, and its own messages aren't encrypted to itself).
 */
export class DemoMember {
  state: ClientState | null = null;
  cursor = 0;
  readonly sent = new Set<number>();
  readonly inbox: string[] = [];

  constructor(
    readonly device: MlsDevice,
    readonly config: ClientConfig,
    readonly cs: CiphersuiteImpl,
  ) {}

  async catchUp(server: MemoryDeliveryService): Promise<void> {
    for (const entry of server.since(this.cursor)) {
      this.cursor = entry.seq;
      if (this.sent.has(entry.seq)) continue;
      const result = await receive(this.state!, entry.bytes, this.cs);
      this.state = result.state;
      if (result.kind === "text") this.inbox.push(result.text);
    }
  }

  /** Reads anything new first, since the server refuses a message from an old epoch. */
  async send(server: MemoryDeliveryService, text: string): Promise<void> {
    await this.catchUp(server);
    const { state, message } = await encryptText(this.state!, text, this.cs);
    const result = server.submit(message);
    if (!result.ok) throw new Error(result.error);
    this.state = state;
    this.sent.add(server.log.length);
  }

  /** What an app restart does: write the state out and read it back. */
  reload(): number {
    const bytes = saveState(this.state!);
    this.state = loadState(bytes, this.config);
    return bytes.length;
  }
}

/** The server's device list, which the credential check trusts. Security codes are how people check it. */
export class DemoDirectory {
  readonly keys = new Map<string, string>();

  register(device: MlsDevice): void {
    this.keys.set(`${device.userId}/${device.deviceId}`, toBase64(device.keyPackage.leafNode.signaturePublicKey));
  }

  config(): ClientConfig {
    return clientConfig(({ userId, deviceId }, key) => this.keys.get(`${userId}/${deviceId}`) === toBase64(key));
  }
}

export interface DemoStep {
  label: string;
  ms: number;
}

export interface DemoResult {
  steps: DemoStep[];
  aliceInbox: string[];
  bobInbox: string[];
  aliceCode: string;
  bobCode: string;
  stateBytes: number;
}

/**
 * Two phones form a group through an in-memory server and trade one message
 * each, with a restart in between. The dev screen runs this on the phone to
 * check ts-mls under Hermes and to time each step.
 */
export async function runTwoMemberDemo(random: (length: number) => Uint8Array, now: () => number = Date.now): Promise<DemoResult> {
  const steps: DemoStep[] = [];
  async function step<T>(label: string, run: () => Promise<T> | T): Promise<T> {
    const start = now();
    const value = await run();
    steps.push({ label, ms: Math.round(now() - start) });
    return value;
  }

  const cs = mlsCiphersuite(random);
  const directory = new DemoDirectory();
  const server = new MemoryDeliveryService("demo-chat");

  const [aliceDevice, bobDevice] = await step("Create two phones' key packages", () =>
    Promise.all([createDevice("alice", "phone-a", cs), createDevice("bob", "phone-b", cs)]),
  );
  directory.register(aliceDevice);
  directory.register(bobDevice);
  const alice = new DemoMember(aliceDevice, directory.config(), cs);
  const bob = new DemoMember(bobDevice, directory.config(), cs);

  alice.state = await step("Alice starts the group", () => startGroup("demo-chat", aliceDevice, cs, alice.config));
  const added = await step("Alice adds Bob (commit and Welcome)", () => addDevices(alice.state!, [encodeKeyPackage(bobDevice)], cs));
  const admitted = server.submit(added.commit, { deviceIds: [bobDevice.deviceId], bytes: added.welcome! });
  if (!admitted.ok) throw new Error(admitted.error);
  alice.state = added.state;
  alice.sent.add(server.log.length);

  const welcome = server.welcomes.get(bobDevice.deviceId)!;
  bob.state = await step("Bob joins from the Welcome", () => joinFromWelcome(welcome.bytes, bobDevice, cs, bob.config));
  bob.cursor = welcome.seq;

  const stateBytes = await step("Both save and reload their state", () => {
    alice.reload();
    return bob.reload();
  });

  await step("Alice sends", () => alice.send(server, "Hi Bob, see you Thursday?"));
  await step("Bob reads", () => bob.catchUp(server));
  await step("Bob replies", () => bob.send(server, "Yes, at the library."));
  await step("Alice reads", () => alice.catchUp(server));

  return { steps, aliceInbox: alice.inbox, bobInbox: bob.inbox, aliceCode: rosterCode(alice.state), bobCode: rosterCode(bob.state), stateBytes };
}
