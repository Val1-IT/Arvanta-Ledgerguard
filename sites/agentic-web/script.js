/**
 * Harborlight Supplies synthetic ledger console.
 *
 * The page and the assistant share this module: every button and every website_*
 * tool calls the same methods. Policy decisions come from policy-engine.js, a
 * port of @ledgerguard/policy. The fixture is in-memory and uses only synthetic
 * demo data (the same Industrial Widget numbers as examples/inventory-ledger).
 */
import {
  Capability,
  assertTrustedApprover,
  evaluateExecutionPolicy,
  trustedRuntimeAuthority,
  defaultPolicies,
} from "./policy-engine.js";

const POLICY_CONFIG = {
  financialApprovalThreshold: 100000,
  currency: "IDR",
};

const EXECUTOR = {
  actorId: "ledgerguard-runtime",
  actorType: "system",
  capabilities: [
    Capability.investigationRead,
    Capability.remediationPropose,
    Capability.remediationExecute,
  ],
};

const HUMAN_OPERATOR = {
  actorId: "demo-operator",
  actorType: "human",
  capabilities: [
    Capability.investigationRead,
    Capability.remediationPropose,
    Capability.remediationApprove,
  ],
};

const LIMITS = [
  "This site cannot write to a live ERP, production database, or real Odoo instance.",
  "It cannot collect payment or move real money.",
  "It cannot expose a public MCP facade (static hosting has no application server).",
  "It cannot call or be executed by other agentic websites from this page; those sites can still fetch the published network files once this site is hosted with CORS.",
  "It cannot run a publisher-funded LLM; the visitor brings their own key.",
  "An AI agent cannot approve a plan. Only a human operator can, and the browser asks that person to confirm first.",
  "A committed execution in this demo can be undone only by resetting the synthetic fixture, not by a reversing journal.",
];

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function initialFixture() {
  const capturedAt = "2026-03-01T09:00:00.000Z";
  const receivedAt = "2026-03-02T14:15:00.000Z";
  return {
    sessionId: `ses_${crypto.randomUUID().replaceAll("-", "")}`,
    company: {
      name: "Harborlight Supplies",
      note: "Synthetic demo tenant. Not a real company. No Arvanta, Cheermol, or customer data.",
      currency: POLICY_CONFIG.currency,
    },
    product: {
      id: "ITEM-001",
      sku: "WDG-001",
      name: "Industrial Widget",
      unit: "PCS",
      standardCost: "85000.00",
    },
    movements: [
      {
        id: "MOV-001",
        productId: "ITEM-001",
        movementType: "in",
        quantity: "10.000",
        totalValue: "850000.00",
        occurredAt: receivedAt,
        sourceReceiptId: "RCP-001",
        eventIdentity: "receipt:RCP-001:ITEM-001",
        reversedAt: null,
      },
      {
        id: "MOV-002",
        productId: "ITEM-001",
        movementType: "in",
        quantity: "10.000",
        totalValue: "850000.00",
        occurredAt: "2026-03-02T14:15:00.250Z",
        sourceReceiptId: "RCP-001",
        eventIdentity: "receipt:RCP-001:ITEM-001",
        reversedAt: null,
      },
    ],
    valuation: {
      id: "val-item-001",
      productId: "ITEM-001",
      quantityOnHand: "20.000",
      averageCost: "85000.00",
      inventoryValue: "1700000.00",
      calculatedAt: "2026-03-02T14:15:00.250Z",
    },
    baseline: {
      quantityOnHand: "10.000",
      inventoryValue: "850000.00",
      capturedAt,
    },
    incident: {
      id: "inc-duplicate-inventory",
      type: "DUPLICATE_INVENTORY_MOVEMENT",
      summary: "Two inbound movements share receipt RCP-001 for ITEM-001. Quantity on hand is 20.000; the goods receipt supports 10.000.",
    },
    plans: {
      "plan-duplicate-repair": makePlan({
        id: "plan-duplicate-repair",
        title: "Reverse duplicate movement MOV-002 and regenerate valuation",
        version: 2,
        evidenceCount: 3,
        evidence: [
          "Goods receipt RCP-001 quantity 10.000 PCS",
          "MOV-001 and MOV-002 share event identity receipt:RCP-001:ITEM-001",
          "Baseline captured 2026-03-01 shows quantity 10.000 and value 850000.00",
        ],
        impactAmount: 850000,
        idempotencyKey: "exec:harborlight:reverse-dup:MOV-002",
        corrections: [
          {
            action: "REVERSE_INVENTORY_MOVEMENT",
            table: "inventory_movements",
            recordId: "MOV-002",
            field: "reversed_at",
            beforeValue: null,
            afterValue: "applied-on-execute",
          },
          {
            action: "REGENERATE_INVENTORY_VALUATION",
            table: "inventory_valuation",
            recordId: "val-item-001",
            field: "quantity_on_hand",
            beforeValue: "20.000",
            afterValue: "10.000",
          },
          {
            action: "REGENERATE_INVENTORY_VALUATION",
            table: "inventory_valuation",
            recordId: "val-item-001",
            field: "inventory_value",
            beforeValue: "1700000.00",
            afterValue: "850000.00",
          },
        ],
        verifications: [
          { field: "quantity_on_hand", expected: "10.000" },
          { field: "inventory_value", expected: "850000.00" },
        ],
      }),
      "plan-no-evidence": makePlan({
        id: "plan-no-evidence",
        title: "Ungrounded adjustment (no evidence attached)",
        version: 1,
        evidenceCount: 0,
        evidence: [],
        impactAmount: 1000,
        idempotencyKey: "exec:harborlight:no-evidence",
        corrections: [],
        verifications: [{ field: "quantity_on_hand", expected: "10.000" }],
      }),
      "plan-no-verification": makePlan({
        id: "plan-no-verification",
        title: "Adjustment with evidence but no verification rules",
        version: 1,
        evidenceCount: 1,
        evidence: ["A note that stock looks high"],
        impactAmount: 1000,
        idempotencyKey: "exec:harborlight:no-verification",
        corrections: [],
        verifications: [],
      }),
    },
    completedKeys: {},
    receipts: [],
    audit: [],
    lastDecision: null,
    selectedPlanId: "plan-duplicate-repair",
    version: 1,
    notice: "Synthetic in-memory fixture. Reloading or Reset demo restores the opening state.",
  };
}

function makePlan(fields) {
  return {
    state: "PROPOSED",
    approvalAction: null,
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    executionStatus: null,
    ...fields,
  };
}

function planSnapshot(plan) {
  return {
    state: plan.state,
    version: plan.version,
    approvalAction: plan.approvalAction,
    approvedBy: plan.approvedBy,
  };
}

function policyCatalog() {
  return defaultPolicies().map((rule) => ({ id: rule.id, name: rule.name }));
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(state) {
  const payload = {
    movements: state.movements,
    valuation: state.valuation,
  };
  return sha256Hex(JSON.stringify(payload));
}

function formatMoney(amount, currency) {
  return `${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function humanAuthority(actorId) {
  return {
    actorId,
    actorType: "human",
    capabilities: HUMAN_OPERATOR.capabilities,
    source: "trusted_runtime",
    issuedAt: nowIso(),
  };
}

function parsePlanId(planId) {
  if (typeof planId !== "string" || !Object.hasOwn(App.page.state.plans, planId)) {
    return { ok: false, reason: "Unknown plan id. Read website_get_site_state for the list of plans.", field: "planId" };
  }
  return { ok: true, planId };
}

/**
 * The page object shared by the visible console and the agent actions.
 */
class LedgerPage {
  constructor() {
    this.state = initialFixture();
    this.selectedPlanId = this.state.selectedPlanId;
  }

  /**
   * Plan ids the action schemas may accept.
   *
   * :return: The plan id list.
   */
  planIds() {
    return Object.keys(this.state.plans);
  }

  /**
   * Receipt ids currently stored.
   *
   * :return: The receipt id list.
   */
  receiptIds() {
    return this.state.receipts.map((receipt) => receipt.id);
  }

  /**
   * Point the console at a plan without changing policy state.
   *
   * :param planId: A known plan id.
   * :return: The updated state, or a refusal.
   */
  selectPlan(planId) {
    const parsed = parsePlanId(planId);
    if (!parsed.ok) {
      return parsed;
    }
    this.selectedPlanId = parsed.planId;
    this.state.selectedPlanId = parsed.planId;
    this.render();
    return this.getState();
  }

  /**
   * Return a fresh copy of the page data and current state.
   *
   * :return: The page state as plain JSON.
   */
  getState() {
    const state = this.state;
    return {
      ok: true,
      version: state.version,
      sessionId: state.sessionId,
      notice: state.notice,
      company: clone(state.company),
      product: clone(state.product),
      ledger: {
        quantityOnHand: state.valuation.quantityOnHand,
        inventoryValue: state.valuation.inventoryValue,
        averageCost: state.valuation.averageCost,
        currency: state.company.currency,
        movements: clone(state.movements),
        baseline: clone(state.baseline),
      },
      incident: clone(state.incident),
      selectedPlanId: this.selectedPlanId,
      plans: clone(state.plans),
      policyConfig: { ...POLICY_CONFIG },
      policies: policyCatalog(),
      limits: [...LIMITS],
      lastDecision: clone(state.lastDecision),
      receipts: state.receipts.map((receipt) => ({
        id: receipt.id,
        kind: receipt.kind,
        planId: receipt.planId,
        outcome: receipt.outcome,
        status: receipt.status ?? null,
        occurredAt: receipt.occurredAt,
      })),
      actors: {
        agent: { actorId: "demo-agent", actorType: "agent", capabilities: ["investigation.read", "remediation.propose"] },
        operator: { actorId: HUMAN_OPERATOR.actorId, actorType: "human", capabilities: HUMAN_OPERATOR.capabilities },
        runtime: { actorId: EXECUTOR.actorId, actorType: "system", capabilities: EXECUTOR.capabilities },
      },
    };
  }

  /**
   * Return the published policy catalog and current thresholds.
   *
   * :return: Policy descriptions and config.
   */
  getPolicies() {
    return {
      ok: true,
      config: { ...POLICY_CONFIG },
      policies: defaultPolicies().map((rule) => ({
        id: rule.id,
        name: rule.name,
      })),
      outcomes: ["ALLOW", "REQUIRE_APPROVAL", "DENY"],
      notes: [
        "evaluateExecutionPolicy always uses the remediation.execute capability on a trusted runtime authority.",
        "An AI agent cannot approve. assertTrustedApprover rejects actorType agent.",
        "The most severe outcome across the six rules wins: DENY outranks REQUIRE_APPROVAL, which outranks ALLOW.",
      ],
      limits: [...LIMITS],
    };
  }

  /**
   * Build the policy evaluation context for a plan, without changing state.
   *
   * :param planId: Plan to evaluate.
   * :param expectedVersion: Version the caller believes is current.
   * :return: The context, or a refusal.
   */
  buildEvaluationContext(planId, expectedVersion) {
    const parsed = parsePlanId(planId);
    if (!parsed.ok) {
      return parsed;
    }
    const plan = this.state.plans[parsed.planId];
    if (!Number.isInteger(expectedVersion)) {
      return { ok: false, reason: "expectedVersion must be an integer from website_get_site_state.", field: "expectedVersion" };
    }
    return {
      ok: true,
      ctx: {
        evidenceCount: plan.evidenceCount,
        verificationExpectationCount: plan.verifications.length,
        impactAmount: plan.impactAmount,
        authority: trustedRuntimeAuthority({ ...EXECUTOR, issuedAt: nowIso() }),
        plan: planSnapshot(plan),
        expectedVersion,
        config: POLICY_CONFIG,
        idempotencyCompleted: Boolean(this.state.completedKeys[plan.idempotencyKey]),
      },
      plan,
    };
  }

  /**
   * Evaluate a plan against the deterministic policy engine and record a receipt.
   * This does not change the ledger.
   *
   * :param args: planId and expectedVersion.
   * :return: The decision and a policy receipt, or a refusal.
   */
  async evaluatePlan(args) {
    const built = this.buildEvaluationContext(args.planId, args.expectedVersion);
    if (!built.ok) {
      return built;
    }
    const decision = evaluateExecutionPolicy(built.ctx);
    const receipt = await this.recordReceipt({
      kind: "policy.evaluated",
      planId: built.plan.id,
      planVersion: built.plan.version,
      expectedVersion: args.expectedVersion,
      outcome: decision.outcome,
      decision,
      status: "RECORDED",
    });
    this.state.lastDecision = { planId: built.plan.id, decision, receiptId: receipt.id };
    this.state.version += 1;
    this.appendAudit("policy.evaluated", EXECUTOR.actorId, built.plan.id, { outcome: decision.outcome, receiptId: receipt.id });
    this.selectedPlanId = built.plan.id;
    this.state.selectedPlanId = built.plan.id;
    this.render();
    return { ok: true, decision, receipt, state: this.getState() };
  }

  /**
   * Read-only check for approving a plan. Does not change state.
   *
   * :param args: planId, expectedVersion, approverName.
   * :return: {ok: true, ...details} or {ok: false, reason}.
   */
  checkApprove(args) {
    const parsed = parsePlanId(args.planId);
    if (!parsed.ok) {
      return parsed;
    }
    const plan = this.state.plans[parsed.planId];
    if (args.expectedVersion !== this.state.version) {
      return { ok: false, reason: `Page state has changed (version ${this.state.version}, call used ${args.expectedVersion}). Read website_get_site_state and try again.` };
    }
    if (args.expectedPlanVersion !== plan.version) {
      return { ok: false, reason: `Approval does not apply to this plan version (current ${plan.version}, call used ${args.expectedPlanVersion}).` };
    }
    if (plan.state === "APPROVED") {
      return { ok: false, reason: `Plan ${plan.id} is already approved.` };
    }
    if (plan.state === "EXECUTED") {
      return { ok: false, reason: `Plan ${plan.id} has already been executed.` };
    }
    if (plan.state === "REJECTED") {
      return { ok: false, reason: `Plan ${plan.id} was rejected and cannot be approved.` };
    }
    const name = typeof args.approverName === "string" ? args.approverName.trim() : "";
    if (name.length < 1 || name.length > 80) {
      return { ok: false, reason: "approverName must be 1 to 80 characters.", field: "approverName" };
    }
    try {
      assertTrustedApprover(humanAuthority(name));
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    const preview = evaluateExecutionPolicy({
      evidenceCount: plan.evidenceCount,
      verificationExpectationCount: plan.verifications.length,
      impactAmount: plan.impactAmount,
      authority: trustedRuntimeAuthority({ ...EXECUTOR, issuedAt: nowIso() }),
      plan: planSnapshot(plan),
      expectedVersion: plan.version,
      config: POLICY_CONFIG,
      idempotencyCompleted: Boolean(this.state.completedKeys[plan.idempotencyKey]),
    });
    return {
      ok: true,
      planId: plan.id,
      title: plan.title,
      planVersion: plan.version,
      pageVersion: this.state.version,
      approverName: name,
      impact: formatMoney(plan.impactAmount, POLICY_CONFIG.currency),
      currentOutcomeIfExecuted: preview.outcome,
    };
  }

  /**
   * Record a human approval of the exact plan version. The agent runtime must confirm this.
   *
   * :param args: planId, expectedVersion, expectedPlanVersion, approverName.
   * :return: The updated plan, or a refusal.
   */
  approvePlan(args) {
    const check = this.checkApprove(args);
    if (!check.ok) {
      return check;
    }
    const plan = this.state.plans[args.planId];
    plan.state = "APPROVED";
    plan.approvalAction = "APPROVE";
    plan.approvedBy = check.approverName;
    plan.approvedAt = nowIso();
    this.state.version += 1;
    this.appendAudit("approval.validated", check.approverName, plan.id, { planVersion: plan.version });
    this.selectedPlanId = plan.id;
    this.state.selectedPlanId = plan.id;
    this.render();
    return { ok: true, plan: clone(plan), state: this.getState() };
  }

  /**
   * Read-only check for rejecting a plan.
   *
   * :param args: planId, expectedVersion, expectedPlanVersion, operatorName.
   * :return: A check result.
   */
  checkReject(args) {
    const parsed = parsePlanId(args.planId);
    if (!parsed.ok) {
      return parsed;
    }
    const plan = this.state.plans[parsed.planId];
    if (args.expectedVersion !== this.state.version) {
      return { ok: false, reason: `Page state has changed (version ${this.state.version}, call used ${args.expectedVersion}). Read website_get_site_state and try again.` };
    }
    if (args.expectedPlanVersion !== plan.version) {
      return { ok: false, reason: `Rejection does not apply to this plan version (current ${plan.version}, call used ${args.expectedPlanVersion}).` };
    }
    if (plan.state === "EXECUTED") {
      return { ok: false, reason: `Plan ${plan.id} has already been executed and cannot be rejected.` };
    }
    if (plan.state === "REJECTED") {
      return { ok: false, reason: `Plan ${plan.id} is already rejected.` };
    }
    const name = typeof args.operatorName === "string" ? args.operatorName.trim() : "";
    if (name.length < 1 || name.length > 80) {
      return { ok: false, reason: "operatorName must be 1 to 80 characters.", field: "operatorName" };
    }
    try {
      assertTrustedApprover(humanAuthority(name));
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    return {
      ok: true,
      planId: plan.id,
      title: plan.title,
      planVersion: plan.version,
      operatorName: name,
      currentState: plan.state,
    };
  }

  /**
   * Record a human rejection of a plan.
   *
   * :param args: planId, expectedVersion, expectedPlanVersion, operatorName.
   * :return: The updated plan, or a refusal.
   */
  rejectPlan(args) {
    const check = this.checkReject(args);
    if (!check.ok) {
      return check;
    }
    const plan = this.state.plans[args.planId];
    plan.state = "REJECTED";
    plan.approvalAction = "REJECT";
    plan.approvedBy = check.operatorName;
    plan.approvedAt = nowIso();
    this.state.version += 1;
    this.appendAudit("approval.validated", check.operatorName, plan.id, { action: "REJECT", planVersion: plan.version });
    this.selectedPlanId = plan.id;
    this.state.selectedPlanId = plan.id;
    this.render();
    return { ok: true, plan: clone(plan), state: this.getState() };
  }

  /**
   * Read-only check for executing a plan. Applies nothing.
   *
   * :param args: planId, expectedVersion, expectedPlanVersion.
   * :return: A check result, including the current policy outcome.
   */
  checkExecute(args) {
    const parsed = parsePlanId(args.planId);
    if (!parsed.ok) {
      return parsed;
    }
    const plan = this.state.plans[parsed.planId];
    if (args.expectedVersion !== this.state.version) {
      return { ok: false, reason: `Page state has changed (version ${this.state.version}, call used ${args.expectedVersion}). Read website_get_site_state and try again.` };
    }
    if (args.expectedPlanVersion !== plan.version) {
      return { ok: false, reason: `Execution does not apply to this plan version (current ${plan.version}, call used ${args.expectedPlanVersion}).` };
    }
    const decision = evaluateExecutionPolicy({
      evidenceCount: plan.evidenceCount,
      verificationExpectationCount: plan.verifications.length,
      impactAmount: plan.impactAmount,
      authority: trustedRuntimeAuthority({ ...EXECUTOR, issuedAt: nowIso() }),
      plan: planSnapshot(plan),
      expectedVersion: plan.version,
      config: POLICY_CONFIG,
      idempotencyCompleted: Boolean(this.state.completedKeys[plan.idempotencyKey]),
    });
    if (decision.outcome !== "ALLOW") {
      return {
        ok: false,
        reason: `Policy outcome is ${decision.outcome}; execution is not allowed. ${decision.reasons.map((reason) => reason.message).join(" ")}`,
        decision,
      };
    }
    return {
      ok: true,
      planId: plan.id,
      title: plan.title,
      planVersion: plan.version,
      idempotencyKey: plan.idempotencyKey,
      impact: formatMoney(plan.impactAmount, POLICY_CONFIG.currency),
      corrections: plan.corrections.map((item) => `${item.action} ${item.table}.${item.field}: ${item.beforeValue} -> ${item.afterValue}`),
      verifications: plan.verifications.map((item) => `${item.field} must equal ${item.expected}`),
      decision,
    };
  }

  /**
   * Execute an allowed plan inside a simulated transaction: apply on a copy, verify,
   * and commit only when every postcondition passes.
   *
   * :param args: planId, expectedVersion, expectedPlanVersion.
   * :return: The execution receipt, or a refusal.
   */
  async executePlan(args) {
    const check = this.checkExecute(args);
    if (!check.ok) {
      if (check.decision) {
        const receipt = await this.recordReceipt({
          kind: "policy.evaluated",
          planId: args.planId,
          planVersion: this.state.plans[args.planId]?.version,
          expectedVersion: args.expectedPlanVersion,
          outcome: check.decision.outcome,
          decision: check.decision,
          status: "BLOCKED",
        });
        this.state.lastDecision = { planId: args.planId, decision: check.decision, receiptId: receipt.id };
        this.state.version += 1;
        this.render();
        return { ok: false, reason: check.reason, decision: check.decision, receipt };
      }
      return check;
    }
    const plan = this.state.plans[args.planId];
    const working = {
      movements: clone(this.state.movements),
      valuation: clone(this.state.valuation),
    };
    const appliedAt = nowIso();
    try {
      applyCorrections(working, plan, appliedAt);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    const verification = verifyExpectations(working, plan);
    if (verification.overallStatus !== "PASS") {
      const receipt = await this.recordReceipt({
        kind: "execution.rolled_back",
        planId: plan.id,
        planVersion: plan.version,
        expectedVersion: plan.version,
        outcome: "DENY",
        status: "ROLLED_BACK",
        committed: false,
        verification,
        idempotencyKey: plan.idempotencyKey,
        sourceStateFingerprint: await fingerprint(this.state),
      });
      this.state.lastDecision = { planId: plan.id, decision: check.decision, receiptId: receipt.id };
      this.state.version += 1;
      this.appendAudit("execution.rolled_back", EXECUTOR.actorId, plan.id, { receiptId: receipt.id });
      this.render();
      return { ok: false, reason: "Verification failed; the ledger was not changed.", verification, receipt };
    }
    this.state.movements = working.movements;
    this.state.valuation = { ...working.valuation, calculatedAt: appliedAt };
    this.state.completedKeys[plan.idempotencyKey] = true;
    plan.state = "EXECUTED";
    plan.executedAt = appliedAt;
    plan.executionStatus = "COMMITTED";
    const receipt = await this.recordReceipt({
      kind: "execution.committed",
      planId: plan.id,
      planVersion: plan.version,
      expectedVersion: plan.version,
      outcome: "ALLOW",
      status: "COMMITTED",
      committed: true,
      verification,
      idempotencyKey: plan.idempotencyKey,
      sourceStateFingerprint: await fingerprint(this.state),
      decision: check.decision,
      ledgerAfter: {
        quantityOnHand: this.state.valuation.quantityOnHand,
        inventoryValue: this.state.valuation.inventoryValue,
      },
    });
    this.state.lastDecision = { planId: plan.id, decision: check.decision, receiptId: receipt.id };
    this.state.version += 1;
    this.appendAudit("execution.committed", EXECUTOR.actorId, plan.id, { receiptId: receipt.id });
    this.selectedPlanId = plan.id;
    this.state.selectedPlanId = plan.id;
    this.render();
    return { ok: true, receipt, decision: check.decision, verification, state: this.getState() };
  }

  /**
   * Return one stored receipt.
   *
   * :param args: receiptId.
   * :return: The receipt, or a refusal.
   */
  getReceipt(args) {
    const receipt = this.state.receipts.find((item) => item.id === args.receiptId);
    if (!receipt) {
      return { ok: false, reason: "Unknown receipt id. Read website_get_site_state for the list of receipts.", field: "receiptId" };
    }
    return { ok: true, receipt: clone(receipt) };
  }

  /**
   * Restore the opening synthetic fixture. Receipts and approvals are cleared.
   *
   * :return: The reset state.
   */
  resetDemo() {
    this.state = initialFixture();
    this.selectedPlanId = this.state.selectedPlanId;
    this.render();
    return this.getState();
  }

  /**
   * Append an audit event.
   *
   * :param type: Event type.
   * :param actorId: Actor id.
   * :param planId: Related plan.
   * :param payload: Extra data.
   */
  appendAudit(type, actorId, planId, payload) {
    this.state.audit.push({
      id: `aud_${crypto.randomUUID().replaceAll("-", "")}`,
      occurredAt: nowIso(),
      type,
      actorId,
      planId,
      payload,
    });
  }

  /**
   * Store a receipt with a content hash.
   *
   * :param fields: Receipt fields.
   * :return: The stored receipt.
   */
  async recordReceipt(fields) {
    const occurredAt = nowIso();
    const id = `rcpt_${crypto.randomUUID().replaceAll("-", "")}`;
    const body = {
      schemaVersion: "0.2-agentic-web",
      id,
      occurredAt,
      sessionId: this.state.sessionId,
      ...fields,
    };
    const { hash: _ignored, ...hashable } = body;
    body.hash = await sha256Hex(JSON.stringify(hashable));
    this.state.receipts.unshift(body);
    return body;
  }

  /**
   * Paint the console from current state. Safe to call when the document has no nodes
   * (unit imports) or when only some nodes exist.
   */
  render() {
    if (typeof document === "undefined" || typeof document.getElementById !== "function") {
      return;
    }
    const state = this.getState();
    const plan = state.plans[this.selectedPlanId];
    setText("ledger-qty", state.ledger.quantityOnHand);
    setText("ledger-value", formatMoney(state.ledger.inventoryValue, state.company.currency));
    setText("ledger-cost", formatMoney(state.ledger.averageCost, state.company.currency));
    setText("incident-type", state.incident.type);
    setText("incident-summary", state.incident.summary);
    const movementTable = document.getElementById("movement-rows");
    if (movementTable && typeof movementTable.replaceChildren === "function") {
      movementTable.replaceChildren();
      for (const movement of state.ledger.movements) {
        const row = document.createElement("tr");
        row.append(
          cell(movement.id),
          cell(movement.quantity),
          cell(formatMoney(movement.totalValue, state.company.currency)),
          cell(movement.sourceReceiptId),
          cell(movement.reversedAt ? "reversed" : "active"),
        );
        movementTable.append(row);
      }
    }
    const select = document.getElementById("plan-select");
    if (select) {
      const options = select.options;
      if (options && options.length === 0 && typeof select.add === "function") {
        for (const id of Object.keys(state.plans)) {
          const option = new Option(`${id} — ${state.plans[id].title}`, id);
          select.add(option);
        }
      }
      select.value = this.selectedPlanId;
    }
    if (plan) {
      setText("plan-state", plan.state);
      setText("plan-version", String(plan.version));
      setText("plan-title", plan.title);
      setText("plan-impact", formatMoney(plan.impactAmount, state.company.currency));
      setText("plan-key", plan.idempotencyKey);
      setText("plan-evidence", plan.evidence.length ? plan.evidence.map((item) => `• ${item}`).join("\n") : "None");
      setText("plan-verify", plan.verifications.length ? plan.verifications.map((item) => `• ${item.field} = ${item.expected}`).join("\n") : "None");
      setText("plan-approved-by", plan.approvedBy ?? "—");
    }
    const decision = state.lastDecision;
    const outcomeNode = document.getElementById("decision-outcome");
    if (outcomeNode) {
      if (decision) {
        outcomeNode.textContent = decision.decision.outcome;
        outcomeNode.dataset.outcome = decision.decision.outcome;
        setText("decision-detail", decision.decision.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("\n"));
        setText("decision-receipt", decision.receiptId);
      } else {
        outcomeNode.textContent = "Not yet evaluated";
        outcomeNode.dataset.outcome = "none";
        setText("decision-detail", "Evaluate a plan to see ALLOW, REQUIRE_APPROVAL, or DENY, with the reasons from every policy rule.");
        setText("decision-receipt", "—");
      }
    }
    const receiptList = document.getElementById("receipt-list");
    if (receiptList && typeof receiptList.replaceChildren === "function") {
      receiptList.replaceChildren();
      if (state.receipts.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No receipts yet.";
        receiptList.append(empty);
      }
      for (const receipt of state.receipts) {
        const item = document.createElement("li");
        item.className = "receipt-item";
        item.innerHTML = "";
        const title = document.createElement("strong");
        title.textContent = receipt.id;
        const meta = document.createElement("span");
        meta.textContent = `${receipt.kind} · ${receipt.outcome ?? receipt.status} · ${receipt.occurredAt}`;
        item.append(title, meta);
        receiptList.append(item);
      }
    }
    setText("page-version", String(state.version));
    setText("session-id", state.sessionId);
  }

  /**
   * Bind console controls. The assistant can also drive the same methods.
   */
  bind() {
    if (typeof document === "undefined") {
      return;
    }
    const select = document.getElementById("plan-select");
    select?.addEventListener("change", () => {
      this.selectPlan(select.value);
    });
    document.getElementById("btn-evaluate")?.addEventListener("click", () => {
      void this.evaluatePlan({ planId: this.selectedPlanId, expectedVersion: this.state.plans[this.selectedPlanId].version });
    });
    document.getElementById("btn-approve")?.addEventListener("click", () => {
      const result = this.approvePlan({
        planId: this.selectedPlanId,
        expectedVersion: this.state.version,
        expectedPlanVersion: this.state.plans[this.selectedPlanId].version,
        approverName: "demo-operator",
      });
      if (!result.ok) {
        window.alert(result.reason);
      }
    });
    document.getElementById("btn-reject")?.addEventListener("click", () => {
      const result = this.rejectPlan({
        planId: this.selectedPlanId,
        expectedVersion: this.state.version,
        expectedPlanVersion: this.state.plans[this.selectedPlanId].version,
        operatorName: "demo-operator",
      });
      if (!result.ok) {
        window.alert(result.reason);
      }
    });
    document.getElementById("btn-execute")?.addEventListener("click", () => {
      void this.executePlan({
        planId: this.selectedPlanId,
        expectedVersion: this.state.version,
        expectedPlanVersion: this.state.plans[this.selectedPlanId].version,
      }).then((result) => {
        if (!result.ok && typeof window !== "undefined") {
          window.alert(result.reason);
        }
      });
    });
    document.getElementById("btn-reset")?.addEventListener("click", () => {
      this.resetDemo();
    });
    this.render();
  }
}

function applyCorrections(working, plan, appliedAt) {
  for (const correction of plan.corrections) {
    if (correction.action === "REVERSE_INVENTORY_MOVEMENT") {
      const movement = working.movements.find((row) => row.id === correction.recordId);
      if (!movement) {
        throw new Error(`Movement ${correction.recordId} was not found.`);
      }
      movement.reversedAt = appliedAt;
      continue;
    }
    if (correction.action === "REGENERATE_INVENTORY_VALUATION") {
      if (working.valuation.id !== correction.recordId) {
        throw new Error(`Valuation ${correction.recordId} was not found.`);
      }
      if (correction.field === "quantity_on_hand") {
        working.valuation.quantityOnHand = correction.afterValue;
      } else if (correction.field === "inventory_value") {
        working.valuation.inventoryValue = correction.afterValue;
      } else {
        throw new Error(`Unsupported valuation field ${correction.field}.`);
      }
      continue;
    }
    throw new Error(`Unsupported correction ${correction.action}.`);
  }
}

function verifyExpectations(working, plan) {
  const results = plan.verifications.map((rule) => {
    let actual = null;
    if (rule.field === "quantity_on_hand") {
      actual = working.valuation.quantityOnHand;
    } else if (rule.field === "inventory_value") {
      actual = working.valuation.inventoryValue;
    }
    return {
      field: rule.field,
      expected: rule.expected,
      actual,
      status: actual === rule.expected ? "PASS" : "FAIL",
    };
  });
  return {
    overallStatus: results.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
    results,
  };
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

export class App {
  static page = new LedgerPage();
}

if (typeof document !== "undefined" && typeof document.getElementById === "function") {
  App.page.bind();
}
