"""Data models for timed red-box highlight overlays."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, field_validator


class BoundingBox(BaseModel):
    """Axis-aligned region in pixel coordinates."""

    x: float = Field(ge=0.0)
    y: float = Field(ge=0.0)
    width: float = Field(gt=0.0)
    height: float = Field(gt=0.0)

    def clamp_to_frame(self, frame_width: int, frame_height: int) -> BoundingBox:
        """Clamp this box so it lies fully inside the frame."""
        x = max(0.0, min(self.x, float(frame_width - 1)))
        y = max(0.0, min(self.y, float(frame_height - 1)))
        width = max(1.0, min(self.width, float(frame_width) - x))
        height = max(1.0, min(self.height, float(frame_height) - y))
        return BoundingBox(x=x, y=y, width=width, height=height)


class HighlightEvent(BaseModel):
    """A single red-box highlight on the video timeline."""

    start_time: float = Field(ge=0.0)
    end_time: float | None = None
    bbox: BoundingBox
    label: str = ""
    color: str = "#FF0000"
    stroke_width: int = Field(default=3, ge=1)

    @field_validator("end_time")
    @classmethod
    def end_after_start(cls, end_time: float | None, info) -> float | None:
        if end_time is None:
            return None
        start = info.data.get("start_time")
        if start is not None and end_time <= start:
            raise ValueError("end_time must be greater than start_time")
        return end_time


class HighlightTimeline(BaseModel):
    """Ordered list of highlight events for a video clip."""

    video_width: int = Field(gt=0)
    video_height: int = Field(gt=0)
    events: list[HighlightEvent] = Field(default_factory=list)

    def sorted_events(self) -> list[HighlightEvent]:
        return sorted(self.events, key=lambda event: event.start_time)

    def save(self, path: str | Path) -> None:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(self.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> HighlightTimeline:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.model_validate(data)


def effective_end_time(event: HighlightEvent, clip_duration: float) -> float:
    """Return the time when a highlight stops being visible."""
    if event.end_time is not None:
        return event.end_time
    return clip_duration


def active_events_at(
    t: float,
    events: list[HighlightEvent],
    clip_duration: float,
) -> list[HighlightEvent]:
    """Return highlights visible at time ``t``."""
    return [
        event
        for event in events
        if event.start_time <= t <= effective_end_time(event, clip_duration)
    ]
