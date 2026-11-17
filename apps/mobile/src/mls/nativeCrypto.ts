import type { MlsCrypto } from "@babillard/shared";
import * as Mls from "../../modules/babillard-mls";

/** The sync engine's crypto, on OpenMLS through the native module. */
export const nativeCrypto: MlsCrypto = {
  createIdentity: (userId, deviceId) => Mls.createIdentity(userId, deviceId),
  createKeyPackage: (state) => Mls.createKeyPackage(state),
  createGroup: (state, conversationId) => Mls.createGroup(state, conversationId),
  addMembers: (state, conversationId, keyPackages, trusted) => Mls.addMembers(state, conversationId, keyPackages, trusted),
  removeLeaves: (state, conversationId, leafIndexes) => Mls.removeLeaves(state, conversationId, leafIndexes),
  updateKeys: (state, conversationId) => Mls.updateKeys(state, conversationId),
  joinFromWelcome: (state, welcome, trusted) => Mls.joinFromWelcome(state, welcome, trusted),
  // OpenMLS replaces this phone's old leaf by itself when its signing key is already in the group.
  joinExternal: (state, groupInfo, trusted) => Mls.joinExternal(state, groupInfo, trusted),
  forgetGroup: (state, conversationId) => Mls.forgetGroup(state, conversationId),
  encrypt: (state, conversationId, plaintext, aad) => Mls.encrypt(state, conversationId, plaintext, aad),
  receive: (state, conversationId, message, trusted) => Mls.receive(state, conversationId, message, trusted),
  async groupStatus(state, conversationId) {
    try {
      return await Mls.groupStatus(state, conversationId);
    } catch (error) {
      // The Rust side reports a missing group as an ordinary failure. Anything else is a real error.
      if (error instanceof Error && error.message.includes("no such group")) return null;
      throw error;
    }
  },
};
