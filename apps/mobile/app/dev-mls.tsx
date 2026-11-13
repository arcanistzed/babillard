import type { DemoResult } from "@babillard/shared/mls";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
  if (!MLS_PROTOTYPE) return <Redirect href="/" />;

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16 },
  section: { gap: 6 },
});
