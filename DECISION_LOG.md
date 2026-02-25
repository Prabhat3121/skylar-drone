# Decision Log — Monday.com Business Intelligence Agent

## Key Assumptions

1. **Data Scale**: Both boards have <500 rows each. This allows sending the entire dataset as context to the LLM on each query, avoiding complex retrieval architectures. If data grows beyond ~2000 rows, a RAG/embedding-based approach would be needed.

2. **Column Mapping**: Monday.com column IDs are auto-generated on CSV import. The agent discovers columns dynamically by title rather than hardcoding IDs, making it resilient to board restructuring.

3. **Masked Values**: Financial values are proportionally accurate even though masked. The agent treats them as real for trend analysis, comparisons, and ratios — but avoids claiming exact absolute figures.

4. **Date Interpretation**: "This quarter" is interpreted relative to the current date. The agent uses the system clock, so results are always time-contextual.

## Trade-offs Chosen

| Decision | Alternative | Why |
|---|---|---|
| **Client-side architecture** (browser calls Monday.com + Gemini APIs directly) | Server-side API routes (Next.js, Express) | GitHub Pages hosting requirement = static files only. Simpler deploy, no server costs. Trade-off: API keys are in the browser bundle — acceptable for a prototype. |
| **Full-context LLM** (send all data each query) | RAG/embeddings or function-calling tools | Dataset is small (~500 rows). Full context ensures the LLM never misses relevant data and can find cross-board correlations. Simpler, more reliable. |
| **Gemini 2.0 Flash** | GPT-4o, Claude | Free tier, fast, 1M token context window fits all data comfortably. Good structured output (tables, markdown). |
| **Vite + React SPA** | Next.js, plain HTML | Fast build, modern DX, easy GitHub Pages deploy. React gives component structure without framework overhead. |
| **Dynamic board discovery** | Hardcoded board IDs | User selects boards in a settings UI. More flexible, works across accounts. |

## What I'd Do Differently With More Time

1. **Server-side proxy**: Move API calls behind an API route (Vercel/Cloudflare Workers) to protect API keys in production.
2. **Data caching**: Cache Monday.com data with TTL (5-min) to reduce API calls and improve response time.
3. **Function calling**: Use Gemini's function-calling to let the LLM request specific data slices instead of sending everything. Better for large datasets.
4. **Charts & visualizations**: Add Chart.js or Recharts for pipeline funnels, sector breakdowns, and trend lines.
5. **Export**: Let users export responses as PDF or copy-paste-ready leadership briefs.
6. **Authentication**: Add user auth so multiple team members can use the agent with role-based access.
7. **Conversation persistence**: Save chat history to localStorage or a database.

## Leadership Update Interpretation

"The agent should help prepare data for leadership updates" — I interpreted this as:

**The agent should generate executive-ready summaries on demand**, formatted for board meetings or weekly syncs. When a user asks for a "leadership update", the agent produces a structured brief covering:

- **Pipeline Health**: Active deal count, total weighted value, stage distribution
- **Key Wins**: Recently closed deals, new work orders received
- **Sector Performance**: Comparative analysis across Mining, Renewables, Railways, etc.
- **Financial Health**: Billed vs. collected, AR aging, collection efficiency
- **Risk Items**: Stuck/paused projects, aging open deals, overdue invoices
- **Recommendations**: Actionable next steps based on data patterns

The format is designed to be *copy-pasteable* into a Slack message, email, or presentation slide — reducing the time from "I need an update" to "here it is" from hours to seconds.
