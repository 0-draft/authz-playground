// Lazily loads the js/wasm build of OPA (the Rego compiler and evaluator).
// It is around 8 MB gzipped, so it is not fetched until Rego is actually needed.

declare global {
  var Go: new () => {
    importObject: WebAssembly.Imports;
    run(i: WebAssembly.Instance): Promise<void>;
  };
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
    const go = new globalThis.Go();
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(`${baseUrl}rego.wasm`),
      go.importObject,
    );
    void go.run(instance); // it parks on select{}, so it is never awaited

    // wait for main() to register its functions on globalThis
    for (let i = 0; i < 200 && !isRegoLoaded(); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!isRegoLoaded()) throw new Error('the rego wasm module failed to initialize');
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
