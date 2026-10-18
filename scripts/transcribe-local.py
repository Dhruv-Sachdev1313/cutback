"""Timestamped local transcription; no hosted API calls."""
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel('base.en', device='cpu', compute_type='int8', download_root='.models', cpu_threads=4)
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True)
result = [{'start': s.start, 'end': s.end, 'text': s.text.strip()} for s in segments]
with open(sys.argv[2], 'w') as output:
    json.dump({'language': info.language, 'segments': result}, output)
