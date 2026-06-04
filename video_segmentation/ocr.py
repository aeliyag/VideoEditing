"""Phase 4: OCR extraction from sampled frames."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path

import easyocr

from video_segmentation.config import OCRConfig
from video_segmentation.models import FrameMetadata, OCRResult

logger = logging.getLogger(__name__)


def extract_ocr(
    frames: list[FrameMetadata],
    config: OCRConfig,
) -> list[OCRResult]:
    """Extract and deduplicate UI text from sampled frames."""
    if not frames:
        return []

    logger.info("Initializing EasyOCR reader for languages: %s", config.languages)
    reader = easyocr.Reader(config.languages, gpu=False)

    segment_text: dict[int, list[str]] = defaultdict(list)

    for frame in frames:
        frame_path = Path(frame.path)
        if not frame_path.exists():
            logger.warning("Frame not found: %s", frame_path)
            continue

        detections = reader.readtext(str(frame_path))
        for _bbox, text, confidence in detections:
            if confidence < config.min_confidence:
                continue
            cleaned = text.strip()
            if cleaned:
                segment_text[frame.segment_id].append(cleaned)

    results: list[OCRResult] = []
    for segment_id in sorted(segment_text):
        deduplicated = _deduplicate_text(segment_text[segment_id])
        results.append(OCRResult(segment_id=segment_id, ui_text=deduplicated))
        logger.info("Segment %d: extracted %d unique UI text items", segment_id, len(deduplicated))

    return results


def _deduplicate_text(text_items: list[str]) -> list[str]:
    """Deduplicate text case-insensitively while preserving first-seen casing."""
    seen: set[str] = set()
    unique: list[str] = []

    for item in text_items:
        normalized = " ".join(item.split()).lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique.append(" ".join(item.split()))

    return unique


def save_ocr_json(results: list[OCRResult], output_path: str | Path) -> None:
    """Save OCR results to JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [result.model_dump() for result in results]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Saved OCR results to %s", path)
