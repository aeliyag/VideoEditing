# Video Editing Toolkit

A Python project for editing software tutorial videos. It includes:

1. **Video Highlight Editor** — draw timed red-box outlines in a Streamlit UI and export them baked into the video
2. **Video Segmentation Engine** — CLI pipeline for scene detection, transcription, OCR, and semantic timeline export

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

## Video Highlight Editor

Draw red rectangle outlines on a video, edit them on a timeline, and export a new video with the boxes burned in.

```bash
streamlit run app.py
```

### Workflow

1. Upload a video (`.mp4`, `.mov`, or `.avi`)
2. Add highlights by setting a start time, optional end time, and drawing a rectangle on a frame
3. Edit highlights in the table (add, remove, or adjust timing and coordinates)
4. Preview at any timestamp to see which boxes are active
5. Click **Generate highlighted video** to export `highlighted_output.mp4`

### Timing rules

- Every highlight requires a **start time**
- **End time is optional** — leave it blank to keep the highlight visible from its start time through the end of the video
- If an end time is set, the highlight is visible only while `start_time <= t <= end_time`

See [`examples/highlight_timeline.example.json`](examples/highlight_timeline.example.json) for the JSON timeline format.

## Video Segmentation Engine

### Configuration

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

The segmentation pipeline produces a semantic timeline JSON. Segment titles and descriptions are inferred from OCR text and transcript content:

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
effects/
├── clip.py                 # Video clip abstraction
├── highlight.py            # Red-box overlay effect
├── highlight_timeline.py   # Highlight event models
└── zoom.py                 # Legacy zoom effect (standalone demo)

video_segmentation/
├── cli.py                  # CLI entrypoint
├── config.py               # YAML configuration loading
├── models.py               # Shared Pydantic data models
├── segmentation.py         # Phase 1: PySceneDetect
├── transcription.py        # Phase 2: Whisper
├── frame_sampling.py       # Phase 3: OpenCV frame extraction
├── ocr.py                  # Phase 4: EasyOCR
└── timeline.py             # Timeline assembly and export

app.py                      # Streamlit highlight editor
render.py                   # Video render utilities
```

## Notes

- The first run of the segmentation pipeline downloads Whisper and EasyOCR model weights, which can take several minutes.
- Sampled frames are stored under `frames/` by default and removed after processing unless `--keep-frames` is passed.
