# Monday.com Business Intelligence Agent

AI-powered conversational agent that connects to your Monday.com boards and answers founder-level business intelligence queries about pipeline, revenue, work orders, and sector performance.

![Architecture](https://img.shields.io/badge/Stack-React%20%2B%20Gemini%20%2B%20Monday.com-7c3aed)

## Architecture

```
┌───────────────────────────────────────────────┐
│             Browser (React SPA)               │
│                                               │
│  Chat UI ──▶ Gemini AI Agent ──▶ Response     │
│                    │                          │
│              Data Pipeline                    │
│    Monday.com API → Clean → Normalize → LLM   │
└────────────────────┬──────────────────────────┘
                     │
              Monday.com API v2
          (Deals + Work Orders boards)
```

**Key design decisions:**
- **Client-side architecture** — Deployed as a static site on GitHub Pages. All API calls (Monday.com + Gemini) happen in the browser.
- **Full-context LLM** — Both datasets are small enough to fit in Gemini's 1M token context window, so the entire cleaned dataset is sent with each query for maximum accuracy.
- **Dynamic board discovery** — The app fetches your board list and lets you select which boards are Deals and Work Orders, no hardcoding.

## Quick Start

### Prerequisites
- Node.js 18+
- Monday.com API token
- Google Gemini API key
- Two Monday.com boards (import the provided CSVs)

### Setup

1. **Import CSVs into Monday.com:**
   - Go to Monday.com → Create new board → Import from CSV
   - Import `Deal_funnel_Data.csv` as "Deals" board
   - Import `Work_Order_Tracker_Data.csv` as "Work Orders" board

2. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd Skylark-Drones
   npm install
   ```

3. **Configure (choose one):**

   **Option A — Environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

   **Option B — In-app settings:**
   The app will prompt for API keys and board selection on first launch.

4. **Run locally:**
   ```bash
   npm run dev
   ```

5. **Open** http://localhost:5173

### Deploy to GitHub Pages

1. Push to a GitHub repository
2. Go to Settings → Secrets → Add:
   - `VITE_MONDAY_API_TOKEN` — your Monday.com token
   - `VITE_GEMINI_API_KEY` — your Gemini key
3. Go to Settings → Pages → Source: GitHub Actions
4. Push to `main` branch — the GitHub Action will build and deploy automatically

## Features

- **Natural language queries** — Ask business questions in plain English
- **Cross-board analysis** — Correlates Deals and Work Orders data
- **Data resilience** — Handles missing values, junk rows, inconsistent formats
- **Leadership updates** — Generates executive-ready briefs on demand
- **Data quality tracking** — Shows completeness metrics and caveats
- **Rich formatting** — Tables, bullet points, structured markdown responses

## Sample Queries

- "How's our pipeline looking for energy sector this quarter?"
- "What's the total deal value by sector?"
- "Show me stuck or paused work orders"
- "Prepare a leadership update"
- "Which owners have the most active deals?"
- "Compare mining vs renewables performance"

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | React 18 + Vite | Fast, modern, static build for GitHub Pages |
| LLM | Gemini 2.0 Flash | Free tier, 1M context, good structured output |
| Data Source | Monday.com GraphQL API | Dynamic querying, no hardcoded CSV data |
| Styling | Vanilla CSS | Full control, no dependencies |
| Deploy | GitHub Pages + Actions | Free hosting, CI/CD built-in |
