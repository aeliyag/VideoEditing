"""Configuration loading and defaults."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class SegmentationConfig:
    threshold: float = 27.0
    min_scene_len: int = 15
    fade_threshold: float = 12.0


@dataclass
class TranscriptionConfig:
    model: str = "base"
    language: str = "en"


@dataclass
class FrameSamplingConfig:
    fps: float = 1.0
    output_dir: str = "frames/"


@dataclass
class OCRConfig:
    languages: list[str] = field(default_factory=lambda: ["en"])
    min_confidence: float = 0.5


@dataclass
class OutputConfig:
    output_file: str = "timeline.json"


@dataclass
class AppConfig:
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    frame_sampling: FrameSamplingConfig = field(default_factory=FrameSamplingConfig)
    ocr: OCRConfig = field(default_factory=OCRConfig)
    output: OutputConfig = field(default_factory=OutputConfig)


def _merge_dataclass(instance: Any, data: dict[str, Any]) -> None:
    """Merge dictionary values into a dataclass instance."""
    for key, value in data.items():
        if not hasattr(instance, key):
            continue
        current = getattr(instance, key)
        if hasattr(current, "__dataclass_fields__") and isinstance(value, dict):
            _merge_dataclass(current, value)
        else:
            setattr(instance, key, value)


def load_config(config_path: str | Path | None = None) -> AppConfig:
    """Load application configuration from YAML, falling back to defaults."""
    config = AppConfig()

    if config_path is None:
        return config

    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    with path.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}

    if not isinstance(raw, dict):
        raise ValueError("Config file must contain a YAML mapping at the top level.")

    _merge_dataclass(config, raw)
    return config
