# Decision Log — Monday.com BI Agent

## 1. Key Assumptions

**Data Scale & Structure**: Both boards (344 deals, 176 work orders) are small enough to summarize and send as context to the LLM. I assumed the data won't exceed ~1,000 rows in the near term, which keeps the full-context approach viable without needing RAG or embeddings.

**Masked Financial Values**: The deal values and financial figures are masked/scaled. I assumed they are *proportionally accurate* — meaning ratios, percentages, and relative comparisons (e.g., "Mining is 3x Renewables") are valid even if absolute numbers aren't real. The agent explicitly notes this caveat in responses.

**Column Discovery**: Monday.com auto-generates column IDs on CSV import. Rather than hardcoding IDs, the agent discovers columns dynamically by matching title keywords (e.g., any column containing "sector" is treated as the sector field). This makes it resilient to board restructuring.

**User Context**: I assumed the primary users are founders and leadership who want quick, executive-level answers — not raw data exports. Responses are structured as insights with caveats, not spreadsheet dumps.

**API Key Security**: For a prototype, API keys are stored client-side (in environment variables baked into the build). This is acceptable for a demo but would need a server-side proxy in production.

---

## 2. Trade-offs & Justifications

| Decision | Alternative Considered | Rationale |
|----------|----------------------|-----------|
| **Client-side SPA** (Vite + React) | Next.js with API routes | Vercel static hosting is simpler. No server needed. Trade-off: keys in bundle — acceptable for prototype. |
| **Groq API** (Llama 3.3 70B) | Gemini, OpenAI GPT-4o | Free tier with generous limits (30 RPM). Llama 3.3 70B handles structured data analysis well. Initially tried Gemini but hit quota limits immediately. |
| **Pre-aggregated context** instead of raw rows | Send all raw data to LLM | Raw data (344+176 rows × 30+ columns) exceeded Groq's 12K TPM limit. Solution: pre-compute aggregated summaries (by sector, status, stage, owner) + top 20 items. The LLM gets both the big picture and specific details. |
| **Monday.com API** (direct GraphQL) | MCP server | Direct API is simpler, fully client-side, no middleware. MCP would add server dependency. The API provides everything needed: board discovery, paginated data, column metadata. |
| **Dynamic board selection** UI | Hardcoded board IDs | Users pick which boards are "Deals" and "Work Orders" in a settings modal. Works across different Monday.com accounts without code changes. |
| **Vanilla CSS** dark theme | Tailwind, Material UI | Full design control, zero dependencies, smaller bundle. Premium glassmorphism aesthetic that matches the "founder tool" feel. |

---

## 3. What I'd Do Differently With More Time

**Server-side proxy**: Move API calls behind a backend (Vercel serverless functions) to protect API keys and enable server-side caching of Monday.com data with a 5-minute TTL — reducing API calls and improving response time.

**Function calling / Tool use**: Instead of pre-aggregating data, use the LLM's function-calling capability to let it request specific data slices on demand (e.g., "get deals where sector = Mining AND status = Open"). This would scale to much larger datasets.

**Visualizations**: Add Chart.js or Recharts for interactive pipeline funnels, sector breakdown pie charts, and trend lines over time. Visual output alongside text would be more impactful for leadership reviews.

**Conversation memory**: Persist chat history to localStorage or a database so users can resume previous analysis threads. Currently, history is lost on page refresh.

**Export functionality**: Let users export AI responses as formatted PDFs or copy-to-clipboard leadership briefs, reducing the friction from "I got the insight" to "I shared it with the team."

---

## 4. Interpreting "Leadership Updates"

The brief mentioned the agent should help "prepare data for leadership updates." I interpreted this as:

> **The agent should generate executive-ready summaries on demand** — formatted briefs that can be directly copy-pasted into a Slack message, email, or board presentation.

When a user asks "Prepare a leadership update," the agent produces a structured brief:

- **📊 Executive Summary** — Pipeline health (total value, active deal count, stage distribution, key wins)
- **📈 Sector Performance** — Comparative analysis across Mining, Renewables, Railways, etc.
- **💰 Financial Health** — Total order value vs. billed vs. collected, collection efficiency percentage
- **⚠️ Items Needing Attention** — Stuck/paused work orders, aging open deals, overdue collections
- **🎯 Recommendations** — 2-3 actionable next steps based on data patterns

The goal is reducing the time from *"I need an update for the board meeting"* to *"here it is"* — from hours of manual spreadsheet work to seconds of conversation with the agent.
