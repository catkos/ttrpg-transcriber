import os
import torch
from dotenv import load_dotenv
from torch.torch_version import TorchVersion
from pyannote.audio.core.task import Specifications, Problem, Resolution
torch.serialization.add_safe_globals([TorchVersion, Specifications, Problem, Resolution])

load_dotenv()

from pyannote.audio import Pipeline
pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token=os.getenv('HF_TOKEN')
diarization = pipeline("test.wav")

for turn, _, speaker in diarization.itertracks(yield_label=True):
    print(f"[{turn.start:.1f}s - {turn.end:.1f}s] {speaker}")