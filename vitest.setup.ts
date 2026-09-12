// Node has no fetch-and-instantiate path for this module and no script tags, so the
// rego wasm is preloaded here and exposed as globalThis.regoEval. In the browser,
// regoRuntime.ts loads it on its own.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import './public/wasm_exec.js';

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

const g = globalThis as unknown as {
  Go: new () => GoRuntime;
  regoEval?: (...args: unknown[]) => string;
};

const wasmPath = fileURLToPath(new URL('./public/rego.wasm', import.meta.url));

const go = new g.Go();
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), go.importObject);
void go.run(instance);

for (let i = 0; i < 200 && typeof g.regoEval !== 'function'; i++) {
  await new Promise((r) => setTimeout(r, 10));
}
if (typeof g.regoEval !== 'function') {
  throw new Error('failed to preload the rego wasm module');
}
