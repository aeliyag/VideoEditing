"""Reusable video effects for the editing pipeline."""

from effects.clip import Clip
from effects.highlight import apply_highlight_timeline
from effects.highlight_timeline import BoundingBox, HighlightEvent, HighlightTimeline
from effects.zoom import Rectangle, apply_zoom_effect, zoom

__all__ = [
    "BoundingBox",
    "Clip",
    "HighlightEvent",
    "HighlightTimeline",
    "Rectangle",
    "apply_highlight_timeline",
    "apply_zoom_effect",
    "zoom",
]
