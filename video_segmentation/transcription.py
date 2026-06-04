"""Phase 2: Transcript extraction using OpenAI Whisper."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path

import whisper

from video_segmentation.config import TranscriptionConfig
from video_segmentation.models import SceneSegment, TranscriptChunk

logger = logging.getLogger(__name__)


def transcribe_video(
    video_path: str | Path,
    config: TranscriptionConfig,
) -> list[TranscriptChunk]:
    """Transcribe a video and return timestamped transcript chunks."""
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")

    logger.info("Loading Whisper model '%s'", config.model)
    model = whisper.load_model(config.model)

    logger.info("Transcribing %s", path)
    result = model.transcribe(
        str(path),
        language=config.language,
        word_timestamps=True,
        verbose=False,
    )

    chunks: list[TranscriptChunk] = []
    for segment in result.get("segments", []):
        text = segment.get("text", "").strip()
        if not text:
            continue
        chunks.append(
            TranscriptChunk(
                start=float(segment["start"]),
                end=float(segment["end"]),
                text=text,
            )
        )

    logger.info("Extracted %d transcript chunks", len(chunks))
    return chunks


def align_to_segments(
    chunks: list[TranscriptChunk],
    segments: list[SceneSegment],
) -> dict[int, list[TranscriptChunk]]:
    """Assign transcript chunks to scene segments by midpoint overlap."""
    aligned: dict[int, list[TranscriptChunk]] = defaultdict(list)

    for chunk in chunks:
        midpoint = (chunk.start + chunk.end) / 2.0
        segment_index = _find_segment_index(midpoint, segments)
        if segment_index is not None:
            aligned[segment_index].append(chunk)

    return dict(aligned)


def _find_segment_index(timestamp: float, segments: list[SceneSegment]) -> int | None:
    """Find the segment index containing a timestamp."""
    for index, segment in enumerate(segments):
        if segment.start <= timestamp < segment.end:
            return index
    if segments and timestamp >= segments[-1].end:
        return len(segments) - 1
    return None


def save_transcript_json(chunks: list[TranscriptChunk], output_path: str | Path) -> None:
    """Save transcript chunks to JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [chunk.model_dump() for chunk in chunks]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Saved transcript to %s", path)
