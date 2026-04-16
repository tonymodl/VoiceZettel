/**
 * @module /api/tts-gemini
 * Gemini TTS endpoint — uses Google's Gemini API to synthesize speech.
 * Same high-quality voices as Gemini Live (Aoede, Charon, Fenrir, Kore, Puck).
 * Returns audio/wav blob.
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;

// Mapping of voice names
const VALID_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Puck", "Enceladus", "Iapetus", "Umbriel"];

interface TtsGeminiRequest {
    text: string;
    voice?: string;
}

export async function POST(req: NextRequest) {
    if (!GEMINI_API_KEY) {
        return NextResponse.json(
            { error: "GOOGLE_GEMINI_API_KEY not configured" },
            { status: 503 },
        );
    }

    let body: TtsGeminiRequest;
    try {
        body = await req.json() as TtsGeminiRequest;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { text, voice = "Aoede" } = body;
    if (!text || text.trim().length < 1) {
        return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const selectedVoice = VALID_VOICES.includes(voice) ? voice : "Aoede";

    try {
        const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: text.trim() }],
                }],
                generationConfig: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: {
                                voice_name: selectedVoice,
                            },
                        },
                    },
                },
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            logger.error(`[TTS-Gemini] API error ${res.status}: ${errText.slice(0, 200)}`);
            return NextResponse.json(
                { error: `Gemini API error: ${res.status}` },
                { status: 502 },
            );
        }

        const data = await res.json() as {
            candidates?: Array<{
                content?: {
                    parts?: Array<{
                        inlineData?: {
                            mimeType: string;
                            data: string;
                        };
                    }>;
                };
            }>;
        };

        // Extract audio from response
        const parts = data.candidates?.[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            logger.error("[TTS-Gemini] No parts in response");
            return NextResponse.json({ error: "No audio in response" }, { status: 502 });
        }

        const audioPart = parts.find(p => p.inlineData?.mimeType?.startsWith("audio/"));
        if (!audioPart?.inlineData) {
            logger.error("[TTS-Gemini] No audio part found in response");
            return NextResponse.json({ error: "No audio data" }, { status: 502 });
        }

        // Decode base64 audio
        const audioBytes = Buffer.from(audioPart.inlineData.data, "base64");
        const mimeType = audioPart.inlineData.mimeType;

        // If PCM, wrap in WAV header; otherwise return as-is
        if (mimeType.includes("pcm") || mimeType.includes("raw")) {
            // PCM L16, 24kHz, mono → WAV
            const wavBuffer = pcmToWav(audioBytes, 24000, 1, 16);
            return new NextResponse(new Uint8Array(wavBuffer), {
                headers: {
                    "Content-Type": "audio/wav",
                    "Content-Length": String(wavBuffer.byteLength),
                },
            });
        }

        // Return audio as-is (wav, mp3, etc.)
        return new NextResponse(audioBytes, {
            headers: {
                "Content-Type": mimeType,
                "Content-Length": String(audioBytes.byteLength),
            },
        });
    } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
            logger.error("[TTS-Gemini] Request timeout (15s)");
            return NextResponse.json({ error: "Timeout" }, { status: 504 });
        }
        logger.error("[TTS-Gemini] Error:", err instanceof Error ? err.message : String(err));
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}

/** Convert raw PCM bytes to WAV format */
function pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const dataSize = pcmData.byteLength;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);          // chunk size
    buffer.writeUInt16LE(1, 20);           // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 30);
    buffer.writeUInt16LE(bitsPerSample, 32);

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmData.copy(buffer, 44);

    return buffer;
}
