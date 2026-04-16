import type { WidgetEffectConfig } from "@/types/animation";

// ── Counter store types ─────────────────────────────────────
export interface CountersState {
    ideas: number;
    facts: number;
    persons: number;
    tasks: number;
    tokensUsd: number;
    tokensRub: number;
    tokensBalance: number;
    openaiBalanceUsd: number;
    openaiBalanceRub: number;
    openaiBalanceError: string | null;
}

export interface CountersActions {
    incrementIdeas: () => void;
    incrementFacts: () => void;
    incrementPersons: () => void;
    incrementTasks: () => void;
    setTokensUsd: (value: number) => void;
    setTokensRub: (value: number) => void;
    setTokensBalance: (value: number) => void;
    addTokensUsed: (count: number) => void;
    /** Load persisted token totals from server */
    loadTokensFromServer: (userId: string) => Promise<void>;
    /** Report usage to server and update local state */
    reportTokenUsage: (userId: string, model: string, textIn: number, textOut: number, audioIn?: number, audioOut?: number) => Promise<void>;
    /** Fetch real OpenAI account balance */
    loadOpenAIBalance: () => Promise<void>;
}

// ── Custom Widget ───────────────────────────────────────────
export interface CustomWidget {
    id: string;
    iconName: string;
    label: string;
    prompt: string;
    enabled: boolean;
    count: number;
}

// ── Sync Sources ────────────────────────────────────────────
export type SyncSourceId = "zettelkasten" | "telegram" | "voice_sessions" | "obsidian";

export interface SyncSources {
    zettelkasten: boolean;
    telegram: boolean;
    voice_sessions: boolean;
    obsidian: boolean;
}

// ── Settings store types ────────────────────────────────────
export type AiProvider = "openai" | "google" | "deepseek";
export type TtsProvider = "browser" | "edge" | "yandex" | "openai" | "local" | "piper" | "qwen";
export type VoiceMode = "cloud" | "local" | "browser" | "yandex" | "gemini-live";

export interface SettingsState {
    showUsdTokens: boolean;
    showRubTokens: boolean;
    showTokenBalance: boolean;
    showOpenAIBalance: boolean;
    showIdeasCounter: boolean;
    showFactsCounter: boolean;
    showPersonsCounter: boolean;
    showTasksCounter: boolean;
    customWidgets: CustomWidget[];
    syncSources: SyncSources;
    orbParticles: number;
    systemPrompt: string;
    zettelkastenPrompt: string;
    aiProvider: AiProvider;
    aiVoiceEnabled: boolean;
    ttsProvider: TtsProvider;
    edgeTtsVoice: string;
    localTtsVoice: string;
    piperTtsVoice: string;
    obsidianApiKey: string;
    obsidianApiUrl: string;
    voiceMode: VoiceMode;
    lavMode: boolean;
    widgetEffects: WidgetEffectConfig[];
    /** Antigravity: время удержания фонового микрофона и кеша токенов (минуты) */
    prewarmTimeoutMinutes: number;
    // ── Phase 2: Shadow Integration feature flags ────────────
    /** LiteLLM: экспериментальный шлюз 100+ моделей */
    useLiteLLM: boolean;
    /** LiteLLM: выбранная модель */
    litellmModel: string;
    /** Гибридный поиск: BM25 + ChromaDB через RRF */
    useHybridSearch: boolean;
    /** Deep Agent: LangChain агент для обогащения заметок */
    useDeepAgent: boolean;
}

export interface SettingsActions {
    toggleShowUsdTokens: () => void;
    toggleShowRubTokens: () => void;
    toggleShowTokenBalance: () => void;
    toggleShowOpenAIBalance: () => void;
    toggleShowIdeasCounter: () => void;
    toggleShowFactsCounter: () => void;
    toggleShowPersonsCounter: () => void;
    toggleShowTasksCounter: () => void;
    addCustomWidget: (widget: Omit<CustomWidget, "id" | "count">) => void;
    removeCustomWidget: (id: string) => void;
    toggleCustomWidget: (id: string) => void;
    incrementCustomWidget: (id: string) => void;
    toggleSyncSource: (source: SyncSourceId) => void;
    setOrbParticles: (value: number) => void;
    setSystemPrompt: (value: string) => void;
    setZettelkastenPrompt: (value: string) => void;
    setAiProvider: (provider: AiProvider) => void;
    toggleAiVoiceEnabled: () => void;
    setTtsProvider: (provider: TtsProvider) => void;
    setEdgeTtsVoice: (voice: string) => void;
    setLocalTtsVoice: (voice: string) => void;
    setPiperTtsVoice: (voice: string) => void;
    setObsidianApiKey: (key: string) => void;
    setObsidianApiUrl: (url: string) => void;
    setVoiceMode: (mode: VoiceMode) => void;
    toggleLavMode: () => void;
    setWidgetEffect: (config: WidgetEffectConfig) => void;
    setPrewarmTimeoutMinutes: (minutes: number) => void;
    // ── Phase 2: Shadow Integration actions ──────────────────
    toggleUseLiteLLM: () => void;
    setLitellmModel: (model: string) => void;
    toggleHybridSearch: () => void;
    toggleDeepAgent: () => void;
}
