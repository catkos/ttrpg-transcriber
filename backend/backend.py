import asyncio
import json
import logging
import os
import tempfile
import wave

from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
from pyannote.audio.pipelines.utils.hook import ProgressHook
from pydantic import BaseModel
from sqlalchemy.orm import Session
from torch.torch_version import TorchVersion
from pyannote.audio.core.task import Specifications, Problem, Resolution

from database import get_db, init_db
from models import Speaker, Session as SessionModel, Transcript, Note
from embeddings import (
    extract_embedding, save_embedding, load_embedding,
    match_speaker, enroll_speaker_from_wav, get_embedding_model
)

# from dotenv import load_dotenv
# load_dotenv()
# HF_TOKEN = os.getenv('HF_TOKEN')

# --- Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

torch.serialization.add_safe_globals([TorchVersion, Specifications, Problem, Resolution])

HF_TOKEN = os.environ.get("HF_TOKEN", "")
WHISPER_MODEL_SIZE = "small"
SAMPLE_RATE = 16000
CHUNK_SECONDS = 8
CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_SECONDS


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Loading models...")
    global whisper_model, diarization_pipeline
    whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    diarization_pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=HF_TOKEN,
    )
    # Preload embedding model
    get_embedding_model()
    logger.info("All models loaded.")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

whisper_model: WhisperModel = None
diarization_pipeline: Pipeline = None


# --- Helpers ---

def save_wave(audio_bytes: bytes, sample_rate: int = SAMPLE_RATE) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_bytes)
    return tmp.name


def load_all_speaker_profiles(db: Session) -> list[dict]:
    """Load all speaker embeddings from disk into memory, grouped by speaker."""
    from models import SpeakerVoice
    speakers = db.query(Speaker).all()
    profiles = []
    for spk in speakers:
        embeddings = []
        for voice in spk.voices:
            try:
                emb = load_embedding(voice.embedding_path)
                embeddings.append(emb)
            except Exception as e:
                logger.warning(f"Could not load embedding {voice.label} for {spk.name}: {e}")
        if embeddings:
            profiles.append({"name": spk.name, "speaker_id": spk.id, "embeddings": embeddings})
    return profiles


def crop_wave(audio_bytes: bytes, start: float, end: float, sample_rate: int = SAMPLE_RATE) -> str:
    """Crop audio bytes to a specific time range and save as temp wav."""
    start_sample = int(start * sample_rate)
    end_sample = int(end * sample_rate)
    # Each sample is 2 bytes (16-bit)
    start_byte = start_sample * 2
    end_byte = end_sample * 2
    cropped = audio_bytes[start_byte:end_byte]
    return save_wave(cropped, sample_rate)


def process_chunk(
    audio_bytes: bytes,
    language: str,
    max_speakers: int,
    speaker_profiles: list[dict],
) -> list[dict]:
    results = []
    wav_path = save_wave(audio_bytes)
    try:
        diarization = diarization_pipeline(
            wav_path,
            min_speakers=1,
            max_speakers=max_speakers,
        )

        for turn, _, raw_speaker in diarization.itertracks(yield_label=True):
            start = turn.start
            end = turn.end
            if (end - start) < 0.5:
                continue

            # Extract embedding for just this speaker's time segment
            try:
                segment_wav = crop_wave(audio_bytes, start, end)
                embedding = extract_embedding(segment_wav)
                speaker_name, speaker_id, score = match_speaker(embedding, speaker_profiles)
            except Exception as e:
                logger.warning(f"Embedding error: {e}")
                speaker_name = "unknown"
                speaker_id = None
                score = 0.0
            finally:
                if os.path.exists(segment_wav):
                    os.unlink(segment_wav)

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
                    "speaker": speaker_name,
                    "raw_speaker": raw_speaker,
                    "text": text,
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "confidence": round(float(score), 3),
                })
    finally:
        os.unlink(wav_path)
    return results


# --- Speaker endpoints ---

class SpeakerCreate(BaseModel):
    name: str


@app.get("/speakers")
def list_speakers(db: Session = Depends(get_db)):
    from models import SpeakerVoice
    speakers = db.query(Speaker).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "created_at": s.created_at,
            "voices": [{"id": v.id, "label": v.label} for v in s.voices],
        }
        for s in speakers
    ]


@app.post("/speakers")
def create_speaker(body: SpeakerCreate, db: Session = Depends(get_db)):
    existing = db.query(Speaker).filter(Speaker.name == body.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Speaker already exists")
    speaker = Speaker(name=body.name)
    db.add(speaker)
    db.commit()
    db.refresh(speaker)
    return {"id": speaker.id, "name": speaker.name}


@app.post("/speakers/{name}/enroll/upload")
async def enroll_upload(
    name: str,
    label: str = "default",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    from models import SpeakerVoice
    speaker = db.query(Speaker).filter(Speaker.name == name).first()
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(contents)
    tmp.close()

    try:
        path = enroll_speaker_from_wav(name, label, tmp.name)
        voice = SpeakerVoice(speaker_id=speaker.id, label=label, embedding_path=path)
        db.add(voice)
        db.commit()
    finally:
        os.unlink(tmp.name)

    return {"message": f"Enrolled voice '{label}' for {name}"}


@app.delete("/speakers/{name}/voices/{voice_id}")
def delete_voice(name: str, voice_id: int, db: Session = Depends(get_db)):
    from models import SpeakerVoice
    voice = db.query(SpeakerVoice).filter(SpeakerVoice.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")
    if os.path.exists(voice.embedding_path):
        os.unlink(voice.embedding_path)
    db.delete(voice)
    db.commit()
    return {"message": "Voice deleted"}


@app.delete("/speakers/{name}")
def delete_speaker(name: str, db: Session = Depends(get_db)):
    speaker = db.query(Speaker).filter(Speaker.name == name).first()
    if not speaker:
        raise HTTPException(status_code=404, detail="Speaker not found")
    for voice in speaker.voices:
        if os.path.exists(voice.embedding_path):
            os.unlink(voice.embedding_path)
    db.delete(speaker)
    db.commit()
    return {"message": f"Deleted {name}"}


# --- Session endpoints ---

class SessionCreate(BaseModel):
    name: str
    language: str = "en"
    max_speakers: int = 5


@app.get("/sessions")
def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(SessionModel).order_by(SessionModel.created_at.desc()).all()
    return [{"id": s.id, "name": s.name, "created_at": s.created_at} for s in sessions]


@app.post("/sessions")
def create_session(body: SessionCreate, db: Session = Depends(get_db)):
    session = SessionModel(name=body.name, language=body.language, max_speakers=body.max_speakers)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id, "name": session.name}


@app.get("/sessions/{session_id}/transcripts")
def get_transcripts(session_id: int, db: Session = Depends(get_db)):
    transcripts = (
        db.query(Transcript)
        .filter(Transcript.session_id == session_id)
        .order_by(Transcript.start)
        .all()
    )
    return [
        {
            "id": t.id,
            "speaker": t.speaker_label,
            "text": t.text,
            "start": t.start,
            "end": t.end,
        }
        for t in transcripts
    ]


@app.get("/sessions/{session_id}/notes")
def get_notes(session_id: int, db: Session = Depends(get_db)):
    notes = (
        db.query(Note)
        .filter(Note.session_id == session_id)
        .order_by(Note.generated_at.desc())
        .all()
    )
    return [{"id": n.id, "content": n.content, "generated_at": n.generated_at} for n in notes]


@app.post("/sessions/{session_id}/notes/generate")
async def generate_notes(session_id: int, db: Session = Depends(get_db)):
    """Generate structured session notes from the transcript using Ollama."""
    import httpx

    # Get all transcripts for this session
    transcripts = (
        db.query(Transcript)
        .filter(Transcript.session_id == session_id)
        .order_by(Transcript.start)
        .all()
    )

    if not transcripts:
        raise HTTPException(status_code=400, detail="No transcript found for this session")

    # Build transcript text
    transcript_text = "\n".join(
        f"[{t.start:.1f}s] {t.speaker_label}: {t.text}"
        for t in transcripts
    )

    prompt = f"""You are a TTRPG session scribe. Given the following session transcript, extract and organize the key events into structured notes.

TRANSCRIPT:
{transcript_text}

Write concise bullet-point notes under these sections. Only include what actually happened — skip empty sections:

## Decisions
(choices the party made)

## NPCs
(characters encountered, what they said or did)

## Combat
(fights, outcomes, who took damage)

## Loot
(items found or acquired)

## Other Notable Moments
(anything important that doesn't fit above)"""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": "llama3.2:3b",
                    "prompt": prompt,
                    "stream": False,
                },
            )
            response.raise_for_status()
            result = response.json()
            content = result.get("response", "").strip()
    except Exception as e:
        logger.error(f"Ollama error: {e}")
        raise HTTPException(status_code=503, detail=f"Ollama unavailable: {str(e)}")

    # Save to DB
    note = Note(session_id=session_id, content=content)
    db.add(note)
    db.commit()
    db.refresh(note)

    return {"id": note.id, "content": note.content, "generated_at": note.generated_at}


# --- WebSocket transcription ---

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(session_id: int, websocket: WebSocket):
    await websocket.accept()
    logger.info(f"Client connected to session {session_id}")

    db = next(get_db())
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        await websocket.send_text(json.dumps({"error": "Session not found"}))
        await websocket.close()
        return

    # First message: config
    try:
        config_raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        config = json.loads(config_raw)
        language = config.get("language", session.language)
        max_speakers = config.get("max_speakers", session.max_speakers)
    except Exception as e:
        await websocket.send_text(json.dumps({"error": f"Config error: {e}"}))
        await websocket.close()
        return

    # Load speaker profiles
    speaker_profiles = load_all_speaker_profiles(db)
    logger.info(f"Loaded {len(speaker_profiles)} speaker profiles")

    audio_buffer = bytearray()
    time_offset = 0.0
    loop = asyncio.get_event_loop()
    process_queue: asyncio.Queue = asyncio.Queue()
    send_queue: asyncio.Queue = asyncio.Queue()

    async def processor():
        nonlocal time_offset
        while True:
            item = await process_queue.get()
            if item is None:
                await send_queue.put(None)
                break
            chunk, offset = item
            try:
                results = await loop.run_in_executor(
                    None, process_chunk, chunk, language, max_speakers, speaker_profiles
                )
                for result in results:
                    result["start"] = round(result["start"] + offset, 2)
                    result["end"] = round(result["end"] + offset, 2)

                    # Save to DB
                    speaker_id = next(
                        (p["speaker_id"] for p in speaker_profiles if p["name"] == result["speaker"]),
                        None,
                    )
                    transcript = Transcript(
                        session_id=session_id,
                        speaker_id=speaker_id,
                        speaker_label=result["speaker"],
                        text=result["text"],
                        start=result["start"],
                        end=result["end"],
                    )
                    db.add(transcript)
                    db.commit()

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
            logger.info("Client disconnected")
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
    finally:
        db.close()


# --- WebSocket speaker enrollment (live recording) ---

@app.websocket("/ws/enroll/{name}/{label}")
async def enroll_websocket(name: str, label: str, websocket: WebSocket):
    """Receive raw PCM audio for enrollment via WebSocket."""
    await websocket.accept()

    db = next(get_db())
    from models import SpeakerVoice
    speaker = db.query(Speaker).filter(Speaker.name == name).first()
    if not speaker:
        await websocket.send_text(json.dumps({"error": "Speaker not found"}))
        await websocket.close()
        db.close()
        return

    audio_buffer = bytearray()

    try:
        while True:
            data = await websocket.receive_bytes()
            if data == b"END":
                break
            audio_buffer.extend(data)

        wav_path = save_wave(bytes(audio_buffer))
        try:
            loop = asyncio.get_event_loop()
            path = await loop.run_in_executor(None, enroll_speaker_from_wav, name, label, wav_path)
            voice = SpeakerVoice(speaker_id=speaker.id, label=label, embedding_path=path)
            db.add(voice)
            db.commit()
            await websocket.send_text(json.dumps({"success": True, "message": f"Enrolled voice '{label}' for {name}"}))
        finally:
            os.unlink(wav_path)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Enrollment error: {e}", exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}