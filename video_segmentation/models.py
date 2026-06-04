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
    bbox: list = Field(default_factory=list)
    source: str = "ocr"


class OCRResult(BaseModel):
    """OCR-extracted UI text for a segment."""

    segment_id: int = Field(ge=1)
    ui_text: list[str] = Field(default_factory=list)
    detections: list[OCRDetection] = Field(default_factory=list)


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
