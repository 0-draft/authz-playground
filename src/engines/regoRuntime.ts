// Lazily loads the js/wasm build of OPA (the Rego compiler and evaluator).
// It is around 8 MB gzipped, so it is not fetched until Rego is actually needed.

declare global {
  // Loaded from wasm_exec.js at runtime, so it is genuinely absent until then. Typing
  // it as always present made the guard in ensureRegoLoaded look like dead code.
  var Go:
    | (new () => {
        importObject: WebAssembly.Imports;
        run(i: WebAssembly.Instance): Promise<void>;
      })
    | undefined;
  var regoEval:
    | ((policy: string, query: string, input: string, data: string, trace: boolean) => string)
    | undefined;
}

export interface RegoEvalResult {
  ok: boolean;
  defined: boolean;
  value?: unknown;
  error?: string;
  trace?: string[];
}

let loading: Promise<void> | null = null;

/** How long the Go runtime is given to register its exports before it counts as dead. */
const INIT_TIMEOUT_MS = 30_000;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/** If the caller loaded the wasm itself (the Node tests, for example), use that. */
export function isRegoLoaded(): boolean {
  return typeof globalThis.regoEval === 'function';
}

export async function ensureRegoLoaded(baseUrl = import.meta.env?.BASE_URL ?? './'): Promise<void> {
  if (isRegoLoaded()) return;
  if (loading) return loading;

  // As with Cedar: a cached rejection would make the first failure permanent.
  const attempt = (async () => {
    if (typeof document === 'undefined') {
      throw new Error('outside a browser the caller must preload the rego wasm module');
    }
    if (typeof globalThis.Go === 'undefined') {
      await loadScript(`${baseUrl}wasm_exec.js`);
    }
    const go = new globalThis.Go!();
    const response = await fetch(`${baseUrl}rego.wasm`);
    if (!response.ok) {
      throw new Error(`fetching the rego wasm module failed with ${response.status}`);
    }
    // instantiateStreaming rejects unless the response is application/wasm, and plenty
    // of static hosts serve .wasm as application/octet-stream. Fall back rather than
    // losing the engine to a header.
    const { instance } = response.headers.get('content-type')?.includes('application/wasm')
      ? await WebAssembly.instantiateStreaming(response, go.importObject)
      : await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
    void go.run(instance); // it parks on select{}, so it is never awaited

    // Wait for main() to register its functions on globalThis. This took 108ms on the
    // machine it was written on, but the budget is generous on purpose: a phone that is
    // merely slow must not have a correctly initialising module declared dead.
    const deadline = performance.now() + INIT_TIMEOUT_MS;
    while (!isRegoLoaded() && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!isRegoLoaded()) {
      throw new Error(
        `the rego wasm module did not finish initializing within ${INIT_TIMEOUT_MS / 1000}s`,
      );
    }
  })();

  loading = attempt.catch((err: unknown) => {
    loading = null;
    throw err;
  });

  return loading;
}

export function evalRego(
  policy: string,
  query: string,
  input: unknown,
  data: unknown = {},
  trace = false,
): RegoEvalResult {
  if (!globalThis.regoEval) throw new Error('the rego wasm module is not loaded');
  return JSON.parse(
    globalThis.regoEval(policy, query, JSON.stringify(input), JSON.stringify(data), trace),
  );
}
