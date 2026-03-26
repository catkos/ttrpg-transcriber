import asyncio
import json
import logging
import os
import tempfile
import wave

import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
from torch.torch_version import TorchVersion
from pyannote.audio.core.task import Specifications, Problem, Resolution

# --- Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

torch.serialization.add_safe_globals([TorchVersion, Specifications, Problem, Resolution])

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Config ---
HF_TOKEN = os.environ.get("HF_TOKEN", "YOUR_HF_TOKEN_HERE")
WHISPER_MODEL_SIZE = "medium"
SAMPLE_RATE = 16000
CHUNK_SECONDS = 5
CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_SECONDS  # 160000 bytes

# --- Load models ---
logger.info("Loading Whisper model...")
whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")

logger.info("Loading pyannote pipeline...")
diarization_pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token=HF_TOKEN
)

logger.info("Models loaded.")


def save_wave(audio_bytes: bytes, sample_rate: int = SAMPLE_RATE) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_bytes)
    return tmp.name


def process_chunk(audio_bytes: bytes, language: str, num_speakers: int) -> list[dict]:
    results = []
    wav_path = save_wave(audio_bytes)
    try:
        diarization = diarization_pipeline(
            wav_path,
            num_speakers=num_speakers,
        )
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            start = turn.start
            end = turn.end
            if (end - start) < 0.5:
                continue
            segments, _ = whisper_model.transcribe(
                wav_path,
                language=language,
                beam_size=1,
                vad_filter=True,
                clip_timestamps=f"{start},{end}",
            )
            text = " ".join([seg.text.strip() for seg in segments]).strip()
            if text:
                results.append({
                    "speaker": speaker,
                    "text": text,
                    "start": round(start, 2),
                    "end": round(end, 2),
                })
    finally:
        os.unlink(wav_path)
    return results


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected")

    # first message must be a JSON config {"language": "en", "num_speakers": 3}
    try:
        config_raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        config = json.loads(config_raw)
        language: str = config.get("language", "en")
        num_speakers: int = int(config.get("num_speakers", 2))
        logger.info(f"Config received: language={language}, num_speakers={num_speakers}")
    except Exception as e:
        logger.error(f"Failed to receive config: {e}")
        await websocket.send_text(json.dumps({"error": "First message must be a JSON config with language and num_speakers"}))
        await websocket.close()
        return

    audio_buffer = bytearray()
    time_offset = 0.0
    loop = asyncio.get_event_loop()

    process_queue: asyncio.Queue = asyncio.Queue()
    send_queue: asyncio.Queue = asyncio.Queue()

    async def processor():
        while True:
            item = await process_queue.get()
            if item is None:
                await send_queue.put(None)
                break
            chunk, offset = item
            try:
                results = await loop.run_in_executor(
                    None, process_chunk, chunk, language, num_speakers
                )
                for result in results:
                    result["start"] = round(result["start"] + offset, 2)
                    result["end"] = round(result["end"] + offset, 2)
                    await send_queue.put(result)
            except Exception as e:
                logger.error(f"Processing error: {e}", exc_info=True)
                await send_queue.put({"error": str(e)})

    async def sender():
        while True:
            item = await send_queue.get()
            if item is None:
                break
            try:
                await websocket.send_text(json.dumps(item))
            except Exception as e:
                logger.error(f"Send error: {e}")

    async def receiver():
        nonlocal audio_buffer, time_offset
        try:
            while True:
                data = await websocket.receive_bytes()
                if data == b"END":
                    logger.info("Received END signal")
                    if len(audio_buffer) > SAMPLE_RATE * 2 * 0.5:
                        process_queue.put_nowait((bytes(audio_buffer), time_offset))
                    break
                audio_buffer.extend(data)
                while len(audio_buffer) >= CHUNK_BYTES:
                    chunk = bytes(audio_buffer[:CHUNK_BYTES])
                    del audio_buffer[:CHUNK_BYTES]
                    process_queue.put_nowait((chunk, time_offset))
                    time_offset += CHUNK_SECONDS
        except WebSocketDisconnect:
            logger.info("Client disconnected during receive")
        except Exception as e:
            logger.error(f"Receive error: {e}")
        finally:
            process_queue.put_nowait(None)

    try:
        await asyncio.gather(receiver(), processor(), sender())
        await websocket.send_text(json.dumps({"done": True}))
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass


@app.get("/health")
def health():
    return {"status": "ok"}