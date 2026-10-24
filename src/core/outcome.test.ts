import { describe, expect, it } from 'vitest';
import { deriveOutcome, rowKey } from './outcome';
import type { Decision } from './scenario';

const A: Decision = 'allow';
const D: Decision = 'deny';

describe('deriving one stage’s comparison', () => {
  const rows = {
    [rowKey(3, 'cedar')]: [A, D, D],
    [rowKey(3, 'rego')]: [A, D, D],
    [rowKey(3, 'rebac')]: [A, A, D],
  };

  it('says nothing until every compared engine has a row', () => {
    expect(deriveOutcome(rows, 3, ['cedar', 'rego', 'rebac', 'casbin'])).toBeNull();
    expect(deriveOutcome(rows, 3, [])).toBeNull();
  });

  it('settles once a failed engine is left out, instead of waiting for it forever', () => {
    // Casbin failed and will never produce a row. Leaving it in the list kept the page
    // at "evaluating" for good; the caller drops it and the comparison completes.
    const o = deriveOutcome(rows, 3, ['cedar', 'rego', 'rebac']);
    expect(o).not.toBeNull();
    expect(o!.clash).toEqual([false, true, false]);
    expect(o!.minority).toEqual([[], ['rebac'], []]);
    expect(o!.breaks).toEqual({ cedar: 0, rego: 0, rebac: 1 });
  });

  it('charges nobody a break on an even split', () => {
    const even = { [rowKey(1, 'a')]: [A], [rowKey(1, 'b')]: [D] };
    const o = deriveOutcome(even, 1, ['a', 'b'])!;
    expect(o.clash).toEqual([true]);
    expect(o.minority).toEqual([[]]);
    expect(o.breaks).toEqual({ a: 0, b: 0 });
  });
});
