"use client";

import { useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterTypes, stripCounterTag, isBuiltinCounter } from "@/lib/detectCounterType";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";
import { stripDSML } from "@/lib/stripDSML";
import { stripPrefTag } from "@/lib/detectPreference";

export function useTextChat() {
    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage,
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const abortRef = useRef<AbortController | null>(null);
    const { userId } = useUser();

    const sendMessage = useCallback(
        async (userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>) => {
            // Extract display text
            let displayText: string;
            let isMultimodal = false;
            if (typeof userContent === "string") {
                displayText = userContent.trim();
                if (!displayText) return;
            } else {
                isMultimodal = true;
                const textParts = userContent.filter((p) => p.type === "text" && p.text).map((p) => p.text!);
                const imageCount = userContent.filter((p) => p.type === "image_url").length;
                displayText = textParts.join("\n") + (imageCount > 0 ? `\n📎 ${imageCount} изобр.` : "");
                if (!displayText.trim() && imageCount === 0) return;
            }

            // 1. Add user message
            const userMsg = {
                id: crypto.randomUUID(),
                role: "user" as const,
                content: displayText,
                timestamp: new Date().toISOString(),
                source: "text" as const,
            };
            addMessage(userMsg);

            // 2. Read settings
            const { aiProvider, systemPrompt, customWidgets, useLiteLLM, litellmModel, useHybridSearch } =
                useSettingsStore.getState();

            // 3. Build message history (last 50 messages for context)
            const allMessages = useChatStore.getState().messages;
            const history = allMessages.slice(-50).map((m) => ({
                role: m.role,
                content: m.content,
            }));

            // For multimodal: replace the last user message content with full parts
            if (isMultimodal && history.length > 0) {
                const lastIdx = history.length - 1;
                if (history[lastIdx].role === "user") {
                    (history[lastIdx] as Record<string, unknown>).content = userContent;
                }
            }

            // 4. Set orb to thinking
            setOrbState("thinking");

            // 5. Create assistant placeholder
            const assistantId = crypto.randomUUID();
            addMessage({
                id: assistantId,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                source: "text",
            });

            // 6. Stream response
            // Cancel any in-flight request before starting a new one
            abortRef.current?.abort();
            abortRef.current = new AbortController();

            try {
                // Phase 2: Shadow Integration — route through LiteLLM if enabled
                const chatEndpoint = useLiteLLM ? "/api/chat-lite" : "/api/chat";
                const chatBody: Record<string, unknown> = {
                    messages: history,
                    provider: aiProvider,
                    systemPrompt,
                    userId,
                    useHybridSearch,
                    customWidgetPrompts: customWidgets
                        .filter((w) => w.enabled && w.prompt)
                        .map((w) => ({ id: w.id, label: w.label, prompt: w.prompt })),
                };
                if (useLiteLLM) {
                    chatBody.litellm_model = litellmModel;
                }

                const res = await fetch(chatEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(chatBody),
                    signal: abortRef.current.signal,
                });

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({
                        error: "Unknown error",
                    }));
                    throw new Error(
                        (errBody as { error?: string }).error ??
                        `HTTP ${res.status}`,
                    );
                }

                if (!res.body) throw new Error("No response body");

                setOrbState("speaking");

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let accumulated = "";
                let streamModel = "";
                let streamPromptTokens = 0;
                let streamCompletionTokens = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");

                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const data = line.slice(6).trim();
                        if (data === "[DONE]") continue;

                        try {
                            const parsed = JSON.parse(data) as {
                                choices?: Array<{
                                    delta?: { content?: string };
                                }>;
                                model?: string;
                                usage?: {
                                    prompt_tokens?: number;
                                    completion_tokens?: number;
                                    total_tokens?: number;
                                };
                            };

                            // Track model name from first chunk
                            if (parsed.model && !streamModel) {
                                streamModel = parsed.model;
                            }

                            // Track token usage (comes in the final chunk)
                            if (parsed.usage) {
                                streamPromptTokens = parsed.usage.prompt_tokens ?? 0;
                                streamCompletionTokens = parsed.usage.completion_tokens ?? 0;
                            }

                            const content =
                                parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                accumulated += content;
                                // Strip DSML and counter tags in real-time
                                const display = stripPrefTag(stripCounterTag(stripDSML(accumulated)));
                                updateLastAssistantMessage({
                                    content: display,
                                });
                            }
                        } catch {
                            // skip unparseable SSE lines
                        }
                    }
                }

                // Report token usage to server (fire-and-forget)
                if (streamPromptTokens > 0 || streamCompletionTokens > 0) {
                    const reportModel = streamModel || (useSettingsStore.getState().aiProvider === "google" ? "gemini-2.0-flash" : "gpt-4o-mini");
                    useCountersStore.getState().reportTokenUsage(
                        userId ?? "",
                        reportModel,
                        streamPromptTokens,
                        streamCompletionTokens,
                    ).catch(() => { /* silent */ });
                }

                // Detect counter types and trigger animations
                const counterTypes = detectCounterTypes(accumulated);
                if (counterTypes.length > 0) {
                    for (const ct of counterTypes) {
                        if (isBuiltinCounter(ct)) {
                            // Built-in counter: trigger animation
                            useAnimationStore
                                .getState()
                                .triggerAnimation(ct);
                        } else {
                            // Custom widget counter: increment count
                            useSettingsStore
                                .getState()
                                .incrementCustomWidget(ct);
                        }
                    }
                    // Strip tags from displayed message
                    const cleaned = stripCounterTag(accumulated);
                    updateLastAssistantMessage({ content: cleaned });
                }

                // ── Auto-send to Obsidian (fire-and-forget) ──
                const finalText = stripDSML(
                    counterTypes.length > 0
                        ? stripCounterTag(accumulated)
                        : accumulated,
                );
                sendToObsidian(displayText.replace(/📎.*$/, "").trim() || "[Фото/документ]", finalText, userId).catch(() => {
                    /* handled inside sendToObsidian */
                });
            } catch (err) {
                if ((err as Error).name === "AbortError") {
                    logger.debug("Text chat aborted");
                    return;
                }
                logger.error(
                    "Text chat error:",
                    (err as Error).message,
                );
                useNotificationStore
                    .getState()
                    .addNotification((err as Error).message, "error");
                updateLastAssistantMessage({
                    content: `⚠️ Ошибка: ${(err as Error).message}`,
                });
            } finally {
                abortRef.current = null;
                setOrbState("idle");
            }
        },
        [addMessage, updateLastAssistantMessage, setOrbState],
    );

    const abort = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return { sendMessage, abort } as const;
}
