"""Unit tests for red-box highlight overlays."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np
import pytest

from effects.highlight import draw_rect, hex_to_bgr
from effects.highlight_timeline import (
    BoundingBox,
    HighlightEvent,
    HighlightTimeline,
    active_events_at,
    effective_end_time,
)


def _event(
    start: float,
    end: float | None,
    x: float = 10,
    y: float = 20,
) -> HighlightEvent:
    return HighlightEvent(
        start_time=start,
        end_time=end,
        bbox=BoundingBox(x=x, y=y, width=100, height=50),
        label="test",
    )


def test_effective_end_time_with_null_uses_clip_duration() -> None:
    event = _event(start=5.0, end=None)
    assert effective_end_time(event, clip_duration=30.0) == 30.0


def test_effective_end_time_with_explicit_end() -> None:
    event = _event(start=5.0, end=10.0)
    assert effective_end_time(event, clip_duration=30.0) == 10.0


def test_active_events_before_start() -> None:
    events = [_event(start=5.0, end=10.0)]
    assert active_events_at(4.9, events, clip_duration=30.0) == []


def test_active_events_during_range() -> None:
    events = [_event(start=5.0, end=10.0)]
    active = active_events_at(7.0, events, clip_duration=30.0)
    assert len(active) == 1
    assert active[0].start_time == 5.0


def test_active_events_after_explicit_end() -> None:
    events = [_event(start=5.0, end=10.0)]
    assert active_events_at(10.1, events, clip_duration=30.0) == []


def test_active_events_null_end_visible_until_clip_end() -> None:
    events = [_event(start=5.0, end=None)]
    assert len(active_events_at(25.0, events, clip_duration=30.0)) == 1
    assert len(active_events_at(30.0, events, clip_duration=30.0)) == 1


def test_hex_to_bgr_red() -> None:
    assert hex_to_bgr("#FF0000") == (0, 0, 255)


def test_timeline_json_round_trip_with_null_end_time() -> None:
    timeline = HighlightTimeline(
        video_width=1920,
        video_height=1080,
        events=[_event(start=12.0, end=None)],
    )
    with tempfile.TemporaryDirectory() as tmp_dir:
        path = Path(tmp_dir) / "timeline.json"
        timeline.save(path)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded["events"][0]["end_time"] is None
        restored = HighlightTimeline.load(path)
        assert restored.events[0].end_time is None


def test_draw_rect_clamps_to_frame() -> None:
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    bbox = BoundingBox(x=150, y=80, width=100, height=50)
    draw_rect(frame, bbox, "#FF0000", 2, frame_width=200, frame_height=100)
    assert frame.sum() > 0


def test_highlight_event_rejects_end_before_start() -> None:
    with pytest.raises(ValueError):
        HighlightEvent(
            start_time=10.0,
            end_time=5.0,
            bbox=BoundingBox(x=0, y=0, width=10, height=10),
        )
