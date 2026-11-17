//! Babillard's group encryption, on OpenMLS.
//!
//! The app never sees a key. Each call takes the phone's whole MLS state as
//! bytes and returns the new state. If a call fails, the caller still has the
//! old bytes, so nothing is half-applied. The app saves the new state in the
//! same transaction as whatever it learned, such as a message's text.
//!
//! Every phone's credential is `userId/deviceId` plus its Ed25519 signing key.
//! OpenMLS checks signatures, but deciding which keys belong to which person
//! is up to us. Every call that brings someone new into view takes the list of
//! devices the server vouches for, and refuses anyone not on it.

use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_memory_storage::MemoryStorage;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::OpenMlsProvider;
use std::collections::HashMap;
use std::sync::RwLock;

uniffi::setup_scaffolding!();

/// The same suite the ts-mls prototype used, so the wire format didn't change.
const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;
const STATE_VERSION: u8 = 1;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MlsError {
    /// Someone's credential isn't on the server's device list, or its key doesn't match.
    #[error("Could not validate credential")]
    UntrustedCredential,
    /// The message or state was malformed, out of order, or otherwise refused.
    #[error("{reason}")]
    Failed { reason: String },
}

type Result<T> = std::result::Result<T, MlsError>;

fn fail(error: impl std::fmt::Debug) -> MlsError {
    MlsError::Failed { reason: format!("{error:?}") }
}

/// A device the server vouches for.
#[derive(Clone, uniffi::Record)]
pub struct TrustedDevice {
    pub user_id: String,
    pub device_id: String,
    pub signature_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct Identity {
    pub state: Vec<u8>,
    pub key_package: Vec<u8>,
    pub signature_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct NewKeyPackage {
    pub state: Vec<u8>,
    pub key_package: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct CommitOutput {
    pub state: Vec<u8>,
    /// A PublicMessage, so the server can read its epoch.
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
    /// The new epoch's GroupInfo, with the ratchet tree. The server requires it with every commit,
    /// so any member's phone can always join on its own.
    pub group_info: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct ExternalJoin {
    pub state: Vec<u8>,
    pub group_id: Vec<u8>,
    /// An external commit, for the server's log.
    pub commit: Vec<u8>,
    pub group_info: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct Joined {
    pub state: Vec<u8>,
    pub group_id: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct Sent {
    pub state: Vec<u8>,
    pub message: Vec<u8>,
}

#[derive(uniffi::Enum)]
pub enum Received {
    Application { state: Vec<u8>, plaintext: Vec<u8>, aad: Vec<u8>, sender_user_id: String, sender_device_id: String },
    Commit { state: Vec<u8>, removed_me: bool },
}

#[derive(uniffi::Record)]
pub struct RosterEntry {
    pub leaf_index: u32,
    pub user_id: String,
    pub device_id: String,
    pub signature_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct GroupStatus {
    pub epoch: u64,
    pub roster: Vec<RosterEntry>,
}

struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Provider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &MemoryStorage {
        &self.storage
    }
    fn crypto(&self) -> &RustCrypto {
        &self.crypto
    }
    fn rand(&self) -> &RustCrypto {
        &self.crypto
    }
}

/// One phone: who it is, and everything OpenMLS stored for it.
struct Device {
    user_id: String,
    device_id: String,
    signature_key: Vec<u8>,
    provider: Provider,
}

fn parse_identity(identity: &[u8]) -> Option<(String, String)> {
    let text = std::str::from_utf8(identity).ok()?;
    let (user_id, device_id) = text.split_once('/')?;
    (!user_id.is_empty() && !device_id.is_empty() && !device_id.contains('/')).then(|| (user_id.to_owned(), device_id.to_owned()))
}

fn identity_of(credential: &Credential) -> Option<(String, String)> {
    let basic = BasicCredential::try_from(credential.clone()).ok()?;
    parse_identity(basic.identity())
}

fn check(trusted: &[TrustedDevice], credential: &Credential, signature_key: &[u8]) -> Result<()> {
    let (user_id, device_id) = identity_of(credential).ok_or(MlsError::UntrustedCredential)?;
    let known = trusted.iter().any(|device| device.user_id == user_id && device.device_id == device_id && device.signature_key == signature_key);
    known.then_some(()).ok_or(MlsError::UntrustedCredential)
}

fn check_leaf(trusted: &[TrustedDevice], leaf: &LeafNode) -> Result<()> {
    check(trusted, leaf.credential(), leaf.signature_key().as_slice())
}

fn create_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        // Commits go out as PublicMessages so the server can order them. Application messages are always encrypted.
        .wire_format_policy(MIXED_PLAINTEXT_WIRE_FORMAT_POLICY)
        .build()
}

fn join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder().use_ratchet_tree_extension(true).wire_format_policy(MIXED_PLAINTEXT_WIRE_FORMAT_POLICY).build()
}

fn read_message(bytes: &[u8]) -> Result<MlsMessageBodyIn> {
    Ok(MlsMessageIn::tls_deserialize_exact(bytes).map_err(fail)?.extract())
}

fn write_message(message: &MlsMessageOut) -> Result<Vec<u8>> {
    message.tls_serialize_detached().map_err(fail)
}

/// A small reader for the state format below. Every length is checked.
struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        if self.bytes.len() < length {
            return Err(fail("state is truncated"));
        }
        let (head, rest) = self.bytes.split_at(length);
        self.bytes = rest;
        Ok(head)
    }
    fn number(&mut self) -> Result<usize> {
        let raw: [u8; 8] = self.take(8)?.try_into().map_err(fail)?;
        usize::try_from(u64::from_be_bytes(raw)).map_err(fail)
    }
    fn chunk(&mut self) -> Result<&'a [u8]> {
        let length = self.number()?;
        self.take(length)
    }
    fn text(&mut self) -> Result<String> {
        String::from_utf8(self.chunk()?.to_vec()).map_err(fail)
    }
}

fn write_chunk(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    out.extend_from_slice(bytes);
}

impl Device {
    fn new(user_id: &str, device_id: &str) -> Result<(Self, SignatureKeyPair)> {
        if parse_identity(format!("{user_id}/{device_id}").as_bytes()).is_none() {
            return Err(fail("user and device IDs must be non-empty and contain no slash"));
        }
        let provider = Provider { crypto: RustCrypto::default(), storage: MemoryStorage::default() };
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(fail)?;
        signer.store(provider.storage()).map_err(fail)?;
        let device = Device { user_id: user_id.to_owned(), device_id: device_id.to_owned(), signature_key: signer.public().to_vec(), provider };
        Ok((device, signer))
    }

    /// Format: version, user, device, signing key, then OpenMLS's key-value pairs sorted by key.
    fn save(&self) -> Result<Vec<u8>> {
        let values = self.provider.storage.values.read().map_err(fail)?;
        let mut entries: Vec<_> = values.iter().collect();
        entries.sort();
        let mut out = vec![STATE_VERSION];
        write_chunk(&mut out, self.user_id.as_bytes());
        write_chunk(&mut out, self.device_id.as_bytes());
        write_chunk(&mut out, &self.signature_key);
        out.extend_from_slice(&(entries.len() as u64).to_be_bytes());
        for (key, value) in entries {
            write_chunk(&mut out, key);
            write_chunk(&mut out, value);
        }
        Ok(out)
    }

    fn load(state: &[u8]) -> Result<Self> {
        let mut reader = Reader { bytes: state };
        if reader.take(1)? != [STATE_VERSION] {
            return Err(fail("unknown state version"));
        }
        let (user_id, device_id, signature_key) = (reader.text()?, reader.text()?, reader.chunk()?.to_vec());
        let count = reader.number()?;
        let mut values = HashMap::with_capacity(count.min(4096));
        for _ in 0..count {
            let key = reader.chunk()?.to_vec();
            values.insert(key, reader.chunk()?.to_vec());
        }
        if !reader.bytes.is_empty() {
            return Err(fail("state has trailing bytes"));
        }
        let provider = Provider { crypto: RustCrypto::default(), storage: MemoryStorage { values: RwLock::new(values) } };
        Ok(Device { user_id, device_id, signature_key, provider })
    }

    fn signer(&self) -> Result<SignatureKeyPair> {
        SignatureKeyPair::read(self.provider.storage(), &self.signature_key, CIPHERSUITE.signature_algorithm()).ok_or_else(|| fail("signing key missing from state"))
    }

    fn credential(&self) -> CredentialWithKey {
        let identity = format!("{}/{}", self.user_id, self.device_id).into_bytes();
        CredentialWithKey { credential: BasicCredential::new(identity).into(), signature_key: self.signature_key.clone().into() }
    }

    fn key_package(&self, signer: &SignatureKeyPair) -> Result<Vec<u8>> {
        let bundle = KeyPackage::builder().build(CIPHERSUITE, &self.provider, signer, self.credential()).map_err(fail)?;
        write_message(&MlsMessageOut::from(bundle.key_package().clone()))
    }

    fn group(&self, group_id: &[u8]) -> Result<MlsGroup> {
        MlsGroup::load(self.provider.storage(), &GroupId::from_slice(group_id)).map_err(fail)?.ok_or_else(|| fail("no such group"))
    }

    fn group_info(&self, group: &MlsGroup) -> Result<Vec<u8>> {
        write_message(&group.export_group_info(self.provider.crypto(), &self.signer()?, true).map_err(fail)?)
    }

    fn commit_output(&self, group: &MlsGroup, commit: MlsMessageOut, welcome: Option<MlsMessageOut>) -> Result<CommitOutput> {
        Ok(CommitOutput {
            state: self.save()?,
            commit: write_message(&commit)?,
            welcome: welcome.as_ref().map(write_message).transpose()?,
            group_info: self.group_info(group)?,
        })
    }
}

/// Proves the library loaded. The app calls it once before offering MLS.
#[uniffi::export]
pub fn library_version() -> String {
    format!("babillard_mls {} on openmls 0.9.2", env!("CARGO_PKG_VERSION"))
}

/// A new phone identity with its first key package. Each key package can be used once.
#[uniffi::export]
pub fn create_identity(user_id: String, device_id: String) -> Result<Identity> {
    let (device, signer) = Device::new(&user_id, &device_id)?;
    let key_package = device.key_package(&signer)?;
    Ok(Identity { state: device.save()?, key_package, signature_key: device.signature_key.clone() })
}

/// Another single-use key package for the server to hand out.
#[uniffi::export]
pub fn create_key_package(state: Vec<u8>) -> Result<NewKeyPackage> {
    let device = Device::load(&state)?;
    let key_package = device.key_package(&device.signer()?)?;
    Ok(NewKeyPackage { state: device.save()?, key_package })
}

#[uniffi::export]
pub fn create_group(state: Vec<u8>, group_id: Vec<u8>) -> Result<Vec<u8>> {
    let device = Device::load(&state)?;
    MlsGroup::new_with_group_id(&device.provider, &device.signer()?, &create_config(), GroupId::from_slice(&group_id), device.credential()).map_err(fail)?;
    device.save()
}

/// Adds phones from their key packages. The returned state already includes the commit.
/// If the server refuses the commit, keep the old state and try again.
#[uniffi::export]
pub fn add_members(state: Vec<u8>, group_id: Vec<u8>, key_packages: Vec<Vec<u8>>, trusted: Vec<TrustedDevice>) -> Result<CommitOutput> {
    let device = Device::load(&state)?;
    let mut packages = Vec::with_capacity(key_packages.len());
    for bytes in &key_packages {
        let MlsMessageBodyIn::KeyPackage(package) = read_message(bytes)? else {
            return Err(fail("not a key package"));
        };
        let package = package.validate(device.provider.crypto(), ProtocolVersion::Mls10).map_err(fail)?;
        check_leaf(&trusted, package.leaf_node())?;
        packages.push(package);
    }
    let mut group = device.group(&group_id)?;
    let (commit, welcome, _) = group.add_members(&device.provider, &device.signer()?, &packages).map_err(fail)?;
    group.merge_pending_commit(&device.provider).map_err(fail)?;
    device.commit_output(&group, commit, Some(welcome))
}

/// A commit with no proposals. It replaces this phone's own keys, which is what gives post-compromise security.
#[uniffi::export]
pub fn update_keys(state: Vec<u8>, group_id: Vec<u8>) -> Result<CommitOutput> {
    let device = Device::load(&state)?;
    let mut group = device.group(&group_id)?;
    let bundle = group.self_update(&device.provider, &device.signer()?, LeafNodeParameters::default()).map_err(fail)?;
    group.merge_pending_commit(&device.provider).map_err(fail)?;
    let (commit, _, _) = bundle.into_contents();
    device.commit_output(&group, commit, None)
}

/// Removes every phone a person has, for a leave, a ban, or a deleted account.
#[uniffi::export]
pub fn remove_user(state: Vec<u8>, group_id: Vec<u8>, user_id: String) -> Result<CommitOutput> {
    let device = Device::load(&state)?;
    let mut group = device.group(&group_id)?;
    let leaves: Vec<_> = group.members().filter(|member| identity_of(&member.credential).is_some_and(|(user, _)| user == user_id)).map(|member| member.index).collect();
    if leaves.is_empty() {
        return Err(fail("not in this group"));
    }
    let (commit, welcome, _) = group.remove_members(&device.provider, &device.signer()?, &leaves).map_err(fail)?;
    group.merge_pending_commit(&device.provider).map_err(fail)?;
    device.commit_output(&group, commit, welcome)
}

/// Joins a group by itself, from the server's latest GroupInfo, with an external commit. Nobody else
/// needs to be online. If this phone was already in the group but lost its state, OpenMLS removes the
/// old leaf in the same commit. Every member already in the group is checked first.
#[uniffi::export]
pub fn join_external(state: Vec<u8>, group_info: Vec<u8>, trusted: Vec<TrustedDevice>) -> Result<ExternalJoin> {
    let device = Device::load(&state)?;
    let MlsMessageBodyIn::GroupInfo(info) = read_message(&group_info)? else {
        return Err(fail("not a group info"));
    };
    let (group, bundle) = MlsGroup::external_commit_builder()
        .with_config(join_config())
        .build_group(&device.provider, info, device.credential())
        .map_err(fail)?
        .load_psks(device.provider.storage())
        .map_err(fail)?
        .build(device.provider.rand(), device.provider.crypto(), &device.signer()?, |_| true)
        .map_err(fail)?
        .finalize(&device.provider)
        .map_err(fail)?;
    for member in group.members() {
        check(&trusted, &member.credential, &member.signature_key)?;
    }
    let (commit, _, _) = bundle.into_messages();
    Ok(ExternalJoin {
        group_id: group.group_id().as_slice().to_vec(),
        commit: write_message(&commit)?,
        group_info: device.group_info(&group)?,
        state: device.save()?,
    })
}

/// Joins from a Welcome, after checking every member already in the group.
#[uniffi::export]
pub fn join_from_welcome(state: Vec<u8>, welcome: Vec<u8>, trusted: Vec<TrustedDevice>) -> Result<Joined> {
    let device = Device::load(&state)?;
    let MlsMessageBodyIn::Welcome(welcome) = read_message(&welcome)? else {
        return Err(fail("not a welcome"));
    };
    let staged = StagedWelcome::new_from_welcome(&device.provider, &join_config(), welcome, None).map_err(fail)?;
    for member in staged.members() {
        check(&trusted, &member.credential, &member.signature_key)?;
    }
    let group = staged.into_group(&device.provider).map_err(fail)?;
    let group_id = group.group_id().as_slice().to_vec();
    Ok(Joined { state: device.save()?, group_id })
}

/// Encrypts for the group. `aad` travels in the clear and is authenticated, which is where the report commitment goes.
#[uniffi::export]
pub fn encrypt(state: Vec<u8>, group_id: Vec<u8>, plaintext: Vec<u8>, aad: Vec<u8>) -> Result<Sent> {
    let device = Device::load(&state)?;
    let mut group = device.group(&group_id)?;
    group.set_aad(aad);
    let message = group.create_message(&device.provider, &device.signer()?, &plaintext).map_err(fail)?;
    Ok(Sent { state: device.save()?, message: write_message(&message)? })
}

/// Applies the next entry from the server's log. Each application message opens once.
#[uniffi::export]
pub fn receive(state: Vec<u8>, group_id: Vec<u8>, message: Vec<u8>, trusted: Vec<TrustedDevice>) -> Result<Received> {
    let device = Device::load(&state)?;
    let mut group = device.group(&group_id)?;
    let protocol = MlsMessageIn::tls_deserialize_exact(&message).map_err(fail)?.try_into_protocol_message().map_err(fail)?;
    let processed = group.process_message(&device.provider, protocol).map_err(fail)?;
    let aad = processed.aad().to_vec();
    let sender = identity_of(processed.credential()).ok_or(MlsError::UntrustedCredential)?;
    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(application) => Ok(Received::Application {
            state: device.save()?,
            plaintext: application.into_bytes(),
            aad,
            sender_user_id: sender.0,
            sender_device_id: sender.1,
        }),
        ProcessedMessageContent::StagedCommitMessage(staged) => {
            if let Some(leaf) = staged.update_path_leaf_node() {
                check_leaf(&trusted, leaf)?;
            }
            for proposal in staged.queued_proposals() {
                match proposal.proposal() {
                    Proposal::Add(add) => check_leaf(&trusted, add.key_package().leaf_node())?,
                    Proposal::Update(update) => check_leaf(&trusted, update.leaf_node())?,
                    Proposal::Remove(_) => {}
                    // Only valid in an external commit, where the joiner is the update path leaf checked above.
                    Proposal::ExternalInit(_) => {}
                    // Group extensions could add an external sender. Babillard never uses them, so refuse.
                    other => return Err(fail(format!("unsupported proposal {:?}", other.proposal_type()))),
                }
            }
            let removed_me = staged.self_removed();
            group.merge_staged_commit(&device.provider, *staged).map_err(fail)?;
            Ok(Received::Commit { state: device.save()?, removed_me })
        }
        // Proposals ride inside commits. The server refuses lone ones, so one arriving here is an error.
        _ => Err(fail("unexpected proposal")),
    }
}

/// The epoch and who is in the group. The security code is built from the roster.
#[uniffi::export]
pub fn group_status(state: Vec<u8>, group_id: Vec<u8>) -> Result<GroupStatus> {
    let device = Device::load(&state)?;
    let group = device.group(&group_id)?;
    let roster = group
        .members()
        .filter_map(|member| {
            let (user_id, device_id) = identity_of(&member.credential)?;
            Some(RosterEntry { leaf_index: member.index.u32(), user_id, device_id, signature_key: member.signature_key })
        })
        .collect();
    Ok(GroupStatus { epoch: group.epoch().as_u64(), roster })
}

#[cfg(test)]
mod tests;
