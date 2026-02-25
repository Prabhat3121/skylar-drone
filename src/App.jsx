import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MondayClient } from './lib/monday';
import { cleanBoardData, dataToContext } from './lib/dataCleaner';
import { BIAgent } from './lib/agent';

const SUGGESTED_QUERIES = [
    "How's our pipeline looking this quarter?",
    "What's the total deal value by sector?",
    "Show me stuck or paused work orders",
    "Prepare a leadership update",
    "Which owners have the most active deals?",
    "What's our collection efficiency?",
    "Top 10 deals by value that are still open",
    "Compare mining vs renewables performance",
];

const STORAGE_KEY = 'monday_bi_settings';

function loadSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch { }
    return {
        mondayToken: import.meta.env.VITE_MONDAY_API_TOKEN || '',
        groqKey: import.meta.env.VITE_GROQ_API_KEY || '',
        dealsBoardId: '',
        workOrdersBoardId: '',
    };
}

function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function App() {
    const [settings, setSettings] = useState(loadSettings);
    const [showSettings, setShowSettings] = useState(false);
    const [boards, setBoards] = useState([]);
    const [status, setStatus] = useState({ phase: 'init', message: '' });
    const [dealsData, setDealsData] = useState(null);
    const [workOrdersData, setWorkOrdersData] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [agent, setAgent] = useState(null);

    const chatEndRef = useRef(null);
    const inputRef = useRef(null);

    // Check if we need to show settings
    useEffect(() => {
        if (!settings.mondayToken || !settings.groqKey) {
            setShowSettings(true);
            setStatus({ phase: 'needSetup', message: 'Please configure your API keys' });
        } else if (!settings.dealsBoardId || !settings.workOrdersBoardId) {
            fetchBoards();
        } else {
            loadData();
        }
    }, []);

    // Scroll to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const fetchBoards = useCallback(async () => {
        setStatus({ phase: 'connecting', message: 'Connecting to Monday.com...' });
        try {
            const client = new MondayClient(settings.mondayToken);
            const result = await client.testConnection();
            if (!result.success) throw new Error(result.error);
            const boardList = await client.fetchBoards();
            setBoards(boardList);
            setShowSettings(true);
            setStatus({ phase: 'selectBoards', message: 'Select your boards' });
        } catch (err) {
            setStatus({ phase: 'error', message: err.message });
            setShowSettings(true);
        }
    }, [settings.mondayToken]);

    const loadData = useCallback(async () => {
        setStatus({ phase: 'loading', message: 'Fetching data from Monday.com...' });
        try {
            const client = new MondayClient(settings.mondayToken);

            setStatus({ phase: 'loading', message: 'Loading Deals board...' });
            const dealsRaw = await client.fetchBoardData(settings.dealsBoardId);
            const dealsCleaned = cleanBoardData(dealsRaw);
            setDealsData(dealsCleaned);

            setStatus({ phase: 'loading', message: 'Loading Work Orders board...' });
            const woRaw = await client.fetchBoardData(settings.workOrdersBoardId);
            const woCleaned = cleanBoardData(woRaw);
            setWorkOrdersData(woCleaned);

            // Init AI agent
            const biAgent = new BIAgent(settings.groqKey);
            biAgent.setDataContext(
                dataToContext(dealsCleaned),
                dataToContext(woCleaned)
            );
            setAgent(biAgent);

            setStatus({ phase: 'ready', message: 'Connected' });
        } catch (err) {
            setStatus({ phase: 'error', message: err.message });
        }
    }, [settings]);

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || loading || !agent) return;

        setInput('');
        const userMsg = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        try {
            const history = messages.map(m => ({ role: m.role, content: m.content }));
            const response = await agent.ask(text, []);
            if (response.success) {
                setMessages(prev => [...prev, { role: 'assistant', content: response.message }]);
            } else {
                setMessages(prev => [
                    ...prev,
                    { role: 'assistant', content: `⚠️ Error: ${response.error}\n\nPlease try again or rephrase your question.` },
                ]);
            }
        } catch (err) {
            setMessages(prev => [
                ...prev,
                { role: 'assistant', content: `⚠️ Something went wrong: ${err.message}` },
            ]);
        }
        setLoading(false);
    }, [input, loading, agent, messages]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSuggestedQuery = (query) => {
        setInput(query);
        setTimeout(() => {
            inputRef.current?.focus();
        }, 50);
    };

    const handleSettingsSave = async (newSettings) => {
        setSettings(newSettings);
        saveSettings(newSettings);
        setShowSettings(false);

        if (newSettings.dealsBoardId && newSettings.workOrdersBoardId) {
            // Reload data with new settings
            setStatus({ phase: 'loading', message: 'Fetching data from Monday.com...' });
            setMessages([]);
            setAgent(null);
            try {
                const client = new MondayClient(newSettings.mondayToken);

                setStatus({ phase: 'loading', message: 'Loading Deals board...' });
                const dealsRaw = await client.fetchBoardData(newSettings.dealsBoardId);
                const dealsCleaned = cleanBoardData(dealsRaw);
                setDealsData(dealsCleaned);

                setStatus({ phase: 'loading', message: 'Loading Work Orders board...' });
                const woRaw = await client.fetchBoardData(newSettings.workOrdersBoardId);
                const woCleaned = cleanBoardData(woRaw);
                setWorkOrdersData(woCleaned);

                const biAgent = new BIAgent(newSettings.groqKey);
                biAgent.setDataContext(
                    dataToContext(dealsCleaned),
                    dataToContext(woCleaned)
                );
                setAgent(biAgent);

                setStatus({ phase: 'ready', message: 'Connected' });
            } catch (err) {
                setStatus({ phase: 'error', message: err.message });
            }
        } else if (!newSettings.dealsBoardId || !newSettings.workOrdersBoardId) {
            // Need to select boards
            const client = new MondayClient(newSettings.mondayToken);
            try {
                const boardList = await client.fetchBoards();
                setBoards(boardList);
                setShowSettings(true);
                setStatus({ phase: 'selectBoards', message: 'Select your boards' });
            } catch (err) {
                setStatus({ phase: 'error', message: err.message });
                setShowSettings(true);
            }
        }
    };

    const handleNewChat = () => {
        setMessages([]);
        agent?.resetChat();
    };

    // Loading screen
    if (status.phase === 'loading') {
        return (
            <div className="loading-screen">
                <div className="loader" />
                <div className="loading-text">{status.message}</div>
                <div className="loading-sub">Connecting to Monday.com and processing data...</div>
            </div>
        );
    }

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header-brand">
                    <div className="header-logo">S</div>
                    <div>
                        <div className="header-title">Monday BI Agent</div>
                        <div className="header-subtitle">Skylark Drones Intelligence</div>
                    </div>
                </div>
                <div className="header-actions">
                    {messages.length > 0 && (
                        <button className="btn btn-sm" onClick={handleNewChat}>✦ New Chat</button>
                    )}
                    <button className="btn btn-icon btn-sm" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
                </div>
            </header>

            {/* Status Bar */}
            {status.phase === 'ready' && dealsData && workOrdersData && (
                <div className="status-bar">
                    <div className="status-item">
                        <span className="status-dot green" />
                        Monday.com Connected
                    </div>
                    <div className="status-item">
                        <span className="status-dot green" />
                        Deals: {dealsData.stats.cleanedRows} rows ({dealsData.stats.completeness}% complete)
                    </div>
                    <div className="status-item">
                        <span className="status-dot green" />
                        Work Orders: {workOrdersData.stats.cleanedRows} rows ({workOrdersData.stats.completeness}% complete)
                    </div>
                </div>
            )}

            {status.phase === 'error' && (
                <div className="error-banner" style={{ margin: '12px 0' }}>
                    ⚠️ {status.message}
                    <button className="btn btn-sm" onClick={() => setShowSettings(true)}>Fix Settings</button>
                </div>
            )}

            {/* Chat Area */}
            <div className="chat-area">
                {messages.length === 0 && status.phase === 'ready' ? (
                    <div className="welcome">
                        <div className="welcome-icon">🤖</div>
                        <h2>What would you like to know?</h2>
                        <p>
                            I'm connected to your Monday.com boards and ready to answer business
                            intelligence questions about your pipeline, work orders, revenue, and operations.
                        </p>
                        <div className="suggested-queries">
                            {SUGGESTED_QUERIES.map((q, i) => (
                                <button key={i} className="suggested-chip" onClick={() => handleSuggestedQuery(q)}>
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {messages.map((msg, i) => (
                            <div key={i} className="message">
                                <div className={`message-avatar ${msg.role === 'user' ? 'user' : 'ai'}`}>
                                    {msg.role === 'user' ? '👤' : '🤖'}
                                </div>
                                <div className="message-content">
                                    <div className="message-label">
                                        {msg.role === 'user' ? 'You' : 'BI Agent'}
                                    </div>
                                    <div className="message-body">
                                        {msg.role === 'user' ? (
                                            <p>{msg.content}</p>
                                        ) : (
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {msg.content}
                                            </ReactMarkdown>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="message">
                                <div className="message-avatar ai">🤖</div>
                                <div className="message-content">
                                    <div className="message-label">BI Agent</div>
                                    <div className="typing-indicator">
                                        <span /><span /><span />
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            {status.phase === 'ready' && (
                <div className="input-area">
                    <div className="input-row">
                        <div className="input-wrapper">
                            <textarea
                                ref={inputRef}
                                className="input-field"
                                placeholder="Ask about pipeline, revenue, work orders, sector performance..."
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={1}
                                disabled={loading}
                            />
                        </div>
                        <button className="send-btn" onClick={handleSend} disabled={!input.trim() || loading}>
                            ➤
                        </button>
                    </div>
                    <div className="input-hint">
                        Press Enter to send · Shift+Enter for new line
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && (
                <SettingsModal
                    settings={settings}
                    boards={boards}
                    onSave={handleSettingsSave}
                    onClose={() => {
                        if (settings.mondayToken && settings.groqKey && settings.dealsBoardId && settings.workOrdersBoardId) {
                            setShowSettings(false);
                        }
                    }}
                    onFetchBoards={async (token) => {
                        try {
                            const client = new MondayClient(token);
                            const result = await client.testConnection();
                            if (!result.success) throw new Error(result.error);
                            const boardList = await client.fetchBoards();
                            setBoards(boardList);
                            return { success: true, user: result.user };
                        } catch (err) {
                            return { success: false, error: err.message };
                        }
                    }}
                />
            )}
        </div>
    );
}

/* ============= Settings Modal Component ============= */
function SettingsModal({ settings, boards: initialBoards, onSave, onClose, onFetchBoards }) {
    const [mondayToken, setMondayToken] = useState(settings.mondayToken);
    const [groqKey, setGroqKey] = useState(settings.groqKey);
    const [dealsBoardId, setDealsBoardId] = useState(settings.dealsBoardId);
    const [workOrdersBoardId, setWorkOrdersBoardId] = useState(settings.workOrdersBoardId);
    const [boards, setBoards] = useState(initialBoards);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [step, setStep] = useState(
        initialBoards.length > 0 ? 'boards' : 'keys'
    );

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);
        const result = await onFetchBoards(mondayToken);
        setTesting(false);
        if (result.success) {
            setTestResult({ success: true, message: `Connected as ${result.user}` });
            // boards are now updated via parent
        } else {
            setTestResult({ success: false, message: result.error });
        }
    };

    // Sync boards from parent
    useEffect(() => {
        if (initialBoards.length > 0) {
            setBoards(initialBoards);
            setStep('boards');
        }
    }, [initialBoards]);

    const canSave = mondayToken && groqKey && dealsBoardId && workOrdersBoardId;

    return (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <h2>⚙️ Configuration</h2>
                <p className="modal-desc">Connect to Monday.com and configure your AI agent.</p>

                {step === 'keys' && (
                    <>
                        <div className="form-group">
                            <label className="form-label">Monday.com API Token</label>
                            <input
                                className="form-input"
                                type="password"
                                placeholder="eyJhbGciOi..."
                                value={mondayToken}
                                onChange={e => setMondayToken(e.target.value)}
                            />
                            <div className="form-help">
                                Get from: Monday.com → Avatar → Developers → My Access Tokens
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Groq API Key</label>
                            <input
                                className="form-input"
                                type="password"
                                placeholder="gsk_..."
                                value={groqKey}
                                onChange={e => setGroqKey(e.target.value)}
                            />
                            <div className="form-help">
                                Free key from: console.groq.com → API Keys
                            </div>
                        </div>

                        {testResult && (
                            <div className={`error-banner`} style={{
                                background: testResult.success ? 'rgba(16,185,129,0.08)' : undefined,
                                borderColor: testResult.success ? 'rgba(16,185,129,0.2)' : undefined,
                                color: testResult.success ? 'var(--accent-green)' : undefined,
                            }}>
                                {testResult.success ? '✓' : '✗'} {testResult.message}
                            </div>
                        )}

                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleTestConnection}
                                disabled={!mondayToken || testing}
                            >
                                {testing ? 'Testing...' : 'Connect & Fetch Boards →'}
                            </button>
                        </div>
                    </>
                )}

                {step === 'boards' && boards.length > 0 && (
                    <>
                        <div className="form-group">
                            <label className="form-label">Select Deals Board</label>
                            <div className="board-selector">
                                {boards.map(b => (
                                    <div
                                        key={`deals-${b.id}`}
                                        className={`board-option ${dealsBoardId === b.id ? 'selected' : ''}`}
                                        onClick={() => setDealsBoardId(b.id)}
                                    >
                                        <span>📊</span> {b.name}
                                        <span className="board-count">{b.items_count} items</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Select Work Orders Board</label>
                            <div className="board-selector">
                                {boards.map(b => (
                                    <div
                                        key={`wo-${b.id}`}
                                        className={`board-option ${workOrdersBoardId === b.id ? 'selected' : ''}`}
                                        onClick={() => setWorkOrdersBoardId(b.id)}
                                    >
                                        <span>📋</span> {b.name}
                                        <span className="board-count">{b.items_count} items</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button className="btn" onClick={() => setStep('keys')}>← Back</button>
                            <button
                                className="btn btn-primary"
                                disabled={!canSave}
                                onClick={() => onSave({ mondayToken, groqKey, dealsBoardId, workOrdersBoardId })}
                            >
                                Connect & Start →
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
