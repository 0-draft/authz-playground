// An independent restatement of the requirements, used only by the tests.
//
// The differential harness proves the engines agree with *each other*. That is not the
// same as proving them right: a misreading shared by every engine is invisible to it.
// This function is written straight from the requirement text, without reference to any
// engine adapter, so it can disagree with all four at once.
//
// It deliberately lives outside src/engines so that it stays a second opinion rather
// than a fifth projection.
import type { AccessRequest, Decision, Scenario } from './scenario';

const OPENS = 9;
const CLOSES = 18;

export function expectedDecision(
  scenario: Scenario,
  requirements: readonly string[],
  req: AccessRequest,
): Decision {
  const has = (r: string) => requirements.includes(r);
  const doc = scenario.documents[req.resource];
  if (!doc) return 'deny';

  switch (req.action) {
    case 'edit': {
      // R1: the owner may edit. R2: so may an admin of the containing folder.
      const isOwner = has('R1') && doc.owner === req.subject;
      const isFolderAdmin =
        has('R2') && (scenario.folders[doc.folder]?.admins.includes(req.subject) ?? false);
      if (!isOwner && !isFolderAdmin) return 'deny';

      // R3: and only during business hours.
      if (has('R3') && (req.context.hour < OPENS || req.context.hour >= CLOSES)) return 'deny';
      return 'allow';
    }

    // R4: anyone may view a public document. Nothing grants viewing otherwise.
    case 'view':
      return has('R4') && doc.isPublic ? 'allow' : 'deny';

    // No requirement grants deletion, so every engine must deny it.
    default:
      return 'deny';
  }
}
