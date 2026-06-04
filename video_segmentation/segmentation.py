"""Phase 1: Automatic scene segmentation using PySceneDetect."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector, ThresholdDetector

from video_segmentation.config import SegmentationConfig
from video_segmentation.models import SceneSegment

logger = logging.getLogger(__name__)


def detect_scenes(video_path: str | Path, config: SegmentationConfig) -> list[SceneSegment]:
    """Detect scene boundaries using hard cuts and fade transitions."""
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")

    logger.info("Detecting scenes in %s", path)
    video = open_video(str(path))
    scene_manager = SceneManager()

    scene_manager.add_detector(
        ContentDetector(
            threshold=config.threshold,
            min_scene_len=config.min_scene_len,
        )
    )
    scene_manager.add_detector(
        ThresholdDetector(
            threshold=config.fade_threshold,
            min_scene_len=config.min_scene_len,
        )
    )

    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    if not scene_list:
        duration = video.duration.get_seconds()
        logger.warning("No scenes detected; treating entire video as one segment.")
        return [SceneSegment(start=0.0, end=max(duration, 0.1))]

    segments = [
        SceneSegment(
            start=scene[0].get_seconds(),
            end=scene[1].get_seconds(),
        )
        for scene in scene_list
    ]

    logger.info("Detected %d scene segments", len(segments))
    return segments


def save_segments_json(segments: list[SceneSegment], output_path: str | Path) -> None:
    """Save raw scene segments to JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [segment.model_dump() for segment in segments]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Saved scene segments to %s", path)
