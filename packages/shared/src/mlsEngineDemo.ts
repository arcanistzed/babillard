import { MlsMessenger, type MlsCrypto, type MlsStore } from "./mlsClient";
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
