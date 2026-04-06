# Customer Support Bot

Multi-agent customer support system with intelligent routing, specialist agents, and human escalation.

## Architecture

```mermaid
graph TD
    User([Customer]) --> Router[support_router<br/><i>supervisor</i>]

    Router -->|billing inquiry| B[billing_agent]
    Router -->|tech issue| T[tech_support_agent]
    Router -->|return request| R[returns_agent]

    B --> B1[lookup_customer]
    B --> B2[check_balance]
    B --> B3["issue_refund ⏸️"]

    T --> T1[lookup_order]
    T --> T2[search_orders]
    T --> T3[create_ticket]
    T --> T4[list_tickets]

    R --> R1[lookup_order]
    R --> R2["initiate_return ⏸️"]

    B --> E["escalate_to_human ⏸️"]
    T --> E
    R --> E

    style Router fill:#7C3AED,color:#fff
    style B fill:#3B82F6,color:#fff
    style T fill:#10B981,color:#fff
    style R fill:#F59E0B,color:#fff
```

> Tools marked with ⏸️ require human approval (HITL).

**support_router** classifies the customer's intent and delegates to:

- **billing_agent** — account lookups, balance inquiries, refunds (with HITL approval)
- **tech_support_agent** — order tracking, ticket creation, technical issues
- **returns_agent** — product returns for delivered orders (with HITL approval)

All agents can **escalate to a human operator** when the issue is too complex or the customer requests it.

## Tools

| Tool | Agent | Description |
|---|---|---|
| `lookup_customer` | Billing | Look up customer account by ID |
| `check_balance` | Billing | Check outstanding balance |
| `issue_refund` | Billing | Refund an order (requires approval) |
| `lookup_order` | Tech, Returns | Look up order by ID |
| `search_orders` | Tech, Returns | Find all orders for a customer |
| `create_ticket` | Tech | Create a support ticket |
| `list_tickets` | Tech | List tickets for a customer |
| `initiate_return` | Returns | Start a return (requires approval) |
| `escalate_to_human` | All | Escalate to human operator |

## Usage

```bash
# Billing inquiry
curl -X POST http://localhost:3000/support/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "I am customer C-1002. Why was I charged $29.99?"}]}'

# Tech support
curl -X POST http://localhost:3000/support/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "I am C-1001. Where is my order ORD-503?"}]}'

# Return request
curl -X POST http://localhost:3000/support/invoke \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "I am C-1001. I want to return order ORD-501, the headphones are too tight."}]}'
```

## Files

- `src/apps/support.ts` — Agent composition and routing
- `src/tools/support.ts` — All support tools with mock data
- `tests/tools/support.test.ts` — Tool unit tests

## Customizing

To use real data instead of mocks, replace the `CUSTOMERS`, `ORDERS`, and `TICKETS` objects in `src/tools/support.ts` with database queries or API calls.
