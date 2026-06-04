"""Shared Pydantic data models for the video segmentation pipeline."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SceneSegment(BaseModel):
    """A detected scene segment with start and end timestamps in seconds."""

    start: float = Field(ge=0.0)
    end: float = Field(gt=0.0)


class TranscriptChunk(BaseModel):
    """A transcript chunk with timestamps and text."""

    start: float = Field(ge=0.0)
    end: float = Field(gt=0.0)
    text: str


class FrameMetadata(BaseModel):
    """Metadata for a sampled frame from a video segment."""

    segment_id: int = Field(ge=1)
    frame_num: int = Field(ge=1)
    timestamp: float = Field(ge=0.0)
    path: str


class OCRDetection(BaseModel):
    """A single OCR or heuristic UI detection."""

    text: str
    confidence: float
    region: str
    bbox: list[float] = Field(default_factory=list)
    center: list[float] = Field(default_factory=list)
    width: float = 0.0
    height: float = 0.0
    source: str = "ocr"


class FrameOCRResult(BaseModel):
    """Per-frame OCR detections for UI tracking."""

    frame: FrameMetadata
    detections: list[OCRDetection] = Field(default_factory=list)


class OCRResult(BaseModel):
    """OCR-extracted UI text for a segment (internal/debug use)."""

    segment_id: int = Field(ge=1)
    ui_text: list[str] = Field(default_factory=list)
    detections: list[OCRDetection] = Field(default_factory=list)


class UIElementObservation(BaseModel):
    """A single spatial observation of a tracked UI element."""

    timestamp: float
    segment_id: int
    bbox: list[float]
    center: list[float]
    width: float
    height: float
    confidence: float
    source: str
    matched_text: str = ""


class UIElementTrack(BaseModel):
    """A tracked UI element with observations over time."""

    element_id: str
    label: str
    element_type: str
    observations: list[UIElementObservation] = Field(default_factory=list)
    first_center: list[float] = Field(default_factory=list)
    last_center: list[float] = Field(default_factory=list)
    position_changed: bool = False


class UnmatchedObservation(BaseModel):
    """OCR detection that passed noise filter but did not match a target."""

    text: str
    normalized_text: str
    region: str
    timestamp: float
    segment_id: int
    bbox: list[float]
    center: list[float]
    confidence: float
    rejection_reason: str | None = None


class MatchedOCRDebug(BaseModel):
    """Debug record for a successful target match."""

    raw_text: str
    normalized_text: str
    region: str
    element_id: str
    match_type: str
    confidence: float


class RejectedOCRDebug(BaseModel):
    """Debug record for a rejected OCR detection."""

    raw_text: str
    normalized_text: str
    region: str
    rejection_reason: str


class TrackingDebugOutput(BaseModel):
    """Debug output from the UI tracking pipeline."""

    matched_ocr: list[MatchedOCRDebug] = Field(default_factory=list)
    rejected_ocr: list[RejectedOCRDebug] = Field(default_factory=list)
    unmatched_observations: list[UnmatchedObservation] = Field(default_factory=list)


class TrackingResult(BaseModel):
    """Output of the UI element tracker."""

    ui_element_tracks: list[UIElementTrack] = Field(default_factory=list)
    unmatched_observations: list[UnmatchedObservation] = Field(default_factory=list)
    debug: TrackingDebugOutput = Field(default_factory=TrackingDebugOutput)


class TimelineSegment(BaseModel):
    """A fully enriched segment in the final timeline."""

    id: int = Field(ge=1)
    title: str
    description: str
    start_time: float = Field(ge=0.0)
    end_time: float = Field(gt=0.0)
    transcript: list[str] = Field(default_factory=list)
    ui_elements: list[str] = Field(default_factory=list)


class Timeline(BaseModel):
    """Final semantic timeline output."""

    segments: list[TimelineSegment] = Field(default_factory=list)
    ui_element_tracks: list[UIElementTrack] = Field(default_factory=list)
    tracking_debug: TrackingDebugOutput | None = None
