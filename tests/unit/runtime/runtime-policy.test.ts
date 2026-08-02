import { afterEach, describe, expect, it } from 'vitest';
import { createInvestigationModel } from '../../../src/agent/model-factory';
import { DeterministicTestModel } from '../../../src/agent/model-test';
import { getRuntimePolicy } from '../../../src/runtime/runtime-policy';

const original = {
  JUDGE_MODE: process.env.JUDGE_MODE,
  ALLOW_DEMO_FALLBACK: process.env.ALLOW_DEMO_FALLBACK,
  REQUIRE_LIVE_MODEL: process.env.REQUIRE_LIVE_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
};

function setEnv(key: keyof typeof original, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    setEnv(key as keyof typeof original, value);
  }
});

describe('runtime policy', () => {
  it('uses strict true values and judge mode always disables demo fallback', () => {
    setEnv('JUDGE_MODE', 'true');
    setEnv('ALLOW_DEMO_FALLBACK', 'true');
    setEnv('REQUIRE_LIVE_MODEL', 'TRUE');

    expect(getRuntimePolicy()).toEqual({
      judgeMode: true,
      allowDemoFallback: false,
      requireLiveModel: false
    });
  });

  it('keeps demo fallback available only outside judge mode', () => {
    setEnv('JUDGE_MODE', 'false');
    setEnv('ALLOW_DEMO_FALLBACK', 'true');
    expect(getRuntimePolicy().allowDemoFallback).toBe(true);
  });
});

describe('investigation model factory', () => {
  it('fails explicitly when a live model is required but no key exists', () => {
    setEnv('ANTHROPIC_API_KEY', undefined);
    expect(() => createInvestigationModel({ judgeMode: true, allowDemoFallback: false, requireLiveModel: true })).toThrow(
      'ANTHROPIC_API_KEY is required because live model mode is enabled.'
    );
  });

  it('selects an explicitly labelled deterministic narrator when live model is optional', () => {
    setEnv('ANTHROPIC_API_KEY', undefined);
    const selection = createInvestigationModel({ judgeMode: false, allowDemoFallback: true, requireLiveModel: false });
    expect(selection.model).toBeInstanceOf(DeterministicTestModel);
    expect(selection.modelSource).toBe('DETERMINISTIC_TEMPLATE');
  });
});
