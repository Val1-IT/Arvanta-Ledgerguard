import { describe, expect, it } from 'vitest';
import { agentQuickstart } from '../../examples/custom-action/src/agent-quickstart';

describe('agent quickstart example', () => {
  it('requires approval, executes once with a key, then denies the retry', async () => {
    expect(await agentQuickstart()).toEqual({ beforeApproval: 'REQUIRE_APPROVAL', afterApproval: 'ALLOW', execution: 'VERIFIED', retry: 'DENY' });
  });
});
