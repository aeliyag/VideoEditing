"""Final timeline assembly and export."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from video_segmentation.models import (
    OCRResult,
    SceneSegment,
    Timeline,
    TimelineSegment,
    TranscriptChunk,
)

logger = logging.getLogger(__name__)

_MAX_TITLE_LENGTH = 60
_MAX_DESCRIPTION_LENGTH = 200


def build_timeline(
    segments: list[SceneSegment],
    aligned_transcripts: dict[int, list[TranscriptChunk]],
    ocr_results: list[OCRResult],
) -> Timeline:
    """Merge pipeline outputs into a semantic timeline."""
    ocr_by_segment = {result.segment_id: result.ui_text for result in ocr_results}
    timeline_segments: list[TimelineSegment] = []

    for index, segment in enumerate(segments, start=1):
        transcript_lines = [
            chunk.text for chunk in aligned_transcripts.get(index - 1, [])
        ]
        ui_elements = ocr_by_segment.get(index, [])

        timeline_segments.append(
            TimelineSegment(
                id=index,
                title=_infer_title(index, transcript_lines, ui_elements),
                description=_infer_description(transcript_lines),
                start_time=segment.start,
                end_time=segment.end,
                transcript=transcript_lines,
                ui_elements=ui_elements,
            )
        )

    logger.info("Built timeline with %d segments", len(timeline_segments))
    return Timeline(segments=timeline_segments)


def _infer_title(
    segment_id: int,
    transcript_lines: list[str],
    ui_elements: list[str],
) -> str:
    """Derive a segment title from OCR text or transcript."""
    if ui_elements:
        return _truncate(ui_elements[0], _MAX_TITLE_LENGTH)
    if transcript_lines:
        return _truncate(transcript_lines[0], _MAX_TITLE_LENGTH)
    return f"Segment {segment_id}"


def _infer_description(transcript_lines: list[str]) -> str:
    """Derive a segment description from transcript content."""
    if not transcript_lines:
        return ""
    return _truncate(" ".join(transcript_lines), _MAX_DESCRIPTION_LENGTH)


def _truncate(text: str, max_length: int) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_length:
        return cleaned
    return cleaned[: max_length - 3].rstrip() + "..."


def save_timeline(timeline: Timeline, output_path: str | Path) -> None:
    """Serialize the timeline to JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(timeline.model_dump(), indent=2),
        encoding="utf-8",
    )
    logger.info("Saved timeline to %s", path)
