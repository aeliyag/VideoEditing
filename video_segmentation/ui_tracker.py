"""UI element tracking with target inventory matching and spatial linking."""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher

from video_segmentation.config import TargetElementConfig, UITrackingConfig
from video_segmentation.models import (
    FrameOCRResult,
    MatchedOCRDebug,
    OCRDetection,
    RejectedOCRDebug,
    TrackingDebugOutput,
    TrackingResult,
    UIElementObservation,
    UIElementTrack,
    UnmatchedObservation,
)

logger = logging.getLogger(__name__)

_MATCH_RANK = {"exact": 3, "substring": 2, "fuzzy": 1}


def normalize_ocr_text(text: str) -> str:
    """Normalize OCR text for matching."""
    lowered = text.lower()
    cleaned = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return " ".join(cleaned.split())


def reject_noisy_detection(
    normalized: str,
    config: UITrackingConfig,
) -> str | None:
    """Return rejection reason, or None if the detection passes noise filters."""
    if not normalized:
        return "empty"

    if config.reject_single_char and len(normalized.replace(" ", "")) == 1:
        return "single_char"

    if len(normalized) < config.min_label_length:
        return "below_min_length"

    if config.reject_numeric_noise and normalized.replace(" ", "").isdigit():
        return "numeric_noise"

    alpha_count = sum(char.isalpha() for char in normalized)
    if alpha_count == 0:
        return "non_alpha"

    non_alpha_ratio = 1.0 - (alpha_count / max(len(normalized.replace(" ", "")), 1))
    if non_alpha_ratio > 0.5:
        return "high_non_alpha_ratio"

    return None


def _match_label(
    normalized_text: str,
    label: str,
    config: UITrackingConfig,
) -> tuple[str, float] | None:
    """Return match type and score for a single target label."""
    normalized_label = normalize_ocr_text(label)
    if not normalized_label:
        return None

    if normalized_text == normalized_label:
        return "exact", 1.0

    if normalized_label in normalized_text or normalized_text in normalized_label:
        return "substring", 0.95

    short_label = (
        len(normalized_text) <= config.exact_match_only_max_length
        or len(normalized_label) <= config.exact_match_only_max_length
    )
    if short_label:
        return None

    ratio = SequenceMatcher(None, normalized_text, normalized_label).ratio()
    if ratio >= config.fuzzy_match_threshold:
        return "fuzzy", ratio

    return None


def match_detection_to_target(
    normalized_text: str,
    region: str,
    config: UITrackingConfig,
) -> tuple[TargetElementConfig, str, float] | None:
    """Match normalized OCR text to a configured target element."""
    best: tuple[TargetElementConfig, str, float] | None = None

    for target in config.target_elements:
        if region not in target.regions:
            continue

        for label in target.labels:
            match = _match_label(normalized_text, label, config)
            if match is None:
                continue

            match_type, score = match
            rank = _MATCH_RANK[match_type]
            if best is None:
                best = (target, match_type, score)
                continue

            best_rank = _MATCH_RANK[best[1]]
            if rank > best_rank or (rank == best_rank and score > best[2]):
                best = (target, match_type, score)

    return best


def _center_distance(a: list[float], b: list[float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _bbox_iou(a: list[float], b: list[float]) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])

    if x2 <= x1 or y2 <= y1:
        return 0.0

    intersection = (x2 - x1) * (y2 - y1)
    area_a = max(a[2] - a[0], 0.0) * max(a[3] - a[1], 0.0)
    area_b = max(b[2] - b[0], 0.0) * max(b[3] - b[1], 0.0)
    union = area_a + area_b - intersection
    if union <= 0:
        return 0.0
    return intersection / union


def _canonical_label(target: TargetElementConfig) -> str:
    return target.labels[0]


def _observation_from_detection(
    detection: OCRDetection,
    frame_result: FrameOCRResult,
    target: TargetElementConfig | None,
    matched_text: str,
) -> UIElementObservation:
    return UIElementObservation(
        timestamp=frame_result.frame.timestamp,
        segment_id=frame_result.frame.segment_id,
        bbox=list(detection.bbox),
        center=list(detection.center),
        width=detection.width,
        height=detection.height,
        confidence=detection.confidence,
        source=detection.source,
        matched_text=matched_text,
    )


def _link_observations(
    observations: list[UIElementObservation],
    config: UITrackingConfig,
) -> list[list[UIElementObservation]]:
    """Split observations into temporal track chains."""
    if not observations:
        return []

    sorted_obs = sorted(observations, key=lambda obs: obs.timestamp)
    chains: list[list[UIElementObservation]] = [[sorted_obs[0]]]

    for observation in sorted_obs[1:]:
        current_chain = chains[-1]
        last = current_chain[-1]
        gap = observation.timestamp - last.timestamp
        close_in_time = gap <= config.max_gap_seconds
        close_in_space = (
            _center_distance(observation.center, last.center)
            <= config.max_center_distance
        )
        overlapping = _bbox_iou(observation.bbox, last.bbox) > 0.3

        if close_in_time and (close_in_space or overlapping):
            current_chain.append(observation)
        else:
            chains.append([observation])

    return chains


def _build_track(
    element_id: str,
    label: str,
    element_type: str,
    observations: list[UIElementObservation],
    config: UITrackingConfig,
    track_suffix: int = 1,
) -> UIElementTrack:
    track_id = element_id if track_suffix == 1 else f"{element_id}_{track_suffix}"
    first_center = observations[0].center
    last_center = observations[-1].center
    moved = (
        _center_distance(first_center, last_center) > config.movement_threshold
    )

    return UIElementTrack(
        element_id=track_id,
        label=label,
        element_type=element_type,
        observations=observations,
        first_center=first_center,
        last_center=last_center,
        position_changed=moved,
    )


def build_ui_tracks(
    frame_results: list[FrameOCRResult],
    config: UITrackingConfig,
) -> TrackingResult:
    """Build UI element tracks from per-frame OCR detections."""
    debug = TrackingDebugOutput()
    matched_observations: dict[str, list[UIElementObservation]] = {}
    matched_meta: dict[str, tuple[TargetElementConfig, str]] = {}
    discovery_observations: dict[str, list[UIElementObservation]] = {}

    for frame_result in frame_results:
        for detection in frame_result.detections:
            raw_text = detection.text
            normalized = normalize_ocr_text(raw_text)

            if detection.source == "layout_heuristic":
                rejection = None
            else:
                rejection = reject_noisy_detection(normalized, config)

            if rejection is not None:
                debug.rejected_ocr.append(
                    RejectedOCRDebug(
                        raw_text=raw_text,
                        normalized_text=normalized,
                        region=detection.region,
                        rejection_reason=rejection,
                    )
                )
                continue

            match = match_detection_to_target(
                normalized,
                detection.region,
                config,
            )

            if match is not None:
                target, match_type, _score = match
                matched_text = "" if detection.source == "layout_heuristic" else raw_text
                observation = _observation_from_detection(
                    detection,
                    frame_result,
                    target,
                    matched_text,
                )
                matched_observations.setdefault(target.element_id, []).append(
                    observation
                )
                matched_meta[target.element_id] = (target, match_type)
                debug.matched_ocr.append(
                    MatchedOCRDebug(
                        raw_text=raw_text,
                        normalized_text=normalized,
                        region=detection.region,
                        element_id=target.element_id,
                        match_type=match_type,
                        confidence=detection.confidence,
                    )
                )
                continue

            if config.mode == "discovery":
                slug = normalized.replace(" ", "_") or "unknown"
                observation = _observation_from_detection(
                    detection,
                    frame_result,
                    None,
                    raw_text,
                )
                discovery_observations.setdefault(slug, []).append(observation)
                continue

            unmatched = UnmatchedObservation(
                text=raw_text,
                normalized_text=normalized,
                region=detection.region,
                timestamp=frame_result.frame.timestamp,
                segment_id=frame_result.frame.segment_id,
                bbox=list(detection.bbox),
                center=list(detection.center),
                confidence=detection.confidence,
                rejection_reason="no_target_match",
            )
            debug.unmatched_observations.append(unmatched)

            if config.mode == "targeted":
                debug.rejected_ocr.append(
                    RejectedOCRDebug(
                        raw_text=raw_text,
                        normalized_text=normalized,
                        region=detection.region,
                        rejection_reason="no_target_match",
                    )
                )

    tracks: list[UIElementTrack] = []

    if config.mode == "discovery":
        for slug, observations in discovery_observations.items():
            for index, chain in enumerate(
                _link_observations(observations, config),
                start=1,
            ):
                tracks.append(
                    _build_track(
                        element_id=slug,
                        label=slug.replace("_", " "),
                        element_type="unknown",
                        observations=chain,
                        config=config,
                        track_suffix=index,
                    )
                )
    else:
        track_counts: dict[str, int] = {}
        for element_id, observations in matched_observations.items():
            target, _match_type = matched_meta[element_id]
            chains = _link_observations(observations, config)
            for chain in chains:
                track_counts[element_id] = track_counts.get(element_id, 0) + 1
                tracks.append(
                    _build_track(
                        element_id=element_id,
                        label=_canonical_label(target),
                        element_type=target.type,
                        observations=chain,
                        config=config,
                        track_suffix=track_counts[element_id],
                    )
                )

    logger.info("Built %d UI element tracks (mode=%s)", len(tracks), config.mode)
    return TrackingResult(
        ui_element_tracks=tracks,
        unmatched_observations=debug.unmatched_observations,
        debug=debug,
    )
