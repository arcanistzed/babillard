import { MlsMessenger, type MlsCrypto, type MlsStore, type MlsTransport } from "./mlsClient";
import { MemoryMlsServer } from "./mlsMemoryServer";

export interface EngineDemoResult {
  steps: { label: string; ms: number }[];
  read: { bob: string[]; carol: string[]; alice: string[] };
  codes: string[];
  rosterAfterLeave: number;
}

/**
 * Three phones run the full sync engine against an in-memory copy of the
 * server's rules: the group forms on its own, a message goes out, Carol leaves,
 * and Bob's next message waits until his phone has removed hers. The dev screen
 * runs this on OpenMLS and expo-sqlite; a unit test runs it on ts-mls.
 */
export async function runEngineDemo(
  crypto: MlsCrypto,
  storeFor: (name: string) => Promise<MlsStore>,
  now: () => number = Date.now,
): Promise<EngineDemoResult> {
  const steps: { label: string; ms: number }[] = [];
  async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = now();
    const value = await run();
    steps.push({ label, ms: Math.round(now() - start) });
    return value;
  }

  const server = new MemoryMlsServer();
  const chat = "engine-demo";
  server.setMembers(chat, ["alice", "bob", "carol"]);
  const phone = async (name: string) => new MlsMessenger(crypto, server.transportFor(name, `${name}-phone`), await storeFor(name), { userId: name, deviceId: `${name}-phone` });
  const [alice, bob, carol] = [await phone("alice"), await phone("bob"), await phone("carol")];

  await step("Three phones register and upload key packages", async () => {
    for (const p of [alice, bob, carol]) await p.ensureIdentity();
  });
  await step("Alice's sync creates the group and adds the others", () => alice.sync(chat));
  await step("Bob and Carol join from their Welcomes", async () => {
    await bob.sync(chat);
    await carol.sync(chat);
  });
  await step("Alice sends", () => alice.send(chat, "Thursday at the library?"));
  const bobRead = await step("Bob syncs", () => bob.sync(chat));
  const carolRead = await carol.sync(chat);

  server.setMembers(chat, ["alice", "bob"]);
  await step("Carol leaves; Bob's send removes her phone first", () => bob.send(chat, "Just the two of us"));
  const aliceRead = await step("Alice syncs", () => alice.sync(chat));
  const state = await server.transportFor("alice", "alice-phone").groupState(chat);

  const codes = (await Promise.all([alice.securityCode(chat), bob.securityCode(chat)])).map((code) => code ?? "");
  return {
    steps,
    read: { bob: bobRead.map((m) => m.text), carol: carolRead.map((m) => m.text), alice: aliceRead.map((m) => m.text) },
    codes,
    rosterAfterLeave: state.roster.length,
  };
}

export interface RecoveryDemoResult {
  steps: { label: string; ms: number }[];
  /** Commits Alice still had on record right after the lost answer, and after her next operation. */
  pendingAfterDrop: number;
  pendingAfterSettle: number;
  /** What Carol read after joining from Alice's commit whose answer was lost. */
  carolRead: string[];
  /** The status of Alice's message whose answer was lost, after her next sync. */
  lostMessageStatus: string;
  /** Bob's phone in the server's roster after it rejoined, and what it read next. */
  bobPhonesAfterRejoin: number;
  bobReadAfterRejoin: string[];
  codes: string[];
}

/**
 * The engine's recovery on real crypto and storage: a commit that lands while
 * its answer is lost, a message in the same situation, and an entry that one
 * phone can't apply however often it tries. The dev screen runs this on
 * OpenMLS and expo-sqlite; a unit test runs it on ts-mls.
 */
export async function runRecoveryDemo(
  crypto: MlsCrypto,
  storeFor: (name: string) => Promise<MlsStore>,
  now: () => number = Date.now,
): Promise<RecoveryDemoResult> {
  const steps: { label: string; ms: number }[] = [];
  async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = now();
    const value = await run();
    steps.push({ label, ms: Math.round(now() - start) });
    return value;
  }

  const server = new MemoryMlsServer();
  const chat = "recovery-demo";
  server.setMembers(chat, ["alice", "bob"]);

  // Alice's next submit reaches the server, but the answer never comes back.
  let dropNext: "commit" | "application" | null = null;
  const aliceBase = server.transportFor("alice", "alice-phone");
  const aliceTransport: MlsTransport = {
    ...aliceBase,
    submit: async (conversationId, body) => {
      const kind = body.groupInfo !== undefined ? "commit" : "application";
      if (dropNext !== kind) return aliceBase.submit(conversationId, body);
      dropNext = null;
      await aliceBase.submit(conversationId, body);
      throw new Error("connection dropped");
    },
  };
  // Bob's phone can't apply one particular message.
  const bobCrypto: MlsCrypto = {
    ...crypto,
    receive: async (...args) => {
      const result = await crypto.receive(...args);
      if (result.kind === "application" && new TextDecoder().decode(result.plaintext) === "garbled") throw new Error("can't apply this entry");
      return result;
    },
  };

  const aliceStore = await storeFor("alice");
  const alice = new MlsMessenger(crypto, aliceTransport, aliceStore, { userId: "alice", deviceId: "alice-phone" });
  const bob = new MlsMessenger(bobCrypto, server.transportFor("bob", "bob-phone"), await storeFor("bob"), { userId: "bob", deviceId: "bob-phone" });
  const carol = new MlsMessenger(crypto, server.transportFor("carol", "carol-phone"), await storeFor("carol"), { userId: "carol", deviceId: "carol-phone" });

  await step("Three phones register; Alice and Bob form the group", async () => {
    for (const p of [alice, bob, carol]) await p.ensureIdentity();
    await alice.sync(chat);
    await bob.sync(chat);
  });

  server.setMembers(chat, ["alice", "bob", "carol"]);
  dropNext = "commit";
  await step("Alice adds Carol; the commit lands but the answer is lost", async () => {
    const failed = await alice.sync(chat).then(
      () => false,
      () => true,
    );
    if (!failed) throw new Error("the dropped answer didn't surface as an error");
  });
  const pendingAfterDrop = Object.keys(await aliceStore.pendingCommits()).length;
  await step("Alice's next send takes up the commit from the log", () => alice.send(chat, "hi Carol"));
  const pendingAfterSettle = Object.keys(await aliceStore.pendingCommits()).length;
  const carolRead = (await step("Carol joins and syncs", () => carol.sync(chat))).map((m) => m.text);
  await bob.sync(chat);

  dropNext = "application";
  await step("Alice sends; it lands but the answer is lost", async () => {
    await alice.send(chat, "did this go?").catch(() => undefined);
    await alice.sync(chat);
  });
  const lostMessageStatus = (await aliceStore.messages(chat)).find((m) => m.text === "did this go?")?.status ?? "missing";
  await bob.sync(chat);

  await alice.send(chat, "garbled");
  await step("Bob fails the same entry twice, then rejoins by himself", async () => {
    const failed = await bob.sync(chat).then(
      () => false,
      () => true,
    );
    if (!failed) throw new Error("Bob's first try didn't fail");
    await bob.sync(chat);
  });
  const state = await server.transportFor("bob", "bob-phone").groupState(chat);
  await alice.send(chat, "can you read this?");
  const bobReadAfterRejoin = (await step("Bob reads what follows", () => bob.sync(chat))).map((m) => m.text);
  await carol.sync(chat);

  const codes = (await Promise.all([alice.securityCode(chat), bob.securityCode(chat), carol.securityCode(chat)])).map((code) => code ?? "");
  return {
    steps,
    pendingAfterDrop,
    pendingAfterSettle,
    carolRead,
    lostMessageStatus,
    bobPhonesAfterRejoin: state.roster.filter((entry) => entry.deviceId === "bob-phone").length,
    bobReadAfterRejoin,
    codes,
  };
}

/** Whether the recovery demo did what it should. */
export function recoveryPassed(result: RecoveryDemoResult): boolean {
  return (
    result.pendingAfterDrop === 1 &&
    result.pendingAfterSettle === 0 &&
    result.carolRead.join("|") === "hi Carol" &&
    result.lostMessageStatus === "sent" &&
    result.bobPhonesAfterRejoin === 1 &&
    result.bobReadAfterRejoin.join("|") === "can you read this?" &&
    result.codes[0] !== "" &&
    new Set(result.codes).size === 1
  );
}
