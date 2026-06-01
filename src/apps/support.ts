import { getLlm } from "../config/llm";
import { makeAgent } from "../agents/factory";
import { makeSupervisor } from "../agents/supervisor";
import {
  lookupCustomer,
  checkBalance,
  issueRefund,
  lookupOrder,
  searchOrders,
  createTicket,
  listTickets,
  initiateReturn,
  escalateToHuman,
} from "../tools/support";

export async function createSupportApp() {
  const llm = await getLlm();

  const billingAgent = makeAgent({
    name: "billing_agent",
    llm,
    tools: [lookupCustomer, checkBalance, issueRefund, escalateToHuman],
    system: [
      "You are a billing specialist for a SaaS company.",
      "You help customers with account lookups, balance inquiries, and refunds.",
      "Use the issue_refund tool directly when a refund is requested — the tool handles approval.",
      "If the issue is outside billing, tell the supervisor to route to the correct agent.",
      "If the customer is upset or the issue is complex, use escalate_to_human.",
      "Always be professional and empathetic.",
    ].join("\n"),
  });

  const techAgent = makeAgent({
    name: "tech_support_agent",
    llm,
    tools: [lookupOrder, searchOrders, createTicket, listTickets, escalateToHuman],
    system: [
      "You are a technical support specialist.",
      "You help customers with order issues, tracking, and technical problems.",
      "You can look up orders, create support tickets, and list existing tickets.",
      "If you cannot resolve the issue, use escalate_to_human.",
      "Always ask for the customer ID if not provided.",
    ].join("\n"),
  });

  const returnsAgent = makeAgent({
    name: "returns_agent",
    llm,
    tools: [lookupOrder, searchOrders, initiateReturn, escalateToHuman],
    system: [
      "You are a returns and exchanges specialist.",
      "You help customers return or exchange delivered products.",
      "Use the initiate_return tool when the customer wants to return — it handles approval.",
      "Returns are only available for orders with status 'delivered'.",
      "If the order isn't delivered yet, explain that and offer alternatives.",
    ].join("\n"),
  });

  return makeSupervisor({
    agents: [billingAgent, techAgent, returnsAgent],
    llm,
    outputMode: "last_message",
    supervisorName: "support_router",
    prompt: [
      "You are the front-desk router for a customer support system.",
      "Route customer inquiries to the correct specialist:",
      "- billing_agent: account info, balances, payments, refunds, subscription issues",
      "- tech_support_agent: order tracking, technical problems, bug reports, support tickets",
      "- returns_agent: product returns, exchanges, damaged items",
      "If the customer's intent is unclear, ask a clarifying question before routing.",
      "Never try to handle issues yourself — always delegate to a specialist.",
    ].join("\n"),
  });
}
