// Casbin's internal IP utilities reference Node's Buffer. This runs as its own
// module script, loaded before main.tsx, so the global exists before Casbin initializes.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}
