"""Lightweight video clip abstraction for composable effects."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Clip:
    """A time-indexed video clip backed by a frame-producing callable.

    Attributes:
        get_frame: Callable that returns a BGR frame (H x W x 3) at time ``t``
            in seconds.
        width: Output frame width in pixels.
        height: Output frame height in pixels.
        fps: Frames per second.
        duration: Clip length in seconds.
    """

    get_frame: Callable[[float], np.ndarray]
    width: int
    height: int
    fps: float
    duration: float

    @classmethod
    def from_file(cls, path: str | Path) -> Clip:
        """Load a video file and expose it as a :class:`Clip`.

        Args:
            path: Path to a video file readable by OpenCV.

        Returns:
            A :class:`Clip` that seeks into the source file on each frame request.

        Raises:
            FileNotFoundError: If ``path`` does not exist.
            RuntimeError: If the file cannot be opened or has invalid metadata.
        """
        video_path = Path(path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise RuntimeError(f"Unable to open video: {video_path}")

        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = capture.get(cv2.CAP_PROP_FPS)
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))

        if fps <= 0:
            capture.release()
            raise RuntimeError(f"Invalid FPS for video: {video_path}")

        duration = (frame_count -2)/ fps if frame_count > 0 else 0.0

        def get_frame(t: float) -> np.ndarray:
            frame_index = int(round(t * fps))

            frame_index = max(
                0,
                min(frame_index, frame_count - 1),
            )

            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)

            success, frame = capture.read()

            if not success:
                raise RuntimeError(
                    f"Failed to read frame {frame_index} "
                    f"from {video_path}"
                )

            return frame

        return cls(
            get_frame=get_frame,
            width=width,
            height=height,
            fps=fps,
            duration=duration,
        )

    def write(self, path: str | Path) -> None:
        """Render the clip to a video file.

        Args:
            path: Destination path for the encoded video.

        Raises:
            RuntimeError: If the writer cannot be opened.
        """
        output_path = Path(path)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(
            str(output_path),
            fourcc,
            self.fps,
            (self.width, self.height),
        )
        if not writer.isOpened():
            raise RuntimeError(f"Unable to open video writer: {output_path}")

        frame_count = max(1, int(round(self.duration * self.fps)))
        for frame_index in range(frame_count):
            t = frame_index / self.fps
            writer.write(self.get_frame(t))

        writer.release()
