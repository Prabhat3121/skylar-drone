/**
 * BI Agent — Uses Groq API (OpenAI-compatible) with Llama 3.3 70B
 * Falls back gracefully on errors with user-friendly messages.
 */

const SYSTEM_PROMPT = `You are a senior Business Intelligence analyst for Skylark Drones, a drone services company.
You have access to two live data sources from monday.com:

1. **DEALS BOARD** — Sales pipeline data. Key columns:
   - Deal Name (alias/code name), Owner code, Client Code
   - Deal Status: Open, Won, Dead, On Hold
   - Closure Probability: High, Medium, Low
   - Masked Deal Value (in INR)
   - Deal Stage pipeline: A. Lead Generated → B. Sales Qualified Leads → C. Demo Done → D. Feasibility → E. Proposal/Commercials Sent → F. Negotiations → G. Project Won → H. Work Order Received → I. POC → J. Invoice sent → K. Amount Accrued → L. Project Lost → M. Projects On Hold → N/O. Not Relevant
   - Product deal, Sector/service, Created Date, Tentative Close Date

2. **WORK ORDERS BOARD** — Project execution & financial data. Key columns:
   - Deal name, Customer Code, Serial #, Nature of Work
   - Execution Status: Completed, Ongoing, Not Started, Pause/struck, Partial Completed
   - Dates: PO date, Probable Start/End, Data Delivery Date
   - Financials: Amount (Excl GST), Amount (Incl GST), Billed Value, Collected Amount, Amount Receivable
   - Sector, Type of Work, Invoice Status, WO Status, Collection status

**Key business context:**
- Sectors: Mining, Renewables, Railways, Powerline, Construction, DSP, Others, Manufacturing, Aviation, Tender, Security and Surveillance
- Products: Pure Service, Service + Spectra, Dock + DMO + Spectra + Service, Spectra Deal, Hardware, DMO
- The company provides drone survey services (topography, LiDAR, hydrology, thermography, etc.)
- Financial values are masked/scaled but proportionally accurate for analysis

**Your response guidelines:**
1. Give specific numbers, percentages, and data points
2. Format responses with clear markdown structure (headers, tables, bullet points)
3. Include **data caveats** when relevant (e.g., "Note: 15 deals have no deal value specified")
4. Provide *insights and context*, not just raw numbers
5. If a question is ambiguous, ask ONE clarifying question
6. For monetary values, format in INR lakhs/crores where appropriate (1 Cr = 10,000,000; 1 L = 100,000)
7. When asked about "pipeline", focus on Open deals in active stages (A through H)
8. Cross-reference deals and work orders when relevant
9. Keep responses concise but comprehensive

**Leadership Update Format** — When asked to prepare a leadership/board/exec update:
### 📊 Executive Summary
- Pipeline health (total value, active deal count, stage distribution)
- Key wins & closures
### 📈 Sector Performance
- Top sectors by value and volume
### 💰 Financial Health (from Work Orders)
- Total order value, billed, collected, receivable
- Collection efficiency
### ⚠️ Items Needing Attention
- Stuck/paused projects, aging deals, overdue collections
### 🎯 Recommendations
- Actionable next steps

Current date context: ${new Date().toISOString().split('T')[0]}
`;

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

export class BIAgent {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.modelIndex = 0;
        this.dataContext = '';
        this.conversationHistory = [];
    }

    setDataContext(dealsContext, workOrdersContext) {
        this.dataContext = `\n---\n**LIVE DATA FROM MONDAY.COM:**\n\n${dealsContext}\n\n${workOrdersContext}\n---\n`;
        this.conversationHistory = [];
    }

    async _callApi(messages, model) {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: model || MODELS[this.modelIndex],
                messages,
                temperature: 0.3,
                max_tokens: 4096,
            }),
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }

        return data.choices[0].message.content;
    }

    async ask(userMessage) {
        this.conversationHistory.push({ role: 'user', content: userMessage });

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT + '\n\n' + this.dataContext },
            ...this.conversationHistory,
        ];

        try {
            const reply = await this._callApi(messages);
            this.conversationHistory.push({ role: 'assistant', content: reply });
            return { success: true, message: reply };
        } catch (error) {
            const msg = error.message || '';

            // Rate limit — try fallback model
            if (msg.includes('429') || msg.includes('rate') || msg.includes('limit') || msg.includes('quota')) {
                if (this.modelIndex < MODELS.length - 1) {
                    this.modelIndex++;
                    try {
                        const reply = await this._callApi(messages);
                        this.conversationHistory.push({ role: 'assistant', content: reply });
                        return {
                            success: true,
                            message: `> *Switched to ${MODELS[this.modelIndex]} due to rate limits.*\n\n${reply}`,
                        };
                    } catch (retryErr) {
                        return {
                            success: true,
                            message: `⚠️ **Rate Limit Reached**\n\nAll models are currently rate-limited. Please wait a minute and try again.`,
                        };
                    }
                }
                return {
                    success: true,
                    message: `⚠️ **Rate Limit Reached**\n\nPlease wait a minute and try again.`,
                };
            }

            // Auth error
            if (msg.includes('401') || msg.includes('auth') || msg.includes('invalid')) {
                return {
                    success: true,
                    message: `⚠️ **Invalid API Key**\n\nPlease check your Groq API key in settings. Get a free key at [console.groq.com](https://console.groq.com).`,
                };
            }

            // Context too long
            if (msg.includes('context') || msg.includes('token') || msg.includes('length')) {
                // Retry with shorter history
                const shortMessages = [
                    messages[0],
                    messages[messages.length - 1],
                ];
                try {
                    const reply = await this._callApi(shortMessages);
                    this.conversationHistory = [
                        { role: 'user', content: userMessage },
                        { role: 'assistant', content: reply },
                    ];
                    return { success: true, message: reply };
                } catch {
                    return {
                        success: true,
                        message: `⚠️ **Error**\n\n${msg.substring(0, 200)}\n\nTry starting a new chat.`,
                    };
                }
            }

            return {
                success: true,
                message: `⚠️ **Error Processing Query**\n\n${msg.substring(0, 300)}\n\nPlease try again.`,
            };
        }
    }

    resetChat() {
        this.conversationHistory = [];
        this.modelIndex = 0;
    }
}
