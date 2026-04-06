import { describe, it, expect } from "vitest";
import {
  lookupCustomer,
  checkBalance,
  lookupOrder,
  searchOrders,
  createTicket,
  listTickets,
} from "../../src/tools/support";

describe("support tools", () => {
  describe("lookupCustomer", () => {
    it("returns customer data for valid ID", async () => {
      const result = await lookupCustomer.invoke({ customerId: "C-1001" });
      expect(result).toContain("Alice Johnson");
      expect(result).toContain("Pro");
    });

    it("returns not found for invalid ID", async () => {
      const result = await lookupCustomer.invoke({ customerId: "C-9999" });
      expect(result).toContain("not found");
    });
  });

  describe("checkBalance", () => {
    it("shows outstanding balance", async () => {
      const result = await checkBalance.invoke({ customerId: "C-1002" });
      expect(result).toContain("$29.99");
    });

    it("shows no balance for paid-up customer", async () => {
      const result = await checkBalance.invoke({ customerId: "C-1001" });
      expect(result).toContain("no outstanding balance");
    });
  });

  describe("lookupOrder", () => {
    it("returns order details", async () => {
      const result = await lookupOrder.invoke({ orderId: "ORD-501" });
      expect(result).toContain("Wireless Headphones");
      expect(result).toContain("delivered");
    });

    it("returns not found for invalid order", async () => {
      const result = await lookupOrder.invoke({ orderId: "ORD-999" });
      expect(result).toContain("not found");
    });
  });

  describe("searchOrders", () => {
    it("returns orders for a customer", async () => {
      const result = await searchOrders.invoke({ customerId: "C-1001" });
      expect(result).toContain("ORD-501");
      expect(result).toContain("ORD-503");
    });

    it("returns no orders for customer without orders", async () => {
      const result = await searchOrders.invoke({ customerId: "C-9999" });
      expect(result).toContain("No orders found");
    });
  });

  describe("createTicket", () => {
    it("creates a ticket and returns ID", async () => {
      const result = await createTicket.invoke({
        customerId: "C-1001",
        issue: "App crashes on login",
      });
      expect(result).toContain("TK-");
      expect(result).toContain("App crashes on login");
    });
  });

  describe("listTickets", () => {
    it("returns tickets for a customer", async () => {
      const result = await listTickets.invoke({ customerId: "C-1002" });
      expect(result).toContain("Cannot login to dashboard");
    });
  });
});
