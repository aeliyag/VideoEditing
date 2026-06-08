"""Animated zoom effect for :class:`Clip` objects."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from effects.clip import Clip


@dataclass
class Rectangle:
    """Axis-aligned crop region in pixel coordinates.

    Attributes:
        x: Left edge of the rectangle.
        y: Top edge of the rectangle.
        width: Rectangle width in pixels.
        height: Rectangle height in pixels.
    """

    x: float
    y: float
    width: float
    height: float


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _lerp(start: float, end: float, progress: float) -> float:
    return start + (end - start) * progress


def _crop_and_resize(
    frame: np.ndarray,
    x: float,
    y: float,
    width: float,
    height: float,
    output_width: int,
    output_height: int,
) -> np.ndarray:
    """Crop ``frame`` to the given rectangle and resize to the output resolution."""
    frame_height, frame_width = frame.shape[:2]

    x1 = int(round(x))
    y1 = int(round(y))
    x2 = int(round(x + width))
    y2 = int(round(y + height))

    x1 = _clamp(x1, 0, frame_width - 1)
    y1 = _clamp(y1, 0, frame_height - 1)
    x2 = _clamp(x2, x1 + 1, frame_width)
    y2 = _clamp(y2, y1 + 1, frame_height)

    cropped = frame[y1:y2, x1:x2]
    return cv2.resize(
        cropped,
        (output_width, output_height),
        interpolation=cv2.INTER_LINEAR,
    )


def apply_zoom_effect(
    clip: Clip,
    start_rect: Rectangle,
    end_rect: Rectangle,
    duration: float,
) -> Clip:
    """Animate a smooth zoom from ``start_rect`` to ``end_rect``.

    At ``t = 0`` the visible region matches ``start_rect``. At ``t = duration`` it
    matches ``end_rect``. Position and size are linearly interpolated in between.
    Each frame is cropped to the interpolated rectangle and resized back to the
    original clip dimensions.

    Args:
        clip: Source clip to transform.
        start_rect: Visible region at the beginning of the effect.
        end_rect: Visible region at the end of the effect.
        duration: Effect length in seconds. Values after ``duration`` hold the
            end rectangle.

    Returns:
        A new :class:`Clip` with the same dimensions, fps, and duration as the
        input clip.

    Example:
        >>> from effects import Clip, Rectangle, zoom
        >>> clip = Clip.from_file("screen_recording.mp4")
        >>> full_screen = Rectangle(x=0, y=0, width=1920, height=1080)
        >>> button_rect = Rectangle(x=500, y=200, width=600, height=400)
        >>> result = zoom(
        ...     clip,
        ...     start_rect=full_screen,
        ...     end_rect=button_rect,
        ...     duration=1.5,
        ... )
        >>> result.write("zoomed_output.mp4")
    """
    if duration < 0:
        raise ValueError("duration must be non-negative")

    def get_frame(t: float) -> np.ndarray:
        if duration == 0:
            progress = 1.0
        else:
            progress = _clamp(t / duration, 0.0, 1.0)

        rect_x = _lerp(start_rect.x, end_rect.x, progress)
        rect_y = _lerp(start_rect.y, end_rect.y, progress)
        rect_width = _lerp(start_rect.width, end_rect.width, progress)
        rect_height = _lerp(start_rect.height, end_rect.height, progress)

        source_frame = clip.get_frame(t)
        return _crop_and_resize(
            source_frame,
            rect_x,
            rect_y,
            rect_width,
            rect_height,
            clip.width,
            clip.height,
        )

    return Clip(
        get_frame=get_frame,
        width=clip.width,
        height=clip.height,
        fps=clip.fps,
        duration=clip.duration,
    )


zoom = apply_zoom_effect
