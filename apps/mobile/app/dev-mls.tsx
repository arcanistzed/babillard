import type { DemoResult } from "@babillard/shared/mls";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { EngineDemoResult } from "@babillard/shared";
import { runEngineOnPhone } from "@/mls/engineDemo";
import { nativeMlsAvailable, runNativeDemo, type NativeDemoResult } from "@/mlsNative";
import { MLS_PROTOTYPE, describeRuntime, runDemo } from "@/mlsPrototype";
import { Button, ErrorText, T } from "@/ui";

/**
 * Developer-only check that MLS runs in Hermes: two phones' worth of state in
 * one process, talking through an in-memory server. Not translated, and not
 * reachable unless EXPO_PUBLIC_MLS_PROTOTYPE=1.
 */
export default function MlsPrototype() {
  const [runtime] = useState(describeRuntime);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ demo: DemoResult; totalMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState<{ demo: NativeDemoResult; totalMs: number } | null>(null);
  const [engine, setEngine] = useState<{ demo: EngineDemoResult; totalMs: number } | null>(null);
  if (!MLS_PROTOTYPE) return <Redirect href="/" />;

  async function runEngine() {
    setBusy(true);
    setError(null);
    setEngine(null);
    const start = performance.now();
    try {
      const demo = await runEngineOnPhone();
      setEngine({ demo, totalMs: Math.round(performance.now() - start) });
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runNative() {
    setBusy(true);
    setError(null);
    setNative(null);
    const start = performance.now();
    try {
      const demo = await runNativeDemo();
      setNative({ demo, totalMs: Math.round(performance.now() - start) });
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const start = performance.now();
    try {
      const demo = await runDemo();
      setResult({ demo, totalMs: Math.round(performance.now() - start) });
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const passed = result && result.demo.bobInbox.length === 1 && result.demo.aliceInbox.length === 1 && result.demo.aliceCode === result.demo.bobCode;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <T variant="title">MLS prototype</T>
      <T testID="mls-runtime">
        Hermes: {String(runtime.hermes)}. crypto.getRandomValues: {String(runtime.getRandomValues)}. crypto.subtle: {String(runtime.subtle)}.
      </T>
      <Button testID="mls-run" label="Run two-member demo" onPress={run} busy={busy} disabled={busy} />
      <Button
        testID="mls-run-native"
        label={nativeMlsAvailable ? "Run OpenMLS demo" : "OpenMLS isn't in this build"}
        kind="secondary"
        onPress={runNative}
        disabled={busy || !nativeMlsAvailable}
      />
      <Button testID="mls-run-engine" label="Run sync engine demo" kind="secondary" onPress={runEngine} disabled={busy || !nativeMlsAvailable} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {result ? (
        <View style={styles.section} testID="mls-result">
          <T variant="heading">{passed ? "Passed" : "Failed"}</T>
          <T>Bob read: {result.demo.bobInbox.join(" | ")}</T>
          <T>Alice read: {result.demo.aliceInbox.join(" | ")}</T>
          <T>Alice's code: {result.demo.aliceCode}</T>
          <T>Bob's code: {result.demo.bobCode}</T>
          <T>Saved group state: {result.demo.stateBytes} bytes</T>
          {result.demo.steps.map((step) => (
            <T key={step.label} variant="small">
              {step.label}: {step.ms} ms
            </T>
          ))}
          <T variant="bodyBold">Total: {result.totalMs} ms</T>
        </View>
      ) : null}
      {native ? (
        <View style={styles.section} testID="mls-native-result">
          <T variant="heading">
            {native.demo.bobInbox.length === 3 && native.demo.aliceInbox.length === 2 && native.demo.carolInbox.length === 1 && new Set(Object.values(native.demo.codes)).size === 1 ? "OpenMLS passed" : "OpenMLS failed"}
          </T>
          <T>Bob read: {native.demo.bobInbox.join(" | ")}</T>
          <T>Alice read: {native.demo.aliceInbox.join(" | ")}</T>
          <T>Carol (ts-mls) read: {native.demo.carolInbox.join(" | ")}</T>
          <T>Codes: {native.demo.codes.alice} / {native.demo.codes.bob} / {native.demo.codes.carol}</T>
          <T>Server epoch: {native.demo.serverEpoch}. Alice's state: {native.demo.stateBytes} bytes</T>
          {native.demo.steps.map((step) => (
            <T key={step.label} variant="small">
              {step.label}: {step.ms} ms
            </T>
          ))}
          <T variant="bodyBold">Total: {native.totalMs} ms</T>
        </View>
      ) : null}
      {engine ? (
        <View style={styles.section} testID="mls-engine-result">
          <T variant="heading">
            {engine.demo.read.bob.length === 1 && engine.demo.read.carol.length === 1 && engine.demo.read.alice.length === 1 && engine.demo.rosterAfterLeave === 2 && engine.demo.codes[0] === engine.demo.codes[1] && engine.demo.codes[0] !== ""
              ? "Engine passed"
              : "Engine failed"}
          </T>
          <T>Bob read: {engine.demo.read.bob.join(" | ")}</T>
          <T>Carol read: {engine.demo.read.carol.join(" | ")}</T>
          <T>Alice read: {engine.demo.read.alice.join(" | ")}</T>
          <T>Group after Carol left: {engine.demo.rosterAfterLeave} phones. Codes: {engine.demo.codes.join(" / ")}</T>
          {engine.demo.steps.map((step) => (
            <T key={step.label} variant="small">
              {step.label}: {step.ms} ms
            </T>
          ))}
          <T variant="bodyBold">Total: {engine.totalMs} ms</T>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  section: { gap: 6 },
});
