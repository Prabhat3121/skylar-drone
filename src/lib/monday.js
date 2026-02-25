const MONDAY_API_URL = 'https://api.monday.com/v2';

export class MondayClient {
    constructor(apiToken) {
        this.apiToken = apiToken;
    }

    async query(graphqlQuery, variables = {}) {
        const response = await fetch(MONDAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.apiToken,
                'API-Version': '2024-10',
            },
            body: JSON.stringify({ query: graphqlQuery, variables }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Monday.com API error (${response.status}): ${text}`);
        }

        const data = await response.json();
        if (data.errors) {
            throw new Error(`Monday.com GraphQL: ${data.errors.map(e => e.message).join(', ')}`);
        }
        return data.data;
    }

    async fetchBoards() {
        const data = await this.query(`{
      boards(limit: 50) {
        id
        name
        columns { id title type }
        items_count
      }
    }`);
        return data.boards;
    }

    async fetchBoardData(boardId) {
        const firstData = await this.query(`{
      boards(ids: [${boardId}]) {
        name
        columns { id title type }
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values { id text value type }
          }
        }
      }
    }`);

        const board = firstData.boards[0];
        if (!board) throw new Error(`Board ${boardId} not found`);

        const columns = board.columns;
        let allItems = [...board.items_page.items];
        let cursor = board.items_page.cursor;

        while (cursor) {
            const nextData = await this.query(`{
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items {
            id
            name
            column_values { id text value type }
          }
        }
      }`);
            allItems = [...allItems, ...nextData.next_items_page.items];
            cursor = nextData.next_items_page.cursor;
        }

        return { name: board.name, columns, items: allItems };
    }

    async testConnection() {
        try {
            const data = await this.query(`{ me { name } }`);
            return { success: true, user: data.me.name };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}
