"""
transcriber.py — Voice message transcription using OpenAI Whisper API.

Downloads voice messages via Telethon, sends to OpenAI Whisper for transcription.
Falls back to a placeholder if API key is missing.
"""

import os
import logging
import tempfile
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("transcriber")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"


class Transcriber:
    """Transcribe voice messages using OpenAI Whisper API."""

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or OPENAI_API_KEY
        self._enabled = bool(self._api_key)
        self._stats = {"transcribed": 0, "errors": 0, "skipped": 0}

        if not self._enabled:
            logger.warning("OPENAI_API_KEY not set — voice transcription disabled")
        else:
            logger.info("Transcriber initialized with OpenAI Whisper API")

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    @property
    def stats(self) -> dict:
        return {**self._stats, "enabled": self._enabled}

    async def transcribe_file(self, file_path: str, language: str = "ru") -> Optional[str]:
        """
        Transcribe an audio file using OpenAI Whisper API.
        
        Args:
            file_path: Path to audio file (ogg, mp3, wav, etc.)
            language: Language hint for Whisper (default: Russian)
            
        Returns:
            Transcription text or None on failure.
        """
        if not self._enabled:
            self._stats["skipped"] += 1
            return None

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                with open(file_path, "rb") as f:
                    files = {"file": (Path(file_path).name, f, "audio/ogg")}
                    data = {
                        "model": "whisper-1",
                        "language": language,
                        "response_format": "text",
                    }
                    
                    response = await client.post(
                        OPENAI_WHISPER_URL,
                        headers={"Authorization": f"Bearer {self._api_key}"},
                        files=files,
                        data=data,
                    )

                    if response.status_code == 200:
                        text = response.text.strip()
                        self._stats["transcribed"] += 1
                        logger.debug(f"Transcribed: {text[:60]}...")
                        return text
                    else:
                        logger.error(f"Whisper API error {response.status_code}: {response.text[:200]}")
                        self._stats["errors"] += 1
                        return None

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            self._stats["errors"] += 1
            return None

    async def transcribe_telethon_message(self, client, message) -> Optional[str]:
        """
        Download and transcribe a voice message from Telethon.
        
        Args:
            client: TelegramClient instance
            message: Telethon Message with voice/audio media
            
        Returns:
            Transcription text or None.
        """
        if not self._enabled:
            self._stats["skipped"] += 1
            return None

        # Check if message has voice/audio
        if not message.media:
            return None

        is_voice = False
        if hasattr(message.media, "document") and message.media.document:
            for attr in getattr(message.media.document, "attributes", []):
                cls = type(attr).__name__
                if cls == "DocumentAttributeAudio" and getattr(attr, "voice", False):
                    is_voice = True
                    break

        if not is_voice:
            return None

        # Download to temp file
        tmp_dir = tempfile.mkdtemp(prefix="vz_voice_")
        tmp_path = os.path.join(tmp_dir, f"voice_{message.id}.ogg")

        try:
            import io
            import asyncio
            audio_bytes = await asyncio.to_thread(lambda: io.BytesIO())
            await client.download_media(message, file=audio_bytes)
            
            if not audio_bytes.getbuffer().nbytes:
                logger.warning(f"Downloaded voice file is empty: msg {message.id}")
                return None

            def write_temp():
                with open(tmp_path, "wb") as f:
                    f.write(audio_bytes.getvalue())
                    
            await asyncio.to_thread(write_temp)

            # Transcribe
            text = await self.transcribe_file(tmp_path)
            return text

        except Exception as e:
            logger.error(f"Voice download/transcribe error for msg {message.id}: {e}")
            self._stats["errors"] += 1
            return None

        finally:
            # Cleanup temp files
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                os.rmdir(tmp_dir)
            except Exception:
                pass
