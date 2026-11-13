// Mounts the assistant inside the existing page. Load it with:
//   <script type="module" src="site.js"></script>
import { App } from "./script.js";

/**
 * Boots the browser runtime in the page's assistant section.
 *
 * It points the runtime at this folder, so the manifest, network and actions load from
 * the same place as the page. Before each irreversible action, it shows its own
 * confirmation dialog, written for the visitor.
 */
export class AssistantMount {
  /**
   * The first chat message once the visitor has a key: what the assistant can do here.
   */
  static GREETING = "I can read this synthetic Harborlight ledger, run LedgerGuard policy checks, and walk a repair through human approval, verified execution, and audit receipts. I cannot write to a live ERP or approve a plan myself.";

  /**
   * The confirmation dialog's words for each irreversible action. Name each button after
   * what it does, so that "Cancel" never has two meanings.
   */
  static DIALOGS = {
    approve_plan: {
      title: "Approve this plan?",
      sentence: "You would be recorded as the human operator who approved this exact plan version. The ledger does not change until a later, separately confirmed execution.",
      confirm: "Approve the plan",
      decline: "Do not approve",
    },
    reject_plan: {
      title: "Reject this plan?",
      sentence: "You would be recorded as the human operator who rejected this plan. It could not be executed afterwards, unless the demo is reset.",
      confirm: "Reject the plan",
      decline: "Keep the plan",
    },
    execute_plan: {
      title: "Execute this plan?",
      sentence: "If policy still allows it, the site will apply the corrections on a copy, verify the postconditions, and commit only if verification passes. A hashed execution receipt will be stored. This cannot be undone except by resetting the synthetic demo.",
      confirm: "Execute and verify",
      decline: "Do not execute",
    },
  };

  /**
   * Boot the runtime and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      const needsKey = !booted.engine.mockLLM
        && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "Assistant needs your LLM API key. Add it in the settings below."
        : "Assistant connected to this page.";
      if (!needsKey) {
        AssistantMount.greet();
      }
      return booted.engine;
    } catch (error) {
      status.textContent = "The assistant could not load. You can still use the page directly.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Replace the runtime's general first chat message with GREETING. "New chat" keeps the
   * first message, so the greeting stays for the whole visit.
   */
  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) {
      first.textContent = AssistantMount.GREETING;
    }
  }

  /**
   * Ask the visitor to confirm actions before they run.
   *
   * :param items: The actions waiting for confirmation.
   * :return: True when the visitor confirms.
   * :raises Error: The site's reason, when its own check refuses the action.
   */
  static async review(items) {
    let confirmed = false;
    if (items.length === 1 && Object.hasOwn(AssistantMount.DIALOGS, items[0].action)) {
      const content = AssistantMount.dialogContent(items[0]);
      if (content.refusal) {
        throw new Error(content.refusal);
      }
      confirmed = await new Promise(AssistantMount.openDialog.bind(null, content));
    } else {
      confirmed = await AssistantMount.defaultReview(items);
    }
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /**
   * Work out what the dialog says for one action.
   *
   * :param item: An action waiting for confirmation.
   * :return: The title, sentence, button labels, details, exact call text and refusal.
   */
  static dialogContent(item) {
    let details = {};
    try {
      details = AssistantMount.reviewDetails(item.action, item.arguments) || {};
    } catch (error) {
      console.error("Could not add details to the confirmation dialog", error);
    }
    return {
      ...AssistantMount.DIALOGS[item.action],
      details: details,
      refusal: details.refusal,
      exact: `${item.action} on ${item.origin} (${item.effect})\n${JSON.stringify(item.arguments, null, 2)}`,
    };
  }

  /**
   * Give the readable details of one irreversible action from the page's own checks.
   *
   * :param action: The action name.
   * :param args: The action's arguments.
   * :return: Details by label, {refusal: reason}, or {}.
   */
  static reviewDetails(action, args) {
    if (action === "approve_plan") {
      const check = App.page.checkApprove(args);
      if (!check.ok) {
        return { refusal: check.reason };
      }
      return {
        Plan: check.planId,
        Title: check.title,
        "Plan version": check.planVersion,
        "Page version": check.pageVersion,
        Approver: check.approverName,
        Impact: check.impact,
        "Outcome if executed now": check.currentOutcomeIfExecuted,
      };
    }
    if (action === "reject_plan") {
      const check = App.page.checkReject(args);
      if (!check.ok) {
        return { refusal: check.reason };
      }
      return {
        Plan: check.planId,
        Title: check.title,
        "Plan version": check.planVersion,
        Operator: check.operatorName,
        "Current state": check.currentState,
      };
    }
    if (action === "execute_plan") {
      const check = App.page.checkExecute(args);
      if (!check.ok) {
        return { refusal: check.reason };
      }
      return {
        Plan: check.planId,
        Title: check.title,
        "Plan version": check.planVersion,
        "Idempotency key": check.idempotencyKey,
        Impact: check.impact,
        Corrections: check.corrections.join("; "),
        Verification: check.verifications.join("; "),
        "Policy outcome": check.decision.outcome,
      };
    }
    return {};
  }

  /**
   * Open the confirmation dialog.
   *
   * :param content: What the dialog says, from dialogContent().
   * :param resolve: Receives true when the visitor confirms, and false otherwise.
   */
  static openDialog(content, resolve) {
    const dialog = document.createElement("dialog");
    dialog.className = "assistant-review";
    dialog.setAttribute("aria-labelledby", "assistant-review-title");
    const heading = document.createElement("h2");
    heading.id = "assistant-review-title";
    heading.textContent = content.title;
    heading.tabIndex = -1;
    heading.autofocus = true;
    const sentence = document.createElement("p");
    sentence.textContent = content.sentence;
    dialog.append(heading, sentence);
    const exact = document.createElement("details");
    const exactLabel = document.createElement("summary");
    exactLabel.textContent = "Technical details";
    const exactText = document.createElement("pre");
    exactText.textContent = content.exact;
    exact.append(exactLabel, exactText);
    const entries = Object.entries(content.details).filter(([label]) => label !== "refusal");
    if (entries.length) {
      const list = document.createElement("dl");
      for (const [label, value] of entries) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = String(value);
        list.append(term, description);
      }
      dialog.append(list);
    } else {
      exact.open = true;
    }
    const confirmButton = document.createElement("button");
    confirmButton.textContent = content.confirm;
    confirmButton.addEventListener("click", dialog.close.bind(dialog, "confirm"));
    const declineButton = document.createElement("button");
    declineButton.className = "assistant-decline";
    declineButton.textContent = content.decline;
    declineButton.addEventListener("click", dialog.close.bind(dialog, "decline"));
    dialog.addEventListener("close", AssistantMount.finishDialog.bind(null, dialog, resolve));
    dialog.append(exact, confirmButton, declineButton);
    document.body.append(dialog);
    dialog.showModal();
  }

  /**
   * Remove the closed dialog and report the visitor's choice.
   *
   * :param dialog: The dialog that just closed.
   * :param resolve: Receives true when the visitor pressed the confirm button.
   */
  static finishDialog(dialog, resolve) {
    dialog.remove();
    resolve(dialog.returnValue === "confirm");
  }

  /**
   * Put focus back in the chat input when a dialog left it on the page body.
   */
  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

if (typeof window !== "undefined") {
  await AssistantMount.start();
}
