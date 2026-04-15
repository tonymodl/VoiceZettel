import type { CounterType } from "@/types/animation";

/**
 * Looks for classification tags in the AI response.
 * The AI is instructed to append [COUNTER:type] tags at the end of its response.
 * Example: "Записал факт и создал задачу! [COUNTER:facts] [COUNTER:tasks]"
 *
 * Returns ALL detected counter types (supports multiple per message).
 * Now returns string[] to support custom widget IDs like "cw_1713200000000".
 */

/**
 * Matches both built-in tags like [COUNTER:facts] and custom widget tags like [COUNTER:cw_1713200000000].
 * The regex accepts any word characters (letters, digits, underscores) as the counter type.
 */
const TAG_REGEX_GLOBAL = /\[COUNTER:(\w+)\]/gi;

/** Built-in counter types that trigger animations */
export const BUILTIN_COUNTER_TYPES = new Set(["ideas", "facts", "persons", "tasks"]);

/** Check if a detected counter type is a built-in one (with animation) */
export function isBuiltinCounter(type: string): type is CounterType {
    return BUILTIN_COUNTER_TYPES.has(type);
}

export function detectCounterTypes(
    assistantResponse: string,
): string[] {
    const types: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = TAG_REGEX_GLOBAL.exec(assistantResponse)) !== null) {
        types.push(match[1].toLowerCase());
    }
    // Reset lastIndex for reuse
    TAG_REGEX_GLOBAL.lastIndex = 0;
    return types;
}

/**
 * Legacy single-counter detection (for backward compat).
 */
export function detectCounterType(
    assistantResponse: string,
): CounterType | null {
    const types = detectCounterTypes(assistantResponse);
    const builtin = types.find(isBuiltinCounter);
    return builtin ?? null;
}

/**
 * Strip ALL [COUNTER:...] tags from visible text.
 */
export function stripCounterTag(text: string): string {
    return text.replace(TAG_REGEX_GLOBAL, "").trimEnd();
}
