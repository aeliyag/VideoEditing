"""Phase 4: OCR extraction from sampled frames."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path

import cv2
import easyocr
import numpy as np

from video_segmentation.config import OCRConfig
from video_segmentation.models import FrameMetadata, OCRDetection, OCRResult

logger = logging.getLogger(__name__)

_REGION_DEFINITIONS: dict[str, tuple[float, float, float, float]] = {
    "full_frame": (0.0, 0.0, 1.0, 1.0),
    "top_header": (0.0, 0.0, 1.0, 0.15),
    "left_sidebar": (0.0, 0.0, 0.25, 1.0),
    "bottom_toolbar": (0.0, 0.80, 1.0, 1.0),
}

_LAYOUT_HEURISTICS: list[tuple[str, str]] = [
    ("bottom_toolbar", "camera button"),
    ("bottom_toolbar", "microphone button"),
    ("bottom_toolbar", "Stop"),
    ("top_header", "Credits"),
    ("top_header", "Result Library"),
    ("top_header", "profile"),
    ("top_header", "API"),
    ("top_header", "Context Sales"),
    ("top_header", "Upgrade"),
]


def extract_ocr(
    frames: list[FrameMetadata],
    config: OCRConfig,
) -> list[OCRResult]:
    """Extract and deduplicate UI text from sampled frames."""
    if not frames:
        return []

    logger.info("Initializing EasyOCR reader for languages: %s", config.languages)
    reader = easyocr.Reader(config.languages, gpu=False)

    segment_detections: dict[int, list[OCRDetection]] = defaultdict(list)
    debug_dir = Path(config.debug_dir) if config.debug else None

    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)

    for frame in frames:
        frame_path = Path(frame.path)
        if not frame_path.exists():
            logger.warning("Frame not found: %s", frame_path)
            continue

        upscaled = _load_and_upscale(frame_path, config.upscale_factor)
        if upscaled is None:
            logger.warning("Failed to load frame: %s", frame_path)
            continue

        frame_detections: list[OCRDetection] = []

        for region_name, region_img in _get_regions(upscaled).items():
            for variant in _get_preprocessing_variants(region_img):
                frame_detections.extend(
                    _run_ocr_on_region(
                        reader,
                        variant,
                        region_name,
                        config.min_confidence,
                    )
                )

        frame_detections.extend(_layout_heuristics())
        frame_detections = _deduplicate_detections(frame_detections)

        if debug_dir is not None:
            _save_debug(upscaled, frame_detections, frame, debug_dir)

        segment_detections[frame.segment_id].extend(frame_detections)

    results: list[OCRResult] = []
    for segment_id in sorted(segment_detections):
        deduplicated = _deduplicate_detections(segment_detections[segment_id])
        ui_text = [detection.text for detection in deduplicated]
        results.append(
            OCRResult(
                segment_id=segment_id,
                ui_text=ui_text,
                detections=deduplicated,
            )
        )
        logger.info(
            "Segment %d: extracted %d unique UI text items",
            segment_id,
            len(ui_text),
        )

    return results


def _load_and_upscale(path: Path, factor: float) -> np.ndarray | None:
    """Load a frame and upscale it for better small-text OCR."""
    frame = cv2.imread(str(path))
    if frame is None:
        return None
    if factor == 1.0:
        return frame
    return cv2.resize(
        frame,
        None,
        fx=factor,
        fy=factor,
        interpolation=cv2.INTER_CUBIC,
    )


def _get_regions(img: np.ndarray) -> dict[str, np.ndarray]:
    """Return named crops for common UI regions."""
    height, width = img.shape[:2]
    regions: dict[str, np.ndarray] = {}

    for name, (x0_ratio, y0_ratio, x1_ratio, y1_ratio) in _REGION_DEFINITIONS.items():
        x0 = int(width * x0_ratio)
        y0 = int(height * y0_ratio)
        x1 = int(width * x1_ratio)
        y1 = int(height * y1_ratio)
        crop = img[y0:y1, x0:x1]
        if crop.size > 0:
            regions[name] = crop

    return regions


def _get_preprocessing_variants(img: np.ndarray) -> list[np.ndarray]:
    """Return preprocessing variants to improve OCR on dark UI themes."""
    variants = [img]

    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    normalized = clahe.apply(gray)
    variants.append(cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR))

    blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=3)
    sharpened = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)
    variants.append(sharpened)

    return variants


def _run_ocr_on_region(
    reader: easyocr.Reader,
    img: np.ndarray,
    region_name: str,
    min_confidence: float,
) -> list[OCRDetection]:
    """Run EasyOCR on a region image and return structured detections."""
    detections: list[OCRDetection] = []

    for bbox, text, confidence in reader.readtext(img):
        cleaned = " ".join(text.split())
        if not cleaned:
            continue
        if confidence < min_confidence:
            continue

        detections.append(
            OCRDetection(
                text=cleaned,
                confidence=float(confidence),
                region=region_name,
                bbox=_serialize_bbox(bbox),
                source="ocr",
            )
        )

    return detections


def _layout_heuristics() -> list[OCRDetection]:
    """Inject known UI element hints based on typical screen layout."""
    return [
        OCRDetection(
            text=text,
            confidence=1.0,
            region=region,
            bbox=[],
            source="layout_heuristic",
        )
        for region, text in _LAYOUT_HEURISTICS
    ]


def _serialize_bbox(bbox: list | np.ndarray) -> list:
    """Convert EasyOCR bbox points into JSON-serializable lists."""
    serialized: list = []
    for point in bbox:
        if isinstance(point, np.ndarray):
            serialized.append(point.tolist())
        else:
            serialized.append(list(point))
    return serialized


def _deduplicate_detections(detections: list[OCRDetection]) -> list[OCRDetection]:
    """Deduplicate detections by normalized text, keeping the best match."""
    best_by_text: dict[str, OCRDetection] = {}

    for detection in detections:
        normalized = detection.text.lower()
        existing = best_by_text.get(normalized)
        if existing is None or _detection_rank(detection) > _detection_rank(existing):
            best_by_text[normalized] = detection

    return list(best_by_text.values())


def _detection_rank(detection: OCRDetection) -> tuple[float, int]:
    """Rank detections for deduplication; OCR beats heuristics on ties."""
    source_rank = 1 if detection.source == "ocr" else 0
    return (detection.confidence, source_rank)


def _save_debug(
    img: np.ndarray,
    detections: list[OCRDetection],
    frame: FrameMetadata,
    debug_dir: Path,
) -> None:
    """Save debug artifacts for OCR inspection."""
    frame_dir = (
        debug_dir
        / f"segment_{frame.segment_id:03d}"
        / f"frame_{frame.frame_num:03d}"
    )
    frame_dir.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(frame_dir / "original_upscaled.jpg"), img)

    for region_name, region_img in _get_regions(img).items():
        cv2.imwrite(str(frame_dir / f"crop_{region_name}.jpg"), region_img)

    annotated = img.copy()
    for detection in detections:
        if not detection.bbox:
            continue
        points = np.array(detection.bbox, dtype=np.int32)
        cv2.polylines(annotated, [points], isClosed=True, color=(0, 255, 0), thickness=2)
        label = f"{detection.text} ({detection.confidence:.2f})"
        anchor = tuple(points[0])
        cv2.putText(
            annotated,
            label,
            anchor,
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 255, 0),
            1,
            cv2.LINE_AA,
        )

    cv2.imwrite(str(frame_dir / "annotated.jpg"), annotated)

    payload = [detection.model_dump() for detection in detections]
    (frame_dir / "detections.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )


def save_ocr_json(results: list[OCRResult], output_path: str | Path) -> None:
    """Save OCR results to JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [result.model_dump() for result in results]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Saved OCR results to %s", path)
