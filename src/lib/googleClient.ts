/**
 * @module googleClient
 * Google Workspace API client with automatic token refresh.
 * Provides direct access to Google Docs and Sheets APIs.
 */

import { promises as fs } from "fs";
import path from "path";

const TOKENS_PATH = path.join(process.cwd(), ".google", "tokens.json");

interface GoogleTokens {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_at: number;
    scope: string;
    user_email?: string;
    created_at?: string;
}

/** Read stored tokens */
async function readTokens(): Promise<GoogleTokens | null> {
    try {
        const raw = await fs.readFile(TOKENS_PATH, "utf-8");
        return JSON.parse(raw) as GoogleTokens;
    } catch {
        return null;
    }
}

/** Write tokens back to disk */
async function writeTokens(tokens: GoogleTokens): Promise<void> {
    await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
    await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

/** Refresh the access token using the refresh_token */
async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: tokens.refresh_token,
            grant_type: "refresh_token",
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token refresh failed: ${res.status} ${err}`);
    }

    const data = await res.json() as {
        access_token: string;
        expires_in: number;
        token_type: string;
        scope?: string;
    };

    const updated: GoogleTokens = {
        ...tokens,
        access_token: data.access_token,
        expires_at: Date.now() + data.expires_in * 1000,
        token_type: data.token_type,
        scope: data.scope || tokens.scope,
    };

    await writeTokens(updated);
    return updated;
}

/** Get a valid access token, refreshing if needed */
export async function getAccessToken(): Promise<string> {
    let tokens = await readTokens();
    if (!tokens) throw new Error("No Google tokens found. Run OAuth flow first.");

    // Refresh if expired or within 5 min
    if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
        tokens = await refreshAccessToken(tokens);
    }

    return tokens.access_token;
}

// ═══════════════════════════════════════════════════════════════
// Google Sheets API
// ═══════════════════════════════════════════════════════════════

export interface SheetReadResult {
    values: string[][];
    range: string;
}

/** Read a range from a Google Sheet */
export async function sheetsRead(
    spreadsheetId: string,
    range: string,
): Promise<SheetReadResult> {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sheets read error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { values?: string[][]; range: string };
    return { values: data.values || [], range: data.range };
}

/** Write values to a Google Sheet range */
export async function sheetsWrite(
    spreadsheetId: string,
    range: string,
    values: string[][],
): Promise<{ updatedCells: number }> {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets write error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { updatedCells?: number };
    return { updatedCells: data.updatedCells || 0 };
}

/** Append rows to a Google Sheet */
export async function sheetsAppend(
    spreadsheetId: string,
    range: string,
    values: string[][],
): Promise<{ updatedCells: number }> {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets append error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { updates?: { updatedCells?: number } };
    return { updatedCells: data.updates?.updatedCells || 0 };
}

/** Batch update a spreadsheet (formatting, merging, etc.) */
export async function sheetsBatchUpdate(
    spreadsheetId: string,
    requests: Record<string, unknown>[],
): Promise<void> {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
    });
    if (!res.ok) throw new Error(`Sheets batchUpdate error: ${res.status} ${await res.text()}`);
}

/** Get spreadsheet metadata (title, sheets list) */
export async function sheetsGetInfo(spreadsheetId: string): Promise<{
    title: string;
    sheets: Array<{ title: string; sheetId: number; rowCount: number; columnCount: number }>;
}> {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sheets info error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
        properties: { title: string };
        sheets: Array<{
            properties: { title: string; sheetId: number; gridProperties: { rowCount: number; columnCount: number } };
        }>;
    };
    return {
        title: data.properties.title,
        sheets: data.sheets.map((s) => ({
            title: s.properties.title,
            sheetId: s.properties.sheetId,
            rowCount: s.properties.gridProperties.rowCount,
            columnCount: s.properties.gridProperties.columnCount,
        })),
    };
}

// ═══════════════════════════════════════════════════════════════
// Google Docs API
// ═══════════════════════════════════════════════════════════════

/** Get the full content of a Google Doc */
export async function docsRead(documentId: string): Promise<{ title: string; body: string }> {
    const token = await getAccessToken();
    const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Docs read error: ${res.status} ${await res.text()}`);

    const doc = await res.json() as {
        title: string;
        body: {
            content: Array<{
                paragraph?: {
                    elements: Array<{
                        textRun?: { content: string };
                    }>;
                };
            }>;
        };
    };

    // Extract plain text from structured body
    const paragraphs: string[] = [];
    for (const item of doc.body.content) {
        if (item.paragraph) {
            const text = item.paragraph.elements
                .map((el) => el.textRun?.content || "")
                .join("");
            paragraphs.push(text);
        }
    }

    return { title: doc.title, body: paragraphs.join("") };
}

/** Insert text at end of a Google Doc */
export async function docsInsertText(
    documentId: string,
    text: string,
    index?: number,
): Promise<void> {
    const token = await getAccessToken();
    const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;

    // If no index specified, get document to find end
    let insertIndex = index;
    if (insertIndex === undefined) {
        const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}?fields=body.content`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!docRes.ok) throw new Error(`Docs read error: ${docRes.status}`);
        const doc = await docRes.json() as {
            body: { content: Array<{ endIndex?: number }> };
        };
        const lastElement = doc.body.content[doc.body.content.length - 1];
        insertIndex = (lastElement?.endIndex || 2) - 1;
    }

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            requests: [
                {
                    insertText: {
                        location: { index: insertIndex },
                        text,
                    },
                },
            ],
        }),
    });
    if (!res.ok) throw new Error(`Docs insert error: ${res.status} ${await res.text()}`);
}

/** Replace text in a Google Doc */
export async function docsReplaceText(
    documentId: string,
    find: string,
    replaceWith: string,
): Promise<{ occurrencesChanged: number }> {
    const token = await getAccessToken();
    const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            requests: [
                {
                    replaceAllText: {
                        containsText: { text: find, matchCase: false },
                        replaceText: replaceWith,
                    },
                },
            ],
        }),
    });
    if (!res.ok) throw new Error(`Docs replace error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
        replies: Array<{ replaceAllText?: { occurrencesChanged: number } }>;
    };
    return { occurrencesChanged: data.replies[0]?.replaceAllText?.occurrencesChanged || 0 };
}

// ═══════════════════════════════════════════════════════════════
// Google Drive API (helper)
// ═══════════════════════════════════════════════════════════════

/** List recent Google Docs/Sheets files */
export async function driveListFiles(
    query?: string,
    maxResults = 10,
): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>> {
    const token = await getAccessToken();
    const q = query
        ? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`
        : "(mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet') and trashed = false";
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
        files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>;
    };
    return data.files || [];
}

/** Create a new Google Document */
export async function driveCreateDoc(
    title: string,
    initialContent?: string,
): Promise<{ id: string; name: string; url: string }> {
    const token = await getAccessToken();

    // Create empty doc via Drive API
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: title,
            mimeType: "application/vnd.google-apps.document",
        }),
    });
    if (!createRes.ok) throw new Error(`Drive create doc error: ${createRes.status} ${await createRes.text()}`);
    const file = await createRes.json() as { id: string; name: string };

    // If initial content provided, insert it
    if (initialContent) {
        await docsInsertText(file.id, initialContent, 1);
    }

    return {
        id: file.id,
        name: file.name,
        url: `https://docs.google.com/document/d/${file.id}/edit`,
    };
}

/** Create a new Google Spreadsheet */
export async function driveCreateSheet(
    title: string,
    initialData?: string[][],
): Promise<{ id: string; name: string; url: string }> {
    const token = await getAccessToken();

    // Create via Sheets API (gives us a spreadsheet directly)
    const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            properties: { title },
        }),
    });
    if (!createRes.ok) throw new Error(`Sheets create error: ${createRes.status} ${await createRes.text()}`);
    const sheet = await createRes.json() as { spreadsheetId: string; properties: { title: string }; spreadsheetUrl: string };

    // If initial data provided, write it
    if (initialData && initialData.length > 0) {
        await sheetsWrite(sheet.spreadsheetId, "A1", initialData);
    }

    return {
        id: sheet.spreadsheetId,
        name: sheet.properties.title,
        url: sheet.spreadsheetUrl,
    };
}

// ═══════════════════════════════════════════════════════════════
// Google Calendar API
// ═══════════════════════════════════════════════════════════════

export interface CalendarEvent {
    id: string;
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    status?: string;
    htmlLink?: string;
    attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
    recurrence?: string[];
    reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
    conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
}

export interface CalendarListResult {
    events: CalendarEvent[];
    nextPageToken?: string;
    summary: string;
    timeZone: string;
}

/** List events from a calendar (default: primary) */
export async function calendarListEvents(
    opts: {
        calendarId?: string;
        timeMin?: string;
        timeMax?: string;
        maxResults?: number;
        q?: string;
        singleEvents?: boolean;
        orderBy?: string;
    } = {},
): Promise<CalendarListResult> {
    const token = await getAccessToken();
    const calendarId = opts.calendarId || "primary";
    const params = new URLSearchParams();

    // Default: show events from now, expanding recurring events
    if (opts.timeMin) params.set("timeMin", opts.timeMin);
    else params.set("timeMin", new Date().toISOString());

    if (opts.timeMax) params.set("timeMax", opts.timeMax);
    if (opts.q) params.set("q", opts.q);
    params.set("maxResults", String(opts.maxResults || 20));
    params.set("singleEvents", String(opts.singleEvents ?? true));
    params.set("orderBy", opts.orderBy || "startTime");

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Calendar list error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
        items?: CalendarEvent[];
        nextPageToken?: string;
        summary: string;
        timeZone: string;
    };
    return {
        events: data.items || [],
        nextPageToken: data.nextPageToken,
        summary: data.summary,
        timeZone: data.timeZone,
    };
}

/** Get a single calendar event */
export async function calendarGetEvent(
    eventId: string,
    calendarId = "primary",
): Promise<CalendarEvent> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Calendar get error: ${res.status} ${await res.text()}`);
    return await res.json() as CalendarEvent;
}

/** Create a new calendar event */
export async function calendarCreateEvent(
    event: {
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        attendees?: Array<{ email: string }>;
        reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
        recurrence?: string[];
    },
    calendarId = "primary",
    sendUpdates: "all" | "externalOnly" | "none" = "all",
): Promise<CalendarEvent> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}&conferenceDataVersion=1`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Calendar create error: ${res.status} ${await res.text()}`);
    return await res.json() as CalendarEvent;
}

/** Update an existing calendar event (partial patch) */
export async function calendarUpdateEvent(
    eventId: string,
    updates: {
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string; timeZone?: string };
        end?: { dateTime?: string; date?: string; timeZone?: string };
        attendees?: Array<{ email: string }>;
        reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
        status?: string;
    },
    calendarId = "primary",
    sendUpdates: "all" | "externalOnly" | "none" = "all",
): Promise<CalendarEvent> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`;
    const res = await fetch(url, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Calendar update error: ${res.status} ${await res.text()}`);
    return await res.json() as CalendarEvent;
}

/** Delete a calendar event */
export async function calendarDeleteEvent(
    eventId: string,
    calendarId = "primary",
    sendUpdates: "all" | "externalOnly" | "none" = "all",
): Promise<void> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`;
    const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 410) {
        throw new Error(`Calendar delete error: ${res.status} ${await res.text()}`);
    }
}

/** Quick-add an event using natural language (Google parses the text) */
export async function calendarQuickAdd(
    text: string,
    calendarId = "primary",
    sendUpdates: "all" | "externalOnly" | "none" = "none",
): Promise<CalendarEvent> {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?text=${encodeURIComponent(text)}&sendUpdates=${sendUpdates}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Calendar quickAdd error: ${res.status} ${await res.text()}`);
    return await res.json() as CalendarEvent;
}

/** List available calendars for the user */
export async function calendarListCalendars(): Promise<Array<{
    id: string;
    summary: string;
    primary?: boolean;
    timeZone: string;
    accessRole: string;
}>> {
    const token = await getAccessToken();
    const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Calendar list calendars error: ${res.status} ${await res.text()}`);
    const data = await res.json() as {
        items: Array<{
            id: string;
            summary: string;
            primary?: boolean;
            timeZone: string;
            accessRole: string;
        }>;
    };
    return data.items || [];
}
