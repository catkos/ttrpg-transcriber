import os
import numpy as np
import torch
from pyannote.audio import Model, Inference
from scipy.spatial.distance import cosine

# Force weights_only=False globally for pyannote model loading.
# lightning_fabric calls torch.load with weights_only=True explicitly,
# so we must override it rather than just set a default.
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

EMBEDDINGS_DIR = "speaker_embeddings"
SIMILARITY_THRESHOLD = 0.65

os.makedirs(EMBEDDINGS_DIR, exist_ok=True)

# Load the speaker embedding model once
_embedding_model = None


def get_embedding_model() -> Inference:
    global _embedding_model
    if _embedding_model is None:
        hf_token = os.environ.get("HF_TOKEN", "")
        model = Model.from_pretrained(
            "pyannote/embedding",
            use_auth_token=hf_token,
        )
        _embedding_model = Inference(model, window="whole")
    return _embedding_model


def extract_embedding(wav_path: str) -> np.ndarray:
    """Extract a voice embedding vector from a wav file."""
    inference = get_embedding_model()
    embedding = inference(wav_path)
    return np.array(embedding)


def save_embedding(name: str, label: str, embedding: np.ndarray) -> str:
    """Save embedding to disk, return the file path."""
    safe_name = name.lower().replace(" ", "_")
    safe_label = label.lower().replace(" ", "_")
    path = os.path.join(EMBEDDINGS_DIR, f"{safe_name}_{safe_label}.npy")
    np.save(path, embedding)
    return path


def load_embedding(path: str) -> np.ndarray:
    """Load embedding from disk."""
    return np.load(path)


def match_speaker(
    embedding: np.ndarray,
    speaker_profiles: list[dict],  # list of {"name": str, "speaker_id": int, "embeddings": [np.ndarray]}
) -> tuple[str, int | None, float]:
    """
    Compare embedding against all profiles and all their voices.
    Returns (speaker_name, speaker_id, similarity_score).
    Returns ("unknown", None, 0.0) if no match above threshold.
    """
    if not speaker_profiles:
        return "unknown", None, 0.0

    best_name = "unknown"
    best_id = None
    best_score = 0.0

    for profile in speaker_profiles:
        for emb in profile["embeddings"]:
            score = 1 - cosine(embedding, emb)
            if score > best_score:
                best_score = score
                best_name = profile["name"]
                best_id = profile["speaker_id"]

    if best_score >= SIMILARITY_THRESHOLD:
        return best_name, best_id, best_score
    return "unknown", None, best_score


def enroll_speaker_from_wav(name: str, label: str, wav_path: str) -> str:
    """Extract embedding from wav and save it. Returns the saved path."""
    embedding = extract_embedding(wav_path)
    path = save_embedding(name, label, embedding)
    return path