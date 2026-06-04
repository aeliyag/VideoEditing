# Video Segmentation Engine

A Python-based MVP pipeline that processes software tutorial videos and outputs a structured semantic timeline. The timeline describes video segments, transcript alignment, and important UI elements appearing within each segment.

## Features

- **Phase 1 — Scene Segmentation**: Detect hard cuts, fades, and transitions with PySceneDetect
- **Phase 2 — Transcription**: Extract timestamped transcripts with OpenAI Whisper
- **Phase 3 — Frame Sampling**: Capture representative frames at 1 FPS per segment
- **Phase 4 — OCR**: Extract visible UI text with EasyOCR
- **Timeline Export**: Produce a final semantic JSON timeline

## Requirements

- Python 3.11+
- FFmpeg (required by Whisper and PySceneDetect)

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

## Configuration

Edit [`config.yaml`](config.yaml) to customize pipeline behavior:

```yaml
segmentation:
  threshold: 27.0
  min_scene_len: 15
  fade_threshold: 12.0
transcription:
  model: base
  language: en
frame_sampling:
  fps: 1
  output_dir: frames/
ocr:
  languages:
    - en
  min_confidence: 0.5
output:
  output_file: timeline.json
```

## Usage

### Full pipeline

```bash
video-segment process tutorial.mp4
```

Options:

- `--config config.yaml` — path to config file
- `--output timeline.json` — output path for the timeline
- `--keep-frames` — retain sampled frames after processing
- `--verbose` — enable debug logging

### Phase 1 only (scene segmentation)

```bash
video-segment segment-only tutorial.mp4 --output segments.json
```

### Phase 2 only (transcription)

```bash
video-segment transcribe-only tutorial.mp4 --output transcript.json
```

## Output

The full pipeline produces a semantic timeline JSON. Segment titles and descriptions are inferred from OCR text and transcript content:

```json
{
  "segments": [
    {
      "id": 1,
      "title": "Create Avatar",
      "description": "Click Create Avatar Upload an image Click Generate to create your avatar",
      "start_time": 25.3,
      "end_time": 58.1,
      "transcript": [
        "Click Create Avatar",
        "Upload an image"
      ],
      "ui_elements": [
        "Create Avatar",
        "Upload Image",
        "Generate"
      ]
    }
  ]
}
```

See [`examples/timeline.example.json`](examples/timeline.example.json) for a complete example.

## Project Structure

```
video_segmentation/
├── cli.py              # CLI entrypoint
├── config.py           # YAML configuration loading
├── models.py           # Shared Pydantic data models
├── segmentation.py     # Phase 1: PySceneDetect
├── transcription.py    # Phase 2: Whisper
├── frame_sampling.py   # Phase 3: OpenCV frame extraction
├── ocr.py              # Phase 4: EasyOCR
└── timeline.py         # Timeline assembly and export
```

## Notes

- The first run downloads Whisper and EasyOCR model weights, which can take several minutes.
- Sampled frames are stored under `frames/` by default and removed after processing unless `--keep-frames` is passed.
