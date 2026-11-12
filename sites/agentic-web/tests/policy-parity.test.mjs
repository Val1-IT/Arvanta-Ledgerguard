// Compares the browser policy port with @ledgerguard/policy on shared fixtures.
import assert from "node:assert/strict";
import test from "node:test";
import {
  Capability,
  assertTrustedApprover,
  evaluateExecutionPolicy,
  trustedRuntimeAuthority,
} from "@ledgerguard/policy";
import * as browser from "../policy-engine.js";

const issuedAt = "2026-03-02T14:15:00.000Z";

function authority(overrides = {}) {
  return trustedRuntimeAuthority({
    actorId: "ledgerguard-runtime",
    actorType: "system",
    capabilities: [Capability.remediationExecute],
    issuedAt,
    ...overrides,
  });
}

function comparable(decision) {
  const copy = structuredClone(decision);
  delete copy.id;
  delete copy.decidedAt;
  return copy;
}

const cases = [
  {
    name: "approved plan with evidence and verification is ALLOW",
    ctx: {
      evidenceCount: 2,
      verificationExpectationCount: 2,
      impactAmount: 850000,
      authority: authority(),
      plan: { state: "APPROVED", version: 2, approvalAction: "APPROVE", approvedBy: "demo-operator" },
      expectedVersion: 2,
      config: { financialApprovalThreshold: 100000, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "ALLOW",
  },
  {
    name: "unapproved plan requires approval and flags the impact threshold",
    ctx: {
      evidenceCount: 2,
      verificationExpectationCount: 2,
      impactAmount: 850000,
      authority: authority(),
      plan: { state: "PROPOSED", version: 2, approvalAction: null, approvedBy: null },
      expectedVersion: 2,
      config: { financialApprovalThreshold: 100000, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "REQUIRE_APPROVAL",
  },
  {
    name: "missing evidence is DENY",
    ctx: {
      evidenceCount: 0,
      verificationExpectationCount: 1,
      impactAmount: 1000,
      authority: authority(),
      plan: { state: "PROPOSED", version: 1, approvalAction: null, approvedBy: null },
      expectedVersion: 1,
      config: { financialApprovalThreshold: 100000, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "DENY",
  },
  {
    name: "missing verification is DENY",
    ctx: {
      evidenceCount: 1,
      verificationExpectationCount: 0,
      impactAmount: 1000,
      authority: authority(),
      plan: { state: "PROPOSED", version: 1, approvalAction: null, approvedBy: null },
      expectedVersion: 1,
      config: { financialApprovalThreshold: null, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "DENY",
  },
  {
    name: "stale plan version is DENY",
    ctx: {
      evidenceCount: 2,
      verificationExpectationCount: 2,
      impactAmount: 10,
      authority: authority(),
      plan: { state: "APPROVED", version: 2, approvalAction: "APPROVE", approvedBy: "demo-operator" },
      expectedVersion: 1,
      config: { financialApprovalThreshold: null, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "DENY",
  },
  {
    name: "completed idempotency key is DENY",
    ctx: {
      evidenceCount: 2,
      verificationExpectationCount: 2,
      impactAmount: 10,
      authority: authority(),
      plan: { state: "APPROVED", version: 2, approvalAction: "APPROVE", approvedBy: "demo-operator" },
      expectedVersion: 2,
      config: { financialApprovalThreshold: null, currency: "IDR" },
      idempotencyCompleted: true,
    },
    outcome: "DENY",
  },
  {
    name: "missing execute capability is DENY",
    ctx: {
      evidenceCount: 2,
      verificationExpectationCount: 2,
      impactAmount: 10,
      authority: authority({
        actorId: "demo-agent",
        actorType: "system",
        capabilities: [Capability.remediationPropose],
      }),
      plan: { state: "APPROVED", version: 1, approvalAction: "APPROVE", approvedBy: "demo-operator" },
      expectedVersion: 1,
      config: { financialApprovalThreshold: null, currency: "IDR" },
      idempotencyCompleted: false,
    },
    outcome: "DENY",
  },
];

for (const fixture of cases) {
  test(`parity: ${fixture.name}`, () => {
    const fromPackage = evaluateExecutionPolicy(fixture.ctx);
    const fromBrowser = browser.evaluateExecutionPolicy(fixture.ctx);
    assert.equal(fromPackage.outcome, fixture.outcome);
    assert.equal(fromBrowser.outcome, fixture.outcome);
    assert.deepEqual(comparable(fromBrowser), comparable(fromPackage));
  });
}

test("an AI agent cannot approve in either implementation", () => {
  const agent = {
    actorId: "demo-agent",
    actorType: "agent",
    capabilities: [Capability.remediationApprove],
    source: "trusted_runtime",
    issuedAt,
  };
  assert.throws(() => assertTrustedApprover(agent), /An AI agent cannot approve a remediation plan/);
  assert.throws(() => browser.assertTrustedApprover(agent), /An AI agent cannot approve a remediation plan/);
});
