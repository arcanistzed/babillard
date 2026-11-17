package expo.modules.babillardmls

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.babillard_mls.MlsException
import uniffi.babillard_mls.Received
import uniffi.babillard_mls.TrustedDevice

/**
 * Passes calls from JavaScript to the Rust library. Bytes travel as unpadded
 * base64url, the same encoding as `toBase64` in @babillard/shared. Every
 * function is async, so the cryptography runs off the JavaScript thread.
 */
class BabillardMlsModule : Module() {
  private val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

  private fun bytes(text: String): ByteArray = Base64.decode(text, flags)

  private fun text(bytes: ByteArray): String = Base64.encodeToString(bytes, flags)

  private fun trusted(devices: List<Map<String, String>>): List<TrustedDevice> =
    devices.map { TrustedDevice(it.getValue("userId"), it.getValue("deviceId"), bytes(it.getValue("signatureKey"))) }

  private inline fun <T> mls(block: () -> T): T =
    try {
      block()
    } catch (error: MlsException.UntrustedCredential) {
      throw CodedException("ERR_UNTRUSTED_CREDENTIAL", "Could not validate credential", error)
    } catch (error: MlsException.Failed) {
      throw CodedException("ERR_MLS", error.reason, error)
    }

  override fun definition() = ModuleDefinition {
    Name("BabillardMls")

    // False if the Rust library is missing for this phone's ABI or won't load.
    Function("isReady") {
      try {
        uniffi.babillard_mls.libraryVersion().isNotEmpty()
      } catch (error: Throwable) {
        false
      }
    }

    AsyncFunction("createIdentity") { userId: String, deviceId: String ->
      mls {
        val identity = uniffi.babillard_mls.createIdentity(userId, deviceId)
        mapOf("state" to text(identity.state), "keyPackage" to text(identity.keyPackage), "signatureKey" to text(identity.signatureKey))
      }
    }

    AsyncFunction("createKeyPackage") { state: String ->
      mls {
        val result = uniffi.babillard_mls.createKeyPackage(bytes(state))
        mapOf("state" to text(result.state), "keyPackage" to text(result.keyPackage))
      }
    }

    AsyncFunction("createGroup") { state: String, groupId: String ->
      mls { text(uniffi.babillard_mls.createGroup(bytes(state), bytes(groupId))) }
    }

    AsyncFunction("addMembers") { state: String, groupId: String, keyPackages: List<String>, devices: List<Map<String, String>> ->
      mls {
        val output = uniffi.babillard_mls.addMembers(bytes(state), bytes(groupId), keyPackages.map { bytes(it) }, trusted(devices))
        mapOf("state" to text(output.state), "commit" to text(output.commit), "welcome" to output.welcome?.let { text(it) }, "groupInfo" to text(output.groupInfo))
      }
    }

    AsyncFunction("removeUser") { state: String, groupId: String, userId: String ->
      mls {
        val output = uniffi.babillard_mls.removeUser(bytes(state), bytes(groupId), userId)
        mapOf("state" to text(output.state), "commit" to text(output.commit), "groupInfo" to text(output.groupInfo))
      }
    }

    AsyncFunction("updateKeys") { state: String, groupId: String ->
      mls {
        val output = uniffi.babillard_mls.updateKeys(bytes(state), bytes(groupId))
        mapOf("state" to text(output.state), "commit" to text(output.commit), "groupInfo" to text(output.groupInfo))
      }
    }

    AsyncFunction("joinExternal") { state: String, groupInfo: String, devices: List<Map<String, String>> ->
      mls {
        val joined = uniffi.babillard_mls.joinExternal(bytes(state), bytes(groupInfo), trusted(devices))
        mapOf("state" to text(joined.state), "groupId" to text(joined.groupId), "commit" to text(joined.commit), "groupInfo" to text(joined.groupInfo))
      }
    }

    AsyncFunction("joinFromWelcome") { state: String, welcome: String, devices: List<Map<String, String>> ->
      mls {
        val joined = uniffi.babillard_mls.joinFromWelcome(bytes(state), bytes(welcome), trusted(devices))
        mapOf("state" to text(joined.state), "groupId" to text(joined.groupId))
      }
    }

    AsyncFunction("encrypt") { state: String, groupId: String, plaintext: String, aad: String ->
      mls {
        val sent = uniffi.babillard_mls.encrypt(bytes(state), bytes(groupId), bytes(plaintext), bytes(aad))
        mapOf("state" to text(sent.state), "message" to text(sent.message))
      }
    }

    AsyncFunction("receive") { state: String, groupId: String, message: String, devices: List<Map<String, String>> ->
      mls {
        when (val received = uniffi.babillard_mls.receive(bytes(state), bytes(groupId), bytes(message), trusted(devices))) {
          is Received.Application -> mapOf(
            "kind" to "application",
            "state" to text(received.state),
            "plaintext" to text(received.plaintext),
            "aad" to text(received.aad),
            "senderUserId" to received.senderUserId,
            "senderDeviceId" to received.senderDeviceId,
          )
          is Received.Commit -> mapOf("kind" to "commit", "state" to text(received.state), "removedMe" to received.removedMe)
        }
      }
    }

    AsyncFunction("groupStatus") { state: String, groupId: String ->
      mls {
        val status = uniffi.babillard_mls.groupStatus(bytes(state), bytes(groupId))
        mapOf(
          "epoch" to status.epoch.toDouble(),
          "roster" to status.roster.map {
            mapOf("leafIndex" to it.leafIndex.toInt(), "userId" to it.userId, "deviceId" to it.deviceId, "signatureKey" to text(it.signatureKey))
          },
        )
      }
    }
  }
}
