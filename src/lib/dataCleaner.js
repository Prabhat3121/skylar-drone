/**
 * Data Cleaner — handles messy data from Monday.com boards
 * Normalizes dates, numbers, text fields, and filters out junk rows.
 */

export function cleanBoardData(boardData) {
    const { name, columns, items } = boardData;
    const qualityIssues = [];
    let removedRows = 0;

    // Build column title map (id -> title)
    const colMap = {};
    columns.forEach(c => {
        colMap[c.id] = c.title;
    });

    // Convert items to flat objects
    const rows = items.map(item => {
        const row = { _id: item.id, _name: item.name };
        item.column_values.forEach(cv => {
            const title = colMap[cv.id] || cv.id;
            row[title] = cleanValue(cv.text, title);
        });
        return row;
    });

    // Filter out embedded header rows, empty rows, junk
    const cleaned = rows.filter(row => {
        // Remove if item name is empty and all col values are empty
        const vals = Object.entries(row).filter(([k]) => !k.startsWith('_'));
        const allEmpty = vals.every(([, v]) => v === null || v === '' || v === undefined);
        if (!row._name && allEmpty) {
            removedRows++;
            return false;
        }
        // Remove embedded header rows (where a value matches the column header)
        const isHeader = vals.some(([k, v]) =>
            typeof v === 'string' && v === k
        );
        if (isHeader) {
            removedRows++;
            qualityIssues.push(`Removed embedded header row (item: "${row._name || 'empty'}")`);
            return false;
        }
        return true;
    });

    // Analyse data quality
    const totalFields = cleaned.length * Object.keys(colMap).length;
    let missingFields = 0;
    cleaned.forEach(row => {
        Object.entries(row).forEach(([k, v]) => {
            if (!k.startsWith('_') && (v === null || v === '' || v === undefined)) {
                missingFields++;
            }
        });
    });

    if (removedRows > 0)
        qualityIssues.push(`Removed ${removedRows} junk/empty/header rows`);
    if (missingFields > 0)
        qualityIssues.push(`${missingFields} of ${totalFields} field values are missing/null (${((missingFields / totalFields) * 100).toFixed(1)}%)`);

    return {
        boardName: name,
        columns: columns.map(c => c.title).filter(t => t !== 'Name'),
        data: cleaned,
        stats: {
            totalRows: items.length,
            cleanedRows: cleaned.length,
            removedRows,
            missingFields,
            totalFields,
            completeness: totalFields ? ((1 - missingFields / totalFields) * 100).toFixed(1) : '100',
        },
        qualityIssues,
    };
}

function cleanValue(text, columnTitle) {
    if (text === null || text === undefined || text === '') return null;
    if (text === '#VALUE!') return null;

    const t = text.trim();
    if (t === '') return null;

    // Normalise common date formats
    const lower = columnTitle.toLowerCase();
    if (lower.includes('date')) {
        return normalizeDate(t);
    }

    // Normalise currency / numeric values
    if (
        lower.includes('amount') ||
        lower.includes('value') ||
        lower.includes('billed') ||
        lower.includes('collected') ||
        lower.includes('receivable')
    ) {
        return normalizeNumber(t);
    }

    return t;
}

function normalizeDate(str) {
    if (!str) return null;
    // Already ISO-ish: 2025-01-15
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    // MM/DD/YYYY
    const mdy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    return str;
}

function normalizeNumber(str) {
    if (!str) return null;
    // Remove commas and currency symbols
    const cleaned = str.replace(/[₹$,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? str : num.toString();
}

/**
 * Converts cleaned data to a COMPACT context string for LLM.
 * Uses aggregated summaries + compact row format to fit Groq's context limit.
 */
export function dataToContext(cleanedBoard) {
    const { boardName, data, stats, qualityIssues } = cleanedBoard;
    if (!data.length) return `## ${boardName}\nNo data available.\n`;

    let ctx = `## ${boardName} (${stats.cleanedRows} rows, ${stats.completeness}% complete)\n`;
    if (qualityIssues.length)
        ctx += `Data notes: ${qualityIssues.join('; ')}\n`;

    // Detect board type by columns
    const allKeys = Object.keys(data[0]).filter(k => !k.startsWith('_'));
    const isDeals = allKeys.some(k => k.toLowerCase().includes('deal') || k.toLowerCase().includes('closure') || k.toLowerCase().includes('deal stage'));
    const isWorkOrders = allKeys.some(k => k.toLowerCase().includes('execution') || k.toLowerCase().includes('billed') || k.toLowerCase().includes('serial'));

    if (isDeals) {
        ctx += buildDealsSummary(data, allKeys);
    } else if (isWorkOrders) {
        ctx += buildWorkOrdersSummary(data, allKeys);
    } else {
        // Generic: send compact rows with key columns only
        ctx += buildGenericCompact(data, allKeys);
    }

    return ctx;
}

function findCol(keys, ...patterns) {
    return keys.find(k => patterns.some(p => k.toLowerCase().includes(p))) || null;
}

function groupBy(data, key) {
    const groups = {};
    data.forEach(row => {
        const val = row[key] || row._name || 'Unknown';
        if (!groups[val]) groups[val] = [];
        groups[val].push(row);
    });
    return groups;
}

function sumField(rows, key) {
    if (!key) return 0;
    return rows.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);
}

function buildDealsSummary(data, keys) {
    let out = '\n### AGGREGATED SUMMARY\n';

    const statusCol = findCol(keys, 'deal status', 'status');
    const valueCol = findCol(keys, 'masked deal', 'deal value', 'value');
    const sectorCol = findCol(keys, 'sector');
    const stageCol = findCol(keys, 'deal stage', 'stage');
    const ownerCol = findCol(keys, 'owner');
    const probCol = findCol(keys, 'probability', 'closure prob');
    const tentDateCol = findCol(keys, 'tentative close', 'tentative');
    const createdCol = findCol(keys, 'created');
    const clientCol = findCol(keys, 'client');
    const productCol = findCol(keys, 'product');

    // By status
    if (statusCol) {
        out += '\n**By Deal Status:**\n';
        const byStatus = groupBy(data, statusCol);
        Object.entries(byStatus).forEach(([status, rows]) => {
            const total = sumField(rows, valueCol);
            out += `- ${status}: ${rows.length} deals, total value: ₹${formatNum(total)}\n`;
        });
    }

    // By sector
    if (sectorCol) {
        out += '\n**By Sector:**\n';
        const bySector = groupBy(data, sectorCol);
        Object.entries(bySector).sort((a, b) => b[1].length - a[1].length).forEach(([sector, rows]) => {
            const total = sumField(rows, valueCol);
            out += `- ${sector}: ${rows.length} deals, value: ₹${formatNum(total)}\n`;
        });
    }

    // By stage
    if (stageCol) {
        out += '\n**By Deal Stage:**\n';
        const byStage = groupBy(data, stageCol);
        Object.entries(byStage).sort((a, b) => a[0].localeCompare(b[0])).forEach(([stage, rows]) => {
            const total = sumField(rows, valueCol);
            out += `- ${stage}: ${rows.length} deals, value: ₹${formatNum(total)}\n`;
        });
    }

    // By owner
    if (ownerCol) {
        out += '\n**By Owner:**\n';
        const byOwner = groupBy(data, ownerCol);
        Object.entries(byOwner).sort((a, b) => b[1].length - a[1].length).forEach(([owner, rows]) => {
            const total = sumField(rows, valueCol);
            out += `- ${owner}: ${rows.length} deals, value: ₹${formatNum(total)}\n`;
        });
    }

    // By probability
    if (probCol) {
        out += '\n**By Closure Probability:**\n';
        const byProb = groupBy(data, probCol);
        Object.entries(byProb).forEach(([prob, rows]) => {
            const total = sumField(rows, valueCol);
            out += `- ${prob || 'Not set'}: ${rows.length} deals, value: ₹${formatNum(total)}\n`;
        });
    }

    // Top deals only (sorted by value)
    out += '\n### TOP 20 DEALS BY VALUE\n';
    const cols = [statusCol, valueCol, sectorCol, stageCol, ownerCol, probCol].filter(Boolean);
    out += `Name | ${cols.join(' | ')}\n`;
    const sorted = [...data].sort((a, b) => (parseFloat(b[valueCol]) || 0) - (parseFloat(a[valueCol]) || 0));
    sorted.slice(0, 20).forEach(row => {
        const vals = cols.map(c => (row[c] ?? '-'));
        out += `${row._name || '-'} | ${vals.join(' | ')}\n`;
    });

    return out;
}

function buildWorkOrdersSummary(data, keys) {
    let out = '\n### AGGREGATED SUMMARY\n';

    const execCol = findCol(keys, 'execution status', 'execution');
    const amtExcl = findCol(keys, 'amount in rupees (excl', 'amount.*excl');
    const amtIncl = findCol(keys, 'amount in rupees (incl', 'amount.*incl');
    const billedExcl = findCol(keys, 'billed value in rupees (excl', 'billed.*excl');
    const billedIncl = findCol(keys, 'billed value in rupees (incl', 'billed.*incl');
    const collectedCol = findCol(keys, 'collected amount', 'collected');
    const receivableCol = findCol(keys, 'amount receivable', 'receivable');
    const sectorCol = findCol(keys, 'sector');
    const typeCol = findCol(keys, 'type of work');
    const ownerCol = findCol(keys, 'bd/kam', 'personnel');
    const natureCol = findCol(keys, 'nature of work', 'nature');
    const customerCol = findCol(keys, 'customer');
    const serialCol = findCol(keys, 'serial');
    const woStatusCol = findCol(keys, 'wo status');
    const billingStatusCol = findCol(keys, 'billing status');
    const datePoCol = findCol(keys, 'date of po', 'po/loi');

    // Financial totals
    const totalAmt = sumField(data, amtExcl);
    const totalBilled = sumField(data, billedExcl);
    const totalCollected = sumField(data, collectedCol);
    const totalReceivable = sumField(data, receivableCol);
    out += `\n**Financial Overview:**\n`;
    out += `- Total Order Value (Excl GST): ₹${formatNum(totalAmt)}\n`;
    out += `- Total Billed (Excl GST): ₹${formatNum(totalBilled)}\n`;
    out += `- Total Collected: ₹${formatNum(totalCollected)}\n`;
    out += `- Total Receivable: ₹${formatNum(totalReceivable)}\n`;
    if (totalBilled > 0) out += `- Collection Rate: ${((totalCollected / totalBilled) * 100).toFixed(1)}%\n`;
    if (totalAmt > 0) out += `- Billing Rate: ${((totalBilled / totalAmt) * 100).toFixed(1)}%\n`;

    // By execution status
    if (execCol) {
        out += '\n**By Execution Status:**\n';
        const byExec = groupBy(data, execCol);
        Object.entries(byExec).forEach(([status, rows]) => {
            out += `- ${status}: ${rows.length} WOs, value: ₹${formatNum(sumField(rows, amtExcl))}\n`;
        });
    }

    // By sector
    if (sectorCol) {
        out += '\n**By Sector:**\n';
        const bySector = groupBy(data, sectorCol);
        Object.entries(bySector).sort((a, b) => b[1].length - a[1].length).forEach(([sector, rows]) => {
            out += `- ${sector}: ${rows.length} WOs, value: ₹${formatNum(sumField(rows, amtExcl))}, collected: ₹${formatNum(sumField(rows, collectedCol))}\n`;
        });
    }

    // Top work orders (sorted by amount)
    out += '\n### TOP 20 WORK ORDERS BY VALUE\n';
    const cols = [customerCol, natureCol, execCol, sectorCol, amtExcl, collectedCol, receivableCol].filter(Boolean);
    out += `Name | ${cols.join(' | ')}\n`;
    const sorted = [...data].sort((a, b) => (parseFloat(b[amtExcl]) || 0) - (parseFloat(a[amtExcl]) || 0));
    sorted.slice(0, 20).forEach(row => {
        const vals = cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return '-';
            const num = parseFloat(v);
            if (!isNaN(num) && num > 1000) return formatNum(num);
            return v;
        });
        out += `${row._name || '-'} | ${vals.join(' | ')}\n`;
    });

    return out;
}

function buildGenericCompact(data, keys) {
    let out = '\n### DATA\n';
    out += `Name | ${keys.slice(0, 8).join(' | ')}\n`;
    data.forEach(row => {
        const vals = keys.slice(0, 8).map(k => (row[k] ?? '-'));
        out += `${row._name || '-'} | ${vals.join(' | ')}\n`;
    });
    return out;
}

function formatNum(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
    if (n >= 100000) return (n / 100000).toFixed(2) + ' L';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toFixed(0);
}

