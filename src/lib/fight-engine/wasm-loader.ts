// Browser-only half of the WASM sim: fetching and compiling the binary.
// Split from wasm.ts so that file stays importable under plain Node (the
// parity test), which has no `?url` imports.
//
// no-inline for the same reason as the audio worklet: inlined as a data:
// URL the fetch would be refused by the deployed CSP (connect-src 'self').
import wasmUrl from './fight-sim.wasm?url&no-inline';

export { instantiateSim } from './wasm.ts';

export async function loadSimModule(): Promise<WebAssembly.Module> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`fight-sim.wasm: HTTP ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
}
