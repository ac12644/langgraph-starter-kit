import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";

// -- Mock Data --

const CUSTOMERS: Record<string, { name: string; email: string; plan: string; balance: number }> = {
  "C-1001": { name: "Alice Johnson", email: "alice@example.com", plan: "Pro", balance: 0 },
  "C-1002": { name: "Bob Smith", email: "bob@example.com", plan: "Free", balance: 29.99 },
  "C-1003": { name: "Charlie Lee", email: "charlie@example.com", plan: "Enterprise", balance: 0 },
};

const ORDERS: Record<string, { customerId: string; item: string; status: string; total: number }> = {
  "ORD-501": { customerId: "C-1001", item: "Wireless Headphones", status: "delivered", total: 79.99 },
  "ORD-502": { customerId: "C-1002", item: "USB-C Hub", status: "shipped", total: 34.99 },
  "ORD-503": { customerId: "C-1001", item: "Mechanical Keyboard", status: "processing", total: 149.99 },
  "ORD-504": { customerId: "C-1003", item: "Monitor Stand", status: "delivered", total: 59.99 },
};

const TICKETS: { id: string; customerId: string; issue: string; status: string }[] = [
  { id: "TK-001", customerId: "C-1002", issue: "Cannot login to dashboard", status: "open" },
  { id: "TK-002", customerId: "C-1001", issue: "Billing charge mismatch", status: "open" },
];

// -- Billing Tools --

export const lookupCustomer = tool(
  async ({ customerId }) => {
    const customer = CUSTOMERS[customerId];
    if (!customer) return `Customer "${customerId}" not found.`;
    return JSON.stringify({ customerId, ...customer });
  },
  {
    name: "lookup_customer",
    description: "Look up customer account details by customer ID",
    schema: z.object({ customerId: z.string().describe("Customer ID (e.g. C-1001)") }),
  }
);

export const checkBalance = tool(
  async ({ customerId }) => {
    const customer = CUSTOMERS[customerId];
    if (!customer) return `Customer "${customerId}" not found.`;
    return customer.balance === 0
      ? `${customer.name} has no outstanding balance.`
      : `${customer.name} has an outstanding balance of $${customer.balance.toFixed(2)}.`;
  },
  {
    name: "check_balance",
    description: "Check a customer's billing balance",
    schema: z.object({ customerId: z.string() }),
  }
);

export const issueRefund = tool(
  async ({ orderId, reason }) => {
    const order = ORDERS[orderId];
    if (!order) return `Order "${orderId}" not found.`;

    const decision = interrupt({
      type: "refund_approval",
      message: `Refund $${order.total.toFixed(2)} for order ${orderId} (${order.item})? Reason: ${reason}`,
      orderId,
      amount: order.total,
    });

    if (decision !== "yes") {
      return `Refund for order ${orderId} was rejected.`;
    }
    return `Refund of $${order.total.toFixed(2)} issued for order ${orderId} (${order.item}).`;
  },
  {
    name: "issue_refund",
    description: "Issue a refund for an order. Requires human approval.",
    schema: z.object({
      orderId: z.string().describe("Order ID to refund"),
      reason: z.string().describe("Reason for the refund"),
    }),
  }
);

// -- Tech Support Tools --

export const lookupOrder = tool(
  async ({ orderId }) => {
    const order = ORDERS[orderId];
    if (!order) return `Order "${orderId}" not found.`;
    return JSON.stringify({ orderId, ...order });
  },
  {
    name: "lookup_order",
    description: "Look up order details by order ID",
    schema: z.object({ orderId: z.string().describe("Order ID (e.g. ORD-501)") }),
  }
);

export const searchOrders = tool(
  async ({ customerId }) => {
    const customerOrders = Object.entries(ORDERS)
      .filter(([, o]) => o.customerId === customerId)
      .map(([id, o]) => ({ orderId: id, ...o }));
    if (customerOrders.length === 0) return `No orders found for customer ${customerId}.`;
    return JSON.stringify(customerOrders);
  },
  {
    name: "search_orders",
    description: "Search all orders for a customer",
    schema: z.object({ customerId: z.string() }),
  }
);

export const createTicket = tool(
  async ({ customerId, issue }) => {
    const id = `TK-${String(TICKETS.length + 1).padStart(3, "0")}`;
    TICKETS.push({ id, customerId, issue, status: "open" });
    return `Support ticket ${id} created for customer ${customerId}: "${issue}"`;
  },
  {
    name: "create_ticket",
    description: "Create a new support ticket for a customer issue",
    schema: z.object({
      customerId: z.string(),
      issue: z.string().describe("Description of the issue"),
    }),
  }
);

export const listTickets = tool(
  async ({ customerId }) => {
    const customerTickets = TICKETS.filter((t) => t.customerId === customerId);
    if (customerTickets.length === 0) return `No tickets found for customer ${customerId}.`;
    return JSON.stringify(customerTickets);
  },
  {
    name: "list_tickets",
    description: "List all support tickets for a customer",
    schema: z.object({ customerId: z.string() }),
  }
);

// -- Returns Tools --

export const initiateReturn = tool(
  async ({ orderId, reason }) => {
    const order = ORDERS[orderId];
    if (!order) return `Order "${orderId}" not found.`;
    if (order.status !== "delivered") {
      return `Cannot initiate return — order ${orderId} status is "${order.status}" (must be "delivered").`;
    }

    const decision = interrupt({
      type: "return_approval",
      message: `Approve return for order ${orderId} (${order.item}, $${order.total.toFixed(2)})? Reason: ${reason}`,
      orderId,
      amount: order.total,
    });

    if (decision !== "yes") {
      return `Return for order ${orderId} was rejected.`;
    }
    return `Return initiated for order ${orderId} (${order.item}). Customer will receive a shipping label via email.`;
  },
  {
    name: "initiate_return",
    description: "Initiate a product return for a delivered order. Requires approval.",
    schema: z.object({
      orderId: z.string(),
      reason: z.string().describe("Reason for the return"),
    }),
  }
);

// -- Escalation Tool --

export const escalateToHuman = tool(
  async ({ reason, customerId }) => {
    const decision = interrupt({
      type: "escalation",
      message: `Agent is escalating to a human operator. Customer: ${customerId}. Reason: ${reason}`,
      customerId,
    });

    return decision === "yes"
      ? `Escalation accepted. A human agent will take over for customer ${customerId}.`
      : `Escalation declined. Please continue assisting the customer.`;
  },
  {
    name: "escalate_to_human",
    description: "Escalate the conversation to a human support agent when the issue is too complex or the customer requests it",
    schema: z.object({
      customerId: z.string(),
      reason: z.string().describe("Why this needs human attention"),
    }),
  }
);
