#!/usr/bin/env bash
# EAS build hook (`eas-build-pre-install` in package.json). EAS's Android builders have the
# Android SDK and NDK but not Rust, which modules/babillard-mls needs: Gradle runs its
# rust/build-android.sh before every build. This installs rustup, the toolchain pinned in
# rust-toolchain.toml with its Android targets, and cargo-ndk. It does nothing on iOS builds,
# and nothing that's already there.
set -euo pipefail

if [[ "${EAS_BUILD_PLATFORM:-android}" != "android" ]]; then
  exit 0
fi

export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null; then
  # No default toolchain: the pinned one comes from rust-toolchain.toml below.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi

rust="$(cd "$(dirname "$0")/../modules/babillard-mls/rust" && pwd)"
cd "$rust"
rustup toolchain install
rustup show active-toolchain

cargo_ndk="4.1.2"
if ! cargo ndk --version 2>/dev/null | grep -qF "$cargo_ndk"; then
  cargo install cargo-ndk --version "$cargo_ndk" --locked
fi
cargo ndk --version
