"""Video rendering utilities for the Streamlit editor."""

from __future__ import annotations

import tempfile
from collections.abc import Callable
from pathlib import Path

import cv2

from effects import Clip
from effects.highlight import apply_highlight_timeline
from effects.highlight_timeline import HighlightTimeline


def _write_clip(
    result: Clip,
    output_path: Path,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        str(output_path),
        fourcc,
        result.fps,
        (result.width, result.height),
    )
    if not writer.isOpened():
        raise RuntimeError(f"Unable to open video writer: {output_path}")

    frame_count = max(1, int(round(result.duration * result.fps)))
    try:
        for frame_index in range(frame_count):
            t = frame_index / result.fps
            writer.write(result.get_frame(t))
            if on_progress is not None:
                on_progress(frame_index + 1, frame_count)
    finally:
        writer.release()
    return output_path


def render_highlight_video(
    video_bytes: bytes,
    suffix: str,
    timeline: HighlightTimeline,
    output_dir: Path,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Apply highlight overlays to an uploaded video and write the result to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "highlighted_output.mp4"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        clip = Clip.from_file(tmp_path)
        result = apply_highlight_timeline(clip, timeline)
        return _write_clip(result, output_path, on_progress)
    finally:
        Path(tmp_path).unlink(missing_ok=True)
