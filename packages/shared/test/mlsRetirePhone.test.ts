import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryMlsStore, MlsMessenger, MlsRemovedError } from "../src/mlsClient";
import { MemoryMlsServer } from "../src/mlsMemoryServer";
import { tsMlsCrypto } from "../src/mls/adapter";
import { mlsCiphersuite } from "../src/mls/provider";

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const crypto = tsMlsCrypto(mlsCiphersuite(random));
const CHAT = "chat";

describe("retiring one of a person's phones", () => {
  it("has the next sender remove it, while the person's other phone stays in the group", async () => {
    const server = new MemoryMlsServer();
    server.setMembers(CHAT, ["alice", "bob"]);
    const phone = (userId: string, deviceId: string) => new MlsMessenger(crypto, server.transportFor(userId, deviceId), new MemoryMlsStore(), { userId, deviceId });
    const alice = phone("alice", "alice-phone");
    const bob = phone("bob", "bob-phone");
    const lost = phone("bob", "bob-lost-phone");
    for (const p of [alice, bob, lost]) await p.ensureIdentity();
    await alice.sync(CHAT);
    await bob.sync(CHAT);
    await lost.sync(CHAT);
    await alice.send(CHAT, "hi both of Bob's phones");
    expect((await lost.sync(CHAT)).map((m) => m.text)).toEqual(["hi both of Bob's phones"]);
    const codeBefore = await alice.securityCode(CHAT);

    // Bob retires the phone he lost. The server now lists it as a pending removal.
    server.retireDevice("bob-lost-phone");
    const pending = await server.transportFor("alice", "alice-phone").groupState(CHAT);
    expect(pending.pendingRemovals.map((entry) => entry.deviceId)).toEqual(["bob-lost-phone"]);

    // Alice's next send commits the removal first.
    await alice.send(CHAT, "just your phone now");
    const after = await server.transportFor("alice", "alice-phone").groupState(CHAT);
    expect(after.roster.map((entry) => entry.deviceId).sort()).toEqual(["alice-phone", "bob-phone"]);
    expect(after.pendingRemovals).toEqual([]);

    // Bob's other phone reads on, and its security code matches Alice's new one.
    expect((await bob.sync(CHAT)).map((m) => m.text)).toEqual(["hi both of Bob's phones", "just your phone now"]);
    const codeAfter = await alice.securityCode(CHAT);
    expect(codeAfter).not.toBe(codeBefore);
    expect(await bob.securityCode(CHAT)).toBe(codeAfter);

    // The lost phone, if it syncs again, learns it was removed and can't read what came after.
    await expect(lost.sync(CHAT)).rejects.toBeInstanceOf(MlsRemovedError);
    expect((await lost.messages(CHAT)).map((m) => m.text)).not.toContain("just your phone now");
  });
});
