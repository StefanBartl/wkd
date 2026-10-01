// The Rust/WebAssembly build of step() (wasm/fight-sim), behind the same
// shape as the TypeScript one. The state lives in the module's linear
// memory; the Int32Array handed back is a view of it, so everything that
// reads or writes sim state from JS -- the AI, the renderer, hashState --
// works on it unchanged.
import { type SimState, STATE_LEN } from './sim.ts';

export interface WasmSim {
  readonly state: SimState;
  step(input0: number, input1: number): number;
}

interface SimExports {
  readonly memory: WebAssembly.Memory;
  state_ptr(): number;
  state_len(): number;
  step(input0: number, input1: number): number;
}

/**
 * The module keeps exactly one state, so every match gets its own instance
 * (instantiating an already compiled 2 KB module is cheap).
 */
export function instantiateSim(module: WebAssembly.Module, initial: SimState): WasmSim {
  const exports = new WebAssembly.Instance(module, {}).exports as unknown as SimExports;
  if (exports.state_len() !== STATE_LEN) throw new Error('fight-sim.wasm: state layout mismatch');
  // The module never grows its memory, so this view stays valid.
  const state = new Int32Array(exports.memory.buffer, exports.state_ptr(), STATE_LEN);
  state.set(initial);
  return { state, step: exports.step };
}
