"""Phase 3: Frame sampling from video segments."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import cv2

from video_segmentation.config import FrameSamplingConfig
from video_segmentation.models import FrameMetadata, SceneSegment

logger = logging.getLogger(__name__)


def sample_frames(
    video_path: str | Path,
    segments: list[SceneSegment],
    config: FrameSamplingConfig,
    clean_output: bool = True,
) -> list[FrameMetadata]:
    """Sample frames at a fixed rate from each detected segment."""
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")

    output_dir = Path(config.output_dir)
    if clean_output and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {path}")

    fps = capture.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        capture.release()
        raise RuntimeError(f"Invalid FPS for video: {path}")

    metadata: list[FrameMetadata] = []
    interval = 1.0 / config.fps

    for segment_index, segment in enumerate(segments, start=1):
        segment_dir = output_dir / f"segment_{segment_index:03d}"
        segment_dir.mkdir(parents=True, exist_ok=True)

        timestamp = segment.start
        frame_num = 1

        while timestamp < segment.end:
            frame_index = int(timestamp * fps)
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            success, frame = capture.read()
            if not success:
                logger.warning(
                    "Failed to read frame at %.2fs for segment %d",
                    timestamp,
                    segment_index,
                )
                break

            frame_path = segment_dir / f"frame_{frame_num:03d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            metadata.append(
                FrameMetadata(
                    segment_id=segment_index,
                    frame_num=frame_num,
                    timestamp=timestamp,
                    path=str(frame_path),
                )
            )

            frame_num += 1
            timestamp += interval

    capture.release()
    logger.info("Sampled %d frames across %d segments", len(metadata), len(segments))
    return metadata
