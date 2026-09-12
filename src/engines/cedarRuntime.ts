// Cedar's browser bundle is wasm-bindgen's `web` target, which must be initialized
// explicitly before any exported function is called. The package's default entry
// instead relies on a top-level await injected by the bundler, which does not survive
// the production build, so initialization is done here and awaited in prepare().
//
// Under vitest this module id is aliased to the `nodejs` build, which initializes
// itself on import and therefore exposes no init function.
import initCedar, * as cedar from '@cedar-policy/cedar-wasm/web';

let loading: Promise<void> | null = null;

export async function ensureCedarLoaded(): Promise<void> {
  if (typeof initCedar !== 'function') return; // nodejs build: already initialized
  // Caching the promise avoids a second fetch, but caching a *rejected* one would
  // make the first failure permanent: every later call would replay the same error
  // and no retry could ever succeed. Drop it on failure so a retry re-initializes.
  if (!loading) {
    loading = initCedar()
      .then(() => undefined)
      .catch((err: unknown) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

export { cedar };
