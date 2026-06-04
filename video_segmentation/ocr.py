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
from video_segmentation.models import (
    FrameMetadata,
    FrameOCRResult,
    OCRDetection,
    OCRResult,
)

logger = logging.getLogger(__name__)

_REGION_DEFINITIONS: dict[str, tuple[float, float, float, float]] = {
    "full_frame": (0.0, 0.0, 1.0, 1.0),
    "top_header": (0.0, 0.0, 1.0, 0.15),
    "left_sidebar": (0.0, 0.0, 0.25, 1.0),
    "bottom_toolbar": (0.0, 0.80, 1.0, 1.0),
    "right_controls": (0.75, 0.80, 1.0, 1.0),
    "main_content": (0.25, 0.15, 0.75, 0.80),
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
) -> tuple[list[OCRResult], list[FrameOCRResult]]:
    """Extract UI text from sampled frames with per-frame spatial data."""
    if not frames:
        return [], []

    logger.info("Initializing EasyOCR reader for languages: %s", config.languages)
    print(
        f"[OCR] Initializing EasyOCR reader ({', '.join(config.languages)})...",
        flush=True,
    )
    reader = easyocr.Reader(config.languages, gpu=False)
    print("[OCR] Reader ready.", flush=True)

    segment_detections: dict[int, list[OCRDetection]] = defaultdict(list)
    frame_results: list[FrameOCRResult] = []
    debug_dir = Path(config.debug_dir) if config.debug else None
    total_frames = len(frames)
    progress_interval = max(1, total_frames // 20)

    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)

    print(f"[OCR] Processing {total_frames} frames...", flush=True)

    for frame_index, frame in enumerate(frames, start=1):
        frame_path = Path(frame.path)
        if not frame_path.exists():
            logger.warning("Frame not found: %s", frame_path)
            continue

        upscaled = _load_and_upscale(frame_path, config.upscale_factor)
        if upscaled is None:
            logger.warning("Failed to load frame: %s", frame_path)
            continue

        frame_height, frame_width = upscaled.shape[:2]
        frame_detections: list[OCRDetection] = []

        for region_name, region_img in _get_regions(upscaled).items():
            x0, y0 = _region_offset(region_name, frame_width, frame_height)
            for variant in _get_preprocessing_variants(region_img):
                frame_detections.extend(
                    _run_ocr_on_region(
                        reader,
                        variant,
                        region_name,
                        config.min_confidence,
                        x0,
                        y0,
                        frame_width,
                        frame_height,
                    )
                )

        frame_detections.extend(
            _layout_heuristics(frame_width, frame_height)
        )
        frame_detections = _deduplicate_detections(frame_detections)

        if debug_dir is not None:
            _save_debug(upscaled, frame_detections, frame, debug_dir)

        frame_results.append(
            FrameOCRResult(frame=frame, detections=frame_detections)
        )
        segment_detections[frame.segment_id].extend(frame_detections)

        if frame_index == 1 or frame_index % progress_interval == 0 or frame_index == total_frames:
            print(
                f"[OCR] Frame {frame_index}/{total_frames} "
                f"(segment {frame.segment_id}, frame {frame.frame_num}): "
                f"{len(frame_detections)} detections",
                flush=True,
            )

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

    print(f"[OCR] Done. Processed {len(frame_results)} frames.", flush=True)
    return results, frame_results


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


def _region_offset(region_name: str, frame_w: int, frame_h: int) -> tuple[int, int]:
    """Return pixel offset of a region crop on the full frame."""
    x0_ratio, y0_ratio, _, _ = _REGION_DEFINITIONS[region_name]
    return int(frame_w * x0_ratio), int(frame_h * y0_ratio)


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


def _to_full_frame_bbox(
    bbox_points: list,
    x0: int,
    y0: int,
    frame_w: int,
    frame_h: int,
) -> tuple[list[float], list[float], float, float]:
    """Convert region-relative bbox points to normalized full-frame coordinates."""
    xs = [float(point[0]) + x0 for point in bbox_points]
    ys = [float(point[1]) + y0 for point in bbox_points]

    x1 = min(xs) / frame_w
    y1 = min(ys) / frame_h
    x2 = max(xs) / frame_w
    y2 = max(ys) / frame_h

    width = x2 - x1
    height = y2 - y1
    center = [(x1 + x2) / 2.0, (y1 + y2) / 2.0]

    return [x1, y1, x2, y2], center, width, height


def _region_centroid_bbox(region_name: str) -> tuple[list[float], list[float], float, float]:
    """Return a small normalized bbox at the region centroid for heuristics."""
    x0_ratio, y0_ratio, x1_ratio, y1_ratio = _REGION_DEFINITIONS[region_name]
    cx = (x0_ratio + x1_ratio) / 2.0
    cy = (y0_ratio + y1_ratio) / 2.0
    half = 0.025
    bbox = [cx - half, cy - half, cx + half, cy + half]
    center = [cx, cy]
    return bbox, center, half * 2, half * 2


def _run_ocr_on_region(
    reader: easyocr.Reader,
    img: np.ndarray,
    region_name: str,
    min_confidence: float,
    x0: int,
    y0: int,
    frame_w: int,
    frame_h: int,
) -> list[OCRDetection]:
    """Run EasyOCR on a region image and return structured detections."""
    detections: list[OCRDetection] = []

    for bbox, text, confidence in reader.readtext(img):
        cleaned = " ".join(text.split())
        if not cleaned:
            continue
        if confidence < min_confidence:
            continue

        norm_bbox, center, width, height = _to_full_frame_bbox(
            _serialize_bbox(bbox),
            x0,
            y0,
            frame_w,
            frame_h,
        )

        detections.append(
            OCRDetection(
                text=cleaned,
                confidence=float(confidence),
                region=region_name,
                bbox=norm_bbox,
                center=center,
                width=width,
                height=height,
                source="ocr",
            )
        )

    return detections


def _layout_heuristics(frame_w: int, frame_h: int) -> list[OCRDetection]:
    """Inject known UI element hints with region-centroid bboxes."""
    del frame_w, frame_h
    detections: list[OCRDetection] = []

    for region, text in _LAYOUT_HEURISTICS:
        bbox, center, width, height = _region_centroid_bbox(region)
        detections.append(
            OCRDetection(
                text=text,
                confidence=1.0,
                region=region,
                bbox=bbox,
                center=center,
                width=width,
                height=height,
                source="layout_heuristic",
            )
        )

    return detections


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

    height, width = img.shape[:2]
    for region_name, region_img in _get_regions(img).items():
        cv2.imwrite(str(frame_dir / f"crop_{region_name}.jpg"), region_img)

    annotated = img.copy()
    for detection in detections:
        if not detection.bbox:
            continue
        x1 = int(detection.bbox[0] * width)
        y1 = int(detection.bbox[1] * height)
        x2 = int(detection.bbox[2] * width)
        y2 = int(detection.bbox[3] * height)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"{detection.text} ({detection.confidence:.2f})"
        cv2.putText(
            annotated,
            label,
            (x1, max(y1 - 5, 0)),
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
