#!/usr/bin/env bash
# Builds the Rust library for Android and generates its Kotlin bindings.
# Gradle runs this before every build. Usage: build-android.sh [abi,abi,...]
# Needs rustup (it reads rust-toolchain.toml), cargo-ndk 4, and the Android NDK.
set -euo pipefail

# rustup installs here, and a build started from Gradle or an EAS hook may not have it on PATH.
export PATH="$HOME/.cargo/bin:$PATH"

here="$(cd "$(dirname "$0")" && pwd)"
android="$here/../android/src/main"
abis="${1:-armeabi-v7a,arm64-v8a,x86,x86_64}"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  ANDROID_NDK_HOME="$(find "$sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  export ANDROID_NDK_HOME
fi

targets=()
IFS=',' read -ra requested <<< "$abis"
for abi in "${requested[@]}"; do
  case "$abi" in
    arm64-v8a | armeabi-v7a | x86_64 | x86) targets+=(-t "$abi") ;;
    *) echo "babillard-mls: unknown ABI $abi" >&2; exit 1 ;;
  esac
done

cd "$here"
cargo ndk "${targets[@]}" --platform 24 -o "$android/jniLibs" build --release

# The bindings come from an unstripped host build, which still carries uniffi's metadata.
cargo build --lib --quiet
cargo run --quiet --features bindgen --bin uniffi-bindgen -- generate \
  --library "${CARGO_TARGET_DIR:-$here/target}/debug/libbabillard_mls.so" \
  --language kotlin --out-dir "$android/java" --no-format
