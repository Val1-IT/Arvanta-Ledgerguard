// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
import { App } from "./script.js";

/**
 * Describes the site's operations as actions the agents can call.
 *
 * Each action wraps a function the page already uses, so the assistant and the manual
 * console share one set of rules. The runtime validates arguments against inputSchema
 * before execute runs, and asks the visitor to confirm "irreversible" actions first.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.getPoliciesAction());
    actions.register(SiteActions.getReceiptAction());
    actions.register(SiteActions.evaluatePlanAction());
    actions.register(SiteActions.resetDemoAction());
    actions.register(SiteActions.approvePlanAction());
    actions.register(SiteActions.rejectPlanAction());
    actions.register(SiteActions.executePlanAction());
  }

  static readStateAction() {
    return {
      name: "get_site_state",
      description: "Read the Harborlight Supplies synthetic ledger, open incident, plans, current policy decision, receipt summaries, page version, and the list of things this site cannot do.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readState,
    };
  }

  static readState() {
    return App.page.getState();
  }

  static getPoliciesAction() {
    return {
      name: "get_policies",
      description: "Read the deterministic policy catalog, financial threshold, and how ALLOW, REQUIRE_APPROVAL, and DENY are decided. Does not change state.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.getPolicies,
    };
  }

  static getPolicies() {
    return App.page.getPolicies();
  }

  static getReceiptAction() {
    return {
      name: "get_receipt",
      description: "Read one audit receipt by id from website_get_site_state, including its hash, policy decision or verification, and ledger snapshot when present.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["receiptId"],
        properties: {
          receiptId: {
            type: "string",
            minLength: 1,
            description: "Receipt id from website_get_site_state.",
          },
        },
      },
      execute: SiteActions.getReceipt,
    };
  }

  static getReceipt(args) {
    return App.page.getReceipt(args);
  }

  static evaluatePlanAction() {
    return {
      name: "evaluate_plan",
      description: "Run evaluateExecutionPolicy on a plan and record a policy receipt. Does not change the ledger. expectedVersion is the plan's version from website_get_site_state. Returns the decision (ALLOW, REQUIRE_APPROVAL, or DENY) and reasons.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "expectedVersion"],
        properties: {
          planId: {
            type: "string",
            enum: App.page.planIds(),
            description: "Plan id from website_get_site_state.",
          },
          expectedVersion: {
            type: "integer",
            minimum: 1,
            description: "The plan version from website_get_site_state, read in this turn.",
          },
        },
      },
      execute: SiteActions.evaluatePlan,
    };
  }

  static evaluatePlan(args) {
    return App.page.evaluatePlan(args);
  }

  static resetDemoAction() {
    return {
      name: "reset_demo",
      description: "Restore the opening synthetic Harborlight fixture. Clears approvals, executions, and receipts. The visitor can do this from the page's Reset demo button too.",
      effect: "write",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.resetDemo,
    };
  }

  static resetDemo() {
    return App.page.resetDemo();
  }

  static approvePlanAction() {
    return {
      name: "approve_plan",
      description: "Record a human approval of the exact plan version. The browser asks the visitor to confirm first. An AI agent cannot be the approver. expectedVersion is the page version; expectedPlanVersion is the plan version; both from website_get_site_state read in this turn.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "expectedVersion", "expectedPlanVersion", "approverName"],
        properties: {
          planId: {
            type: "string",
            enum: App.page.planIds(),
            description: "Plan id from website_get_site_state.",
          },
          expectedVersion: {
            type: "integer",
            minimum: 0,
            description: "Page version from website_get_site_state, read in this turn.",
          },
          expectedPlanVersion: {
            type: "integer",
            minimum: 1,
            description: "Plan version from website_get_site_state, read in this turn.",
          },
          approverName: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "Name of the human operator who is confirming, such as demo-operator.",
          },
        },
      },
      execute: SiteActions.approvePlan,
    };
  }

  static approvePlan(args) {
    return App.page.approvePlan(args);
  }

  static rejectPlanAction() {
    return {
      name: "reject_plan",
      description: "Record a human rejection of a plan. The browser asks the visitor to confirm first. expectedVersion is the page version; expectedPlanVersion is the plan version; both from website_get_site_state read in this turn.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "expectedVersion", "expectedPlanVersion", "operatorName"],
        properties: {
          planId: {
            type: "string",
            enum: App.page.planIds(),
            description: "Plan id from website_get_site_state.",
          },
          expectedVersion: {
            type: "integer",
            minimum: 0,
            description: "Page version from website_get_site_state, read in this turn.",
          },
          expectedPlanVersion: {
            type: "integer",
            minimum: 1,
            description: "Plan version from website_get_site_state, read in this turn.",
          },
          operatorName: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "Name of the human operator who is confirming, such as demo-operator.",
          },
        },
      },
      execute: SiteActions.rejectPlan,
    };
  }

  static rejectPlan(args) {
    return App.page.rejectPlan(args);
  }

  static executePlanAction() {
    return {
      name: "execute_plan",
      description: "Execute a plan only if evaluateExecutionPolicy returns ALLOW, apply corrections on a copy, verify postconditions, and commit only on PASS. Records a hashed execution receipt. The browser asks the visitor to confirm first. expectedVersion is the page version; expectedPlanVersion is the plan version; both from website_get_site_state read in this turn. Replaying a completed idempotency key is denied.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "expectedVersion", "expectedPlanVersion"],
        properties: {
          planId: {
            type: "string",
            enum: App.page.planIds(),
            description: "Plan id from website_get_site_state.",
          },
          expectedVersion: {
            type: "integer",
            minimum: 0,
            description: "Page version from website_get_site_state, read in this turn.",
          },
          expectedPlanVersion: {
            type: "integer",
            minimum: 1,
            description: "Plan version from website_get_site_state, read in this turn.",
          },
        },
      },
      execute: SiteActions.executePlan,
    };
  }

  static executePlan(args) {
    return App.page.executePlan(args);
  }
}

export const registerActions = SiteActions.registerActions;
