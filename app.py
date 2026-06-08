"""Streamlit UI for uploading a video and selecting a zoom target rectangle."""

from __future__ import annotations

import tempfile
from pathlib import Path

import cv2
import numpy as np
import streamlit as st
from PIL import Image
from streamlit_drawable_canvas import st_canvas

MAX_CANVAS_WIDTH = 800
SUPPORTED_VIDEO_TYPES = ["mp4", "mov", "avi"]


def extract_first_frame(video_bytes: bytes, suffix: str) -> np.ndarray:
    """Write uploaded bytes to a temp file and return the first frame (RGB)."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        capture = cv2.VideoCapture(tmp_path)
        if not capture.isOpened():
            raise RuntimeError("Unable to open uploaded video.")

        success, frame = capture.read()
        capture.release()

        if not success or frame is None:
            raise RuntimeError("Unable to read the first frame from the video.")

        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def scale_frame_for_display(
    frame: np.ndarray,
    max_width: int = MAX_CANVAS_WIDTH,
) -> tuple[Image.Image, float]:
    """Scale frame to fit max width; return PIL image and scale factor."""
    height, width = frame.shape[:2]
    scale = 1.0 if width <= max_width else max_width / width

    display_width = int(round(width * scale))
    display_height = int(round(height * scale))

    pil_image = Image.fromarray(frame).resize(
        (display_width, display_height),
        Image.Resampling.LANCZOS,
    )
    return pil_image, scale


def parse_rectangle_from_canvas(
    canvas_data: dict | None,
    scale: float,
) -> dict[str, int] | None:
    """Extract the first rectangle from canvas JSON and map to source coordinates."""
    if not canvas_data or not canvas_data.get("objects"):
        return None

    rect = canvas_data["objects"][0]
    if rect.get("type") != "rect":
        return None

    inv_scale = 1.0 / scale if scale > 0 else 1.0
    return {
        "x": int(round(rect["left"] * inv_scale)),
        "y": int(round(rect["top"] * inv_scale)),
        "width": int(round(rect["width"] * inv_scale)),
        "height": int(round(rect["height"] * inv_scale)),
    }


def init_session_state() -> None:
    """Ensure required session state keys exist."""
    if "frame" not in st.session_state:
        st.session_state.frame = None
    if "zoom_rect" not in st.session_state:
        st.session_state.zoom_rect = None


def render_coordinate_display(zoom_rect: dict[str, int] | None) -> None:
    """Show rectangle coordinates in the UI."""
    st.subheader("Zoom target coordinates")

    if zoom_rect is None:
        st.info("Draw a rectangle on the frame to define the zoom target region.")
        return

    col_x, col_y, col_w, col_h = st.columns(4)
    col_x.metric("x", zoom_rect["x"])
    col_y.metric("y", zoom_rect["y"])
    col_w.metric("width", zoom_rect["width"])
    col_h.metric("height", zoom_rect["height"])


def main() -> None:
    st.set_page_config(page_title="Video Zoom Selector", layout="wide")
    st.title("Video Zoom Selector")
    st.caption("Upload a video and draw a rectangle on the first frame.")

    init_session_state()

    uploaded = st.file_uploader(
        "Upload a video",
        type=SUPPORTED_VIDEO_TYPES,
        help="Supported formats: .mp4, .mov, .avi",
    )

    if uploaded is not None:
        suffix = Path(uploaded.name).suffix or ".mp4"
        try:
            st.session_state.frame = extract_first_frame(uploaded.getvalue(), suffix)
        except RuntimeError as exc:
            st.error(str(exc))
            st.session_state.frame = None

    frame = st.session_state.frame
    if frame is None:
        st.stop()

    display_image, scale = scale_frame_for_display(frame)

    st.subheader("First frame")
    st.caption("Draw a single rectangle to select the zoom target region.")

    canvas_result = st_canvas(
        fill_color="rgba(255, 165, 0, 0.3)",
        stroke_width=2,
        stroke_color="#FF6600",
        background_image=display_image,
        update_streamlit=True,
        height=display_image.height,
        width=display_image.width,
        drawing_mode="rect",
        display_toolbar=True,
        key="zoom_canvas",
    )

    zoom_rect = parse_rectangle_from_canvas(
        canvas_result.json_data if canvas_result else None,
        scale,
    )
    st.session_state.zoom_rect = zoom_rect
    render_coordinate_display(zoom_rect)


if __name__ == "__main__":
    main()
