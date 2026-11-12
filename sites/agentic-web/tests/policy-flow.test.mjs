// End-to-end checks of the Harborlight console and the remaining irreversible actions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork } from "../runtime/kernel.js";
import { buildToolTable, dispatchToolCall } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { StubDocument } from "./stub_document.mjs";
import { StubOption } from "./stub_option.mjs";
import { ScriptedModel } from "./scripted_model.mjs";

const NETWORK_NAME = "ledgerguard_policy_assistant";
const BASE = "http://localhost:8080";

globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"));
globalThis.Option = StubOption;
const { registerActions } = await import("../site-actions.js");
const { App } = await import("../script.js");
const { AssistantMount } = await import("../site.js");

async function readState(registry) {
  const plan = registry.prepare({
    kind: "action",
    action: ref(registry, "get_site_state"),
    arguments: {},
  });
  const receipts = await registry.execute(plan, async () => true, "test-read");
  return receipts[0].result;
}

function ref(registry, name) {
  for (const entry of registry.catalog({ base: BASE, network: NETWORK_NAME })) {
    if (entry.name === name) {
      return entry.ref;
    }
  }
  throw new Error(`Action ${name} is not registered.`);
}

async function registry() {
  const instance = new ActionRegistry();
  await registerActions({
    register: instance.register.bind(instance, { base: BASE, network: NETWORK_NAME }),
  });
  return instance;
}

async function loaded() {
  const config = JSON.parse(await readFile(new URL("../ledgerguard_policy_assistant.network.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
  return { config, manifest, network: new AgentNetwork(config, NETWORK_NAME) };
}

function context(bundle, actions, confirm) {
  return {
    network: bundle.network,
    manifest: bundle.manifest,
    actions,
    baseOrigin: BASE,
    displayOrigin: new URL(BASE).host,
    trace: new TraceBus(),
    isTop: true,
    frontMan: bundle.network.findFrontMan(),
    history: [],
    llm: new ScriptedModel([]),
    confirmWebsiteActions: confirm,
  };
}

async function tool(bundle, ctx, name) {
  const spec = bundle.network.getAgentSpec(bundle.network.findFrontMan());
  const table = await buildToolTable(ctx, spec, [], null);
  return table.toolByName.get(`website_${name}`);
}

test("evaluate, approve, execute, verify, and replay follow the official demo path", async () => {
  App.page.resetDemo();
  const missing = await App.page.evaluatePlan({ planId: "plan-no-evidence", expectedVersion: 1 });
  assert.equal(missing.decision.outcome, "DENY");
  assert.ok(missing.decision.reasons.some((reason) => reason.code === "MISSING_EVIDENCE"));

  const unverified = await App.page.evaluatePlan({ planId: "plan-no-verification", expectedVersion: 1 });
  assert.equal(unverified.decision.outcome, "DENY");
  assert.ok(unverified.decision.reasons.some((reason) => reason.code === "MISSING_VERIFICATION"));

  const first = await App.page.evaluatePlan({ planId: "plan-duplicate-repair", expectedVersion: 2 });
  assert.equal(first.decision.outcome, "REQUIRE_APPROVAL");
  assert.ok(first.decision.reasons.some((reason) => reason.code === "APPROVAL_REQUIRED"));
  assert.ok(first.decision.reasons.some((reason) => reason.code === "IMPACT_THRESHOLD_EXCEEDED"));
  assert.equal(typeof first.receipt.hash, "string");
  assert.equal(first.receipt.hash.length, 64);

  const stale = App.page.approvePlan({
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version + 1,
    expectedPlanVersion: 2,
    approverName: "demo-operator",
  });
  assert.equal(stale.ok, false);

  const approved = App.page.approvePlan({
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
    approverName: "demo-operator",
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.plan.state, "APPROVED");

  const second = await App.page.evaluatePlan({ planId: "plan-duplicate-repair", expectedVersion: 2 });
  assert.equal(second.decision.outcome, "ALLOW");

  const executed = await App.page.executePlan({
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
  });
  assert.equal(executed.ok, true);
  assert.equal(executed.verification.overallStatus, "PASS");
  assert.equal(executed.receipt.status, "COMMITTED");
  assert.equal(App.page.state.valuation.quantityOnHand, "10.000");
  assert.equal(App.page.state.valuation.inventoryValue, "850000.00");
  assert.ok(App.page.state.movements.find((row) => row.id === "MOV-002").reversedAt);

  const replay = await App.page.executePlan({
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.decision.outcome, "DENY");
  assert.ok(replay.decision.reasons.some((reason) => reason.code === "DUPLICATE_EXECUTION"));
  assert.equal(App.page.state.valuation.quantityOnHand, "10.000");
});

test("reject_plan needs confirmation, and an approved reject stores the same record as the button", async () => {
  App.page.resetDemo();
  const bundle = await loaded();
  const actions = await registry();
  const declining = context(bundle, actions, async () => false);
  const entry = await tool(bundle, declining, "reject_plan");
  const before = await readState(actions);
  const declined = await dispatchToolCall(declining, entry, {
    planId: "plan-duplicate-repair",
    expectedVersion: before.version,
    expectedPlanVersion: 2,
    operatorName: "demo-operator",
  }, null, []);
  assert.equal(declined.status, "cancelled");
  assert.deepEqual(await readState(actions), before);

  const approving = context(bundle, actions, async () => true);
  const approveEntry = await tool(bundle, approving, "reject_plan");
  const rejected = await dispatchToolCall(approving, approveEntry, {
    planId: "plan-duplicate-repair",
    expectedVersion: before.version,
    expectedPlanVersion: 2,
    operatorName: "demo-operator",
  }, null, []);
  assert.equal(rejected.status, "succeeded");
  assert.equal(rejected.result.plan.state, "REJECTED");
  App.page.resetDemo();
  document.getElementById("btn-reject").dispatch("click");
  assert.equal((await readState(actions)).plans["plan-duplicate-repair"].state, "REJECTED");
});

test("execute_plan is refused until the plan is approved, then a confirmed execute matches the button", async () => {
  App.page.resetDemo();
  const bundle = await loaded();
  const actions = await registry();
  const approving = context(bundle, actions, async () => true);
  const entry = await tool(bundle, approving, "execute_plan");
  const before = await readState(actions);
  const blocked = await dispatchToolCall(approving, entry, {
    planId: "plan-duplicate-repair",
    expectedVersion: before.version,
    expectedPlanVersion: 2,
  }, null, []);
  assert.equal(blocked.status, "succeeded");
  assert.equal(blocked.result.ok, false);
  assert.match(blocked.result.reason, /REQUIRE_APPROVAL/);
  assert.equal((await readState(actions)).ledger.quantityOnHand, "20.000");

  const check = AssistantMount.reviewDetails("execute_plan", {
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
  });
  assert.ok(check.refusal);

  App.page.approvePlan({
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
    approverName: "demo-operator",
  });
  const executed = await dispatchToolCall(approving, entry, {
    planId: "plan-duplicate-repair",
    expectedVersion: App.page.state.version,
    expectedPlanVersion: 2,
  }, null, []);
  assert.equal(executed.status, "succeeded");
  assert.equal(executed.result.ok, true);
  assert.equal(executed.result.verification.overallStatus, "PASS");
  assert.equal((await readState(actions)).ledger.quantityOnHand, "10.000");
});
