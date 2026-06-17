"""Red-box highlight overlay effect for :class:`Clip` objects."""

from __future__ import annotations

import cv2

from effects.clip import Clip
from effects.highlight_timeline import (
    BoundingBox,
    HighlightTimeline,
    active_events_at,
)


def hex_to_bgr(color: str) -> tuple[int, int, int]:
    """Convert a hex color string to an OpenCV BGR tuple."""
    cleaned = color.lstrip("#")
    if len(cleaned) != 6:
        return (0, 0, 255)
    red = int(cleaned[0:2], 16)
    green = int(cleaned[2:4], 16)
    blue = int(cleaned[4:6], 16)
    return (blue, green, red)


def draw_rect(
    frame,
    bbox: BoundingBox,
    color: str,
    stroke_width: int,
    frame_width: int,
    frame_height: int,
) -> None:
    """Draw a rectangle outline on ``frame`` in place."""
    clamped = bbox.clamp_to_frame(frame_width, frame_height)
    x1 = int(round(clamped.x))
    y1 = int(round(clamped.y))
    x2 = int(round(clamped.x + clamped.width))
    y2 = int(round(clamped.y + clamped.height))
    cv2.rectangle(
        frame,
        (x1, y1),
        (x2, y2),
        hex_to_bgr(color),
        stroke_width,
    )


def apply_highlight_timeline(clip: Clip, timeline: HighlightTimeline) -> Clip:
    """Burn timed highlight rectangles into each frame of the clip."""
    def get_frame(t: float):
        frame = clip.get_frame(t).copy()
        for event in active_events_at(t, timeline.events, clip.duration):
            draw_rect(
                frame,
                event.bbox,
                event.color,
                event.stroke_width,
                clip.width,
                clip.height,
            )
        return frame

    return Clip(
        get_frame=get_frame,
        width=clip.width,
        height=clip.height,
        fps=clip.fps,
        duration=clip.duration,
    )
