/**
 * @module timezone
 * UTC+7 (Asia/Bangkok) timezone utilities for VoiceZettel.
 * 
 * ALL time operations in the system MUST use these helpers
 * instead of raw `new Date()` / `toISOString()` to ensure
 * consistent UTC+7 throughout the application.
 */

const TZ = "Asia/Barnaul";

/**
 * Get current date/time formatted for the system prompt.
 * Example: "четверг, 17 апреля 2026 г., 16:31"
 */
export function formatBangkokNow(): string {
    return new Intl.DateTimeFormat("ru-RU", {
        timeZone: TZ,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date());
}

/**
 * Format a date in Bangkok timezone with custom options.
 */
export function formatBangkok(
    date: Date,
    options?: Intl.DateTimeFormatOptions,
): string {
    return new Intl.DateTimeFormat("ru-RU", {
        timeZone: TZ,
        ...options,
    }).format(date);
}

/**
 * Get today's date string in YYYY-MM-DD format, Bangkok timezone.
 */
export function getBangkokToday(): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const y = parts.find(p => p.type === "year")?.value ?? "2026";
    const m = parts.find(p => p.type === "month")?.value ?? "01";
    const d = parts.find(p => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
}

/**
 * Get yesterday's date string in YYYY-MM-DD format, Bangkok timezone.
 */
export function getBangkokYesterday(): string {
    const yesterday = new Date(Date.now() - 86_400_000);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(yesterday);

    const y = parts.find(p => p.type === "year")?.value ?? "2026";
    const m = parts.find(p => p.type === "month")?.value ?? "01";
    const d = parts.find(p => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
}

/**
 * Get current hour in Bangkok timezone (0-23).
 */
export function getBangkokHour(): number {
    const hourStr = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "numeric",
        hour12: false,
    }).format(new Date());
    return parseInt(hourStr, 10);
}

/**
 * Get ISO string with +07:00 offset for Bangkok timezone.
 */
export function toBangkokISO(date?: Date): string {
    const d = date ?? new Date();
    // Shift to UTC+7
    const bangkokMs = d.getTime() + 7 * 60 * 60 * 1000;
    const shifted = new Date(bangkokMs);
    return shifted.toISOString().replace("Z", "+07:00");
}
