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
    min_segment_duration: float = 4.0


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
    min_confidence: float = 0.2
    upscale_factor: float = 3.0
    debug: bool = False
    debug_dir: str = "ocr_debug"


@dataclass
class TargetElementConfig:
    element_id: str
    labels: list[str]
    type: str
    regions: list[str]


def _default_target_elements() -> list[TargetElementConfig]:
    return [
        TargetElementConfig(
            element_id="stop_button",
            labels=["Stop"],
            type="button",
            regions=["bottom_toolbar", "right_controls"],
        ),
        TargetElementConfig(
            element_id="camera_button",
            labels=["camera", "camera button", "FaceTime HD Camera"],
            type="button",
            regions=["bottom_toolbar"],
        ),
        TargetElementConfig(
            element_id="microphone_button",
            labels=["microphone", "mic", "Open microphone"],
            type="button",
            regions=["bottom_toolbar"],
        ),
        TargetElementConfig(
            element_id="credits_counter",
            labels=["Credits", "credit"],
            type="counter",
            regions=["top_header"],
        ),
        TargetElementConfig(
            element_id="result_library",
            labels=["Result Library"],
            type="nav_item",
            regions=["top_header"],
        ),
        TargetElementConfig(
            element_id="api_link",
            labels=["API"],
            type="nav_item",
            regions=["top_header"],
        ),
        TargetElementConfig(
            element_id="context_sales",
            labels=["Context Sales"],
            type="nav_item",
            regions=["top_header"],
        ),
        TargetElementConfig(
            element_id="upgrade_link",
            labels=["Upgrade"],
            type="nav_item",
            regions=["top_header"],
        ),
        TargetElementConfig(
            element_id="choose_face",
            labels=["Choose Face"],
            type="panel_action",
            regions=["left_sidebar", "main_content"],
        ),
    ]


@dataclass
class UITrackingConfig:
    mode: str = "hybrid"
    keep_unmatched_ocr: bool = False
    min_label_length: int = 2
    reject_single_char: bool = True
    reject_numeric_noise: bool = True
    fuzzy_match_threshold: float = 0.85
    exact_match_only_max_length: int = 4
    max_center_distance: float = 0.15
    max_gap_seconds: float = 2.0
    movement_threshold: float = 0.05
    debug: bool = True
    target_elements: list[TargetElementConfig] = field(
        default_factory=_default_target_elements
    )


@dataclass
class OutputConfig:
    output_file: str = "timeline.json"


@dataclass
class AppConfig:
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    transcription: TranscriptionConfig = field(default_factory=TranscriptionConfig)
    frame_sampling: FrameSamplingConfig = field(default_factory=FrameSamplingConfig)
    ocr: OCRConfig = field(default_factory=OCRConfig)
    ui_tracking: UITrackingConfig = field(default_factory=UITrackingConfig)
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


def _parse_target_elements(raw: list[Any]) -> list[TargetElementConfig]:
    """Convert YAML target element dicts into dataclass instances."""
    elements: list[TargetElementConfig] = []
    for item in raw:
        if isinstance(item, TargetElementConfig):
            elements.append(item)
        elif isinstance(item, dict):
            elements.append(TargetElementConfig(**item))
    return elements


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

    ui_raw = raw.get("ui_tracking", {})
    if isinstance(ui_raw, dict) and "target_elements" in ui_raw:
        config.ui_tracking.target_elements = _parse_target_elements(
            ui_raw["target_elements"]
        )

    return config
