use super::*;

struct Phone {
    user: &'static str,
    state: Vec<u8>,
    key_package: Vec<u8>,
    signature_key: Vec<u8>,
}

fn phone(user: &'static str) -> Phone {
    let identity = create_identity(user.into(), format!("{user}-phone")).unwrap();
    Phone { user, state: identity.state, key_package: identity.key_package, signature_key: identity.signature_key }
}

impl Phone {
    fn trusted(&self) -> TrustedDevice {
        TrustedDevice { user_id: self.user.into(), device_id: format!("{}-phone", self.user), signature_key: self.signature_key.clone() }
    }
}

fn trust(phones: &[&Phone]) -> Vec<TrustedDevice> {
    phones.iter().map(|phone| phone.trusted()).collect()
}

const GROUP: &[u8] = b"chat-1";

/// Alice starts the group and adds the others. Returns the add commit.
fn form(alice: &mut Phone, others: &mut [&mut Phone], trusted: &[TrustedDevice]) -> Vec<u8> {
    alice.state = create_group(alice.state.clone(), GROUP.to_vec()).unwrap();
    let packages = others.iter().map(|phone| phone.key_package.clone()).collect();
    let output = add_members(alice.state.clone(), GROUP.to_vec(), packages, trusted.to_vec()).unwrap();
    alice.state = output.state;
    for phone in others.iter_mut() {
        let joined = join_from_welcome(phone.state.clone(), output.welcome.clone().unwrap(), trusted.to_vec()).unwrap();
        assert_eq!(joined.group_id, GROUP);
        phone.state = joined.state;
    }
    output.commit
}

fn send(phone: &mut Phone, text: &str) -> Vec<u8> {
    let sent = encrypt(phone.state.clone(), GROUP.to_vec(), text.as_bytes().to_vec(), b"commitment".to_vec()).unwrap();
    phone.state = sent.state;
    sent.message
}

fn read(phone: &mut Phone, message: &[u8], trusted: &[TrustedDevice]) -> Result<Received> {
    let received = receive(phone.state.clone(), GROUP.to_vec(), message.to_vec(), trusted.to_vec())?;
    phone.state = match &received {
        Received::Application { state, .. } | Received::Commit { state, .. } => state.clone(),
    };
    Ok(received)
}

fn text(received: Received) -> (String, String) {
    match received {
        Received::Application { plaintext, sender_user_id, aad, .. } => {
            assert_eq!(aad, b"commitment");
            (String::from_utf8(plaintext).unwrap(), sender_user_id)
        }
        Received::Commit { .. } => panic!("expected a message"),
    }
}

fn roster_of(phone: &Phone) -> Vec<(u32, String)> {
    group_status(phone.state.clone(), GROUP.to_vec()).unwrap().roster.into_iter().map(|entry| (entry.leaf_index, entry.user_id)).collect()
}

#[test]
fn two_phones_trade_messages() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);

    let hello = send(&mut alice, "Hi Bob, see you Thursday?");
    assert_eq!(text(read(&mut bob, &hello, &trusted).unwrap()), ("Hi Bob, see you Thursday?".into(), "alice".into()));
    let reply = send(&mut bob, "Yes, at the library.");
    assert_eq!(text(read(&mut alice, &reply, &trusted).unwrap()), ("Yes, at the library.".into(), "bob".into()));
    assert_eq!(roster_of(&alice), roster_of(&bob));
}

#[test]
fn state_survives_a_round_trip() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);
    let saved = Device::load(&bob.state).unwrap().save().unwrap();
    assert_eq!(saved, bob.state);
    assert!(Device::load(&bob.state[..bob.state.len() - 1]).is_err());
}

#[test]
fn each_message_opens_once() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);
    let message = send(&mut alice, "only once");
    read(&mut bob, &message, &trusted).unwrap();
    assert!(read(&mut bob, &message, &trusted).is_err());
}

#[test]
fn a_failed_call_leaves_the_old_state_usable() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);
    assert!(read(&mut bob, b"not an MLS message", &trusted).is_err());
    let message = send(&mut alice, "still fine");
    assert_eq!(text(read(&mut bob, &message, &trusted).unwrap()).0, "still fine");
}

#[test]
fn a_removed_phone_cannot_read_what_follows() {
    let (mut alice, mut bob, mut carol) = (phone("alice"), phone("bob"), phone("carol"));
    let trusted = trust(&[&alice, &bob, &carol]);
    form(&mut alice, &mut [&mut bob, &mut carol], &trusted);
    let carol_before = carol.state.clone();

    let removal = remove_user(alice.state.clone(), GROUP.to_vec(), "carol".into()).unwrap();
    alice.state = removal.state;
    let after = send(&mut alice, "after Carol left");

    read(&mut bob, &removal.commit, &trusted).unwrap();
    assert_eq!(text(read(&mut bob, &after, &trusted).unwrap()).0, "after Carol left");

    // Carol's phone applies its own removal, as an honest phone would, and still can't read on.
    assert!(matches!(read(&mut carol, &removal.commit, &trusted).unwrap(), Received::Commit { removed_me: true, .. }));
    assert!(read(&mut carol, &after, &trusted).is_err());
    // A phone that skipped the removal is an epoch behind and can't either.
    carol.state = carol_before;
    assert!(read(&mut carol, &after, &trusted).is_err());
}

#[test]
fn the_committer_refuses_a_key_the_server_did_not_vouch_for() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    alice.state = create_group(alice.state.clone(), GROUP.to_vec()).unwrap();
    // A different key, presented under Bob's name.
    let impostor = create_identity("bob".into(), "bob-phone".into()).unwrap();
    let result = add_members(alice.state.clone(), GROUP.to_vec(), vec![impostor.key_package], trusted.clone());
    assert!(matches!(result, Err(MlsError::UntrustedCredential)));
    assert!(add_members(alice.state.clone(), GROUP.to_vec(), vec![bob.key_package.clone()], trusted).is_ok());
    bob.state.clear();
}

#[test]
fn other_members_refuse_an_add_they_cannot_vouch_for() {
    let (mut alice, mut bob, carol) = (phone("alice"), phone("bob"), phone("carol"));
    let everyone = trust(&[&alice, &bob, &carol]);
    form(&mut alice, &mut [&mut bob], &everyone);

    let output = add_members(alice.state.clone(), GROUP.to_vec(), vec![carol.key_package.clone()], everyone.clone()).unwrap();
    // Bob's list is missing Carol.
    let bobs_view = trust(&[&alice, &bob]);
    assert!(matches!(read(&mut bob, &output.commit, &bobs_view), Err(MlsError::UntrustedCredential)));
}

#[test]
fn a_new_phone_refuses_a_group_with_someone_it_cannot_vouch_for() {
    let (mut alice, mut bob, dave) = (phone("alice"), phone("bob"), phone("dave"));
    let everyone = trust(&[&alice, &bob, &dave]);
    form(&mut alice, &mut [&mut bob], &everyone);

    let output = add_members(alice.state.clone(), GROUP.to_vec(), vec![dave.key_package.clone()], everyone).unwrap();
    // Dave's list is missing Bob.
    let daves_view = trust(&[&alice, &dave]);
    let result = join_from_welcome(dave.state.clone(), output.welcome.unwrap(), daves_view);
    assert!(matches!(result, Err(MlsError::UntrustedCredential)));
}

#[test]
fn the_losing_commit_is_dropped_and_retried() {
    let (mut alice, mut bob, carol, dave) = (phone("alice"), phone("bob"), phone("carol"), phone("dave"));
    let trusted = trust(&[&alice, &bob, &carol, &dave]);
    form(&mut alice, &mut [&mut bob], &trusted);

    // Both commit from the same epoch. The server takes Alice's and refuses Bob's.
    let from_alice = add_members(alice.state.clone(), GROUP.to_vec(), vec![carol.key_package.clone()], trusted.clone()).unwrap();
    let from_bob = add_members(bob.state.clone(), GROUP.to_vec(), vec![dave.key_package.clone()], trusted.clone()).unwrap();
    alice.state = from_alice.state;
    drop(from_bob);

    // Bob still has his old state, applies Alice's commit, and commits again.
    read(&mut bob, &from_alice.commit, &trusted).unwrap();
    let retry = add_members(bob.state.clone(), GROUP.to_vec(), vec![dave.key_package.clone()], trusted.clone()).unwrap();
    bob.state = retry.state;
    read(&mut alice, &retry.commit, &trusted).unwrap();

    assert_eq!(roster_of(&alice), roster_of(&bob));
    assert_eq!(roster_of(&alice).len(), 4);
    assert_eq!(group_status(alice.state.clone(), GROUP.to_vec()).unwrap().epoch, 3);
}

#[test]
fn updating_keys_moves_the_epoch_and_keeps_the_roster() {
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);
    let before = roster_of(&alice);

    let update = update_keys(bob.state.clone(), GROUP.to_vec()).unwrap();
    bob.state = update.state;
    read(&mut alice, &update.commit, &trusted).unwrap();
    assert_eq!(group_status(alice.state.clone(), GROUP.to_vec()).unwrap().epoch, 2);
    assert_eq!(roster_of(&alice), before);
}

#[test]
fn identities_reject_ids_with_slashes() {
    assert!(create_identity("a/b".into(), "phone".into()).is_err());
    assert!(create_identity("alice".into(), "".into()).is_err());
}

#[test]
fn messages_from_a_past_epoch_are_refused() {
    // OpenMLS keeps no past-epoch secrets by default. The server only accepts current-epoch messages, so nothing needs them.
    let (mut alice, mut bob) = (phone("alice"), phone("bob"));
    let trusted = trust(&[&alice, &bob]);
    form(&mut alice, &mut [&mut bob], &trusted);
    let late = send(&mut alice, "sent before the update");
    let update = update_keys(alice.state.clone(), GROUP.to_vec()).unwrap();
    alice.state = update.state;
    read(&mut bob, &update.commit, &trusted).unwrap();
    assert!(read(&mut bob, &late, &trusted).is_err());
}

#[test]
fn the_library_reports_its_version() {
    assert!(library_version().contains("openmls 0.9.2"));
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn roster_json(phone: &Phone) -> String {
    let entries: Vec<String> = group_status(phone.state.clone(), GROUP.to_vec())
        .unwrap()
        .roster
        .into_iter()
        .map(|e| format!(r#"{{"leafIndex":{},"userId":"{}","deviceId":"{}"}}"#, e.leaf_index, e.user_id, e.device_id))
        .collect();
    format!("[{}]", entries.join(","))
}

fn fixture_step(steps: &mut Vec<String>, sender: &str, epoch: u64, kind: &str, message: &[u8], welcome: Option<&[u8]>, roster: String) {
    let welcome = welcome.map(|w| format!(r#","welcome":"{}""#, hex(w))).unwrap_or_default();
    steps.push(format!(r#"{{"sender":"{sender}","epoch":{epoch},"kind":"{kind}","message":"{}"{welcome},"roster":{roster}}}"#, hex(message)));
}

/// Writes real OpenMLS messages for the TypeScript server tests, when BABILLARD_MLS_FIXTURE names a file.
/// The steps cover leaf reuse: Carol leaves leaf 2 empty, and Dave should take it.
#[test]
fn server_fixture() {
    let (mut alice, mut bob, mut carol, mut dave) = (phone("alice"), phone("bob"), phone("carol"), phone("dave"));
    let trusted = trust(&[&alice, &bob, &carol, &dave]);
    let mut steps: Vec<String> = Vec::new();

    // The first commit adds Bob and Carol. OpenMLS forces an update path, which the server requires.
    alice.state = create_group(alice.state.clone(), GROUP.to_vec()).unwrap();
    let first = add_members(alice.state.clone(), GROUP.to_vec(), vec![bob.key_package.clone(), carol.key_package.clone()], trusted.clone()).unwrap();
    alice.state = first.state;
    for joiner in [&mut bob, &mut carol] {
        joiner.state = join_from_welcome(joiner.state.clone(), first.welcome.clone().unwrap(), trusted.clone()).unwrap().state;
    }
    fixture_step(&mut steps, "alice", 0, "commit", &first.commit, first.welcome.as_deref(), roster_json(&alice));

    let removal = remove_user(alice.state.clone(), GROUP.to_vec(), "carol".into()).unwrap();
    alice.state = removal.state;
    read(&mut bob, &removal.commit, &trusted).unwrap();
    fixture_step(&mut steps, "alice", 1, "commit", &removal.commit, None, roster_json(&alice));

    let add = add_members(alice.state.clone(), GROUP.to_vec(), vec![dave.key_package.clone()], trusted.clone()).unwrap();
    alice.state = add.state;
    read(&mut bob, &add.commit, &trusted).unwrap();
    dave.state = join_from_welcome(dave.state.clone(), add.welcome.clone().unwrap(), trusted.clone()).unwrap().state;
    fixture_step(&mut steps, "alice", 2, "commit", &add.commit, add.welcome.as_deref(), roster_json(&alice));

    let update = update_keys(bob.state.clone(), GROUP.to_vec()).unwrap();
    bob.state = update.state;
    read(&mut alice, &update.commit, &trusted).unwrap();
    read(&mut dave, &update.commit, &trusted).unwrap();
    fixture_step(&mut steps, "bob", 3, "commit", &update.commit, None, roster_json(&bob));

    let sent = encrypt(alice.state.clone(), GROUP.to_vec(), b"hello".to_vec(), Vec::new()).unwrap();
    alice.state = sent.state;
    match read(&mut dave, &sent.message, &trusted).unwrap() {
        Received::Application { plaintext, .. } => assert_eq!(plaintext, b"hello"),
        Received::Commit { .. } => panic!("expected a message"),
    }
    fixture_step(&mut steps, "alice", 4, "application", &sent.message, None, roster_json(&alice));

    let Ok(path) = std::env::var("BABILLARD_MLS_FIXTURE") else { return };
    let devices: Vec<String> = [&alice, &bob, &carol, &dave]
        .iter()
        .map(|p| format!(r#"{{"userId":"{}","deviceId":"{}-phone","signatureKey":"{}","keyPackage":"{}"}}"#, p.user, p.user, hex(&p.signature_key), hex(&p.key_package)))
        .collect();
    let group = String::from_utf8(GROUP.to_vec()).unwrap();
    let json = format!(r#"{{"groupId":"{group}","devices":[{}],"steps":[{}]}}"#, devices.join(","), steps.join(","));
    std::fs::write(path, json + "\n").unwrap();
}
