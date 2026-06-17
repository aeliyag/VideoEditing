"""Streamlit UI for drawing and editing timed red-box video highlights."""

from __future__ import annotations

import math
import tempfile
from pathlib import Path

import cv2
import numpy as np
import streamlit as st
from PIL import Image, ImageDraw
from streamlit_drawable_canvas import st_canvas

from effects.highlight_timeline import BoundingBox, HighlightEvent, HighlightTimeline, active_events_at
from render import render_highlight_video

MAX_CANVAS_WIDTH = 800
SUPPORTED_VIDEO_TYPES = ["mp4", "mov", "avi"]
HIGHLIGHT_COLOR = "#FF0000"
CANVAS_STROKE_WIDTH = 3


def extract_frame_at_time(video_bytes: bytes, suffix: str, timestamp: float) -> np.ndarray:
    """Return the video frame at ``timestamp`` seconds as an RGB array."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        capture = cv2.VideoCapture(tmp_path)
        if not capture.isOpened():
            raise RuntimeError("Unable to open uploaded video.")

        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        frame_index = max(0, int(round(timestamp * fps)))
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        success, frame = capture.read()
        capture.release()

        if not success or frame is None:
            raise RuntimeError(f"Unable to read frame at {timestamp:.2f}s.")

        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def get_video_duration(video_bytes: bytes, suffix: str) -> float:
    """Return video duration in seconds."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        capture = cv2.VideoCapture(tmp_path)
        if not capture.isOpened():
            return 0.0
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.release()
        return frame_count / fps if frame_count > 0 else 0.0
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
    """Extract the last rectangle from canvas JSON and map to source coordinates."""
    if not canvas_data or not canvas_data.get("objects"):
        return None

    rects = [obj for obj in canvas_data["objects"] if obj.get("type") == "rect"]
    if not rects:
        return None

    rect = rects[-1]
    inv_scale = 1.0 / scale if scale > 0 else 1.0
    return {
        "x": int(round(rect["left"] * inv_scale)),
        "y": int(round(rect["top"] * inv_scale)),
        "width": int(round(rect["width"] * inv_scale)),
        "height": int(round(rect["height"] * inv_scale)),
    }


def bbox_to_initial_drawing(bbox: BoundingBox, scale: float) -> dict:
    """Build canvas initial drawing JSON for an existing highlight bbox."""
    return {
        "version": "4.4.0",
        "objects": [
            {
                "type": "rect",
                "left": bbox.x * scale,
                "top": bbox.y * scale,
                "width": bbox.width * scale,
                "height": bbox.height * scale,
                "fill": "rgba(255, 0, 0, 0)",
                "stroke": HIGHLIGHT_COLOR,
                "strokeWidth": CANVAS_STROKE_WIDTH,
            }
        ],
    }


def draw_bbox_overlay(
    frame: np.ndarray,
    bbox: BoundingBox,
    color: tuple[int, int, int] = (255, 0, 0),
    stroke_width: int = 3,
) -> np.ndarray:
    """Draw an outline bounding box on a copy of the frame."""
    image = Image.fromarray(frame.copy())
    draw = ImageDraw.Draw(image)
    x1 = int(bbox.x)
    y1 = int(bbox.y)
    x2 = int(bbox.x + bbox.width)
    y2 = int(bbox.y + bbox.height)
    draw.rectangle([x1, y1, x2, y2], outline=color, width=stroke_width)
    return np.array(image)


def format_time_range(event: HighlightEvent, duration: float) -> str:
    """Format a human-readable time range for a highlight."""
    start = f"{event.start_time:.1f}s"
    if event.end_time is not None:
        end = f"{event.end_time:.1f}s"
    else:
        end = f"{duration:.1f}s (end of video)"
    return f"{start} – {end}"


def parse_end_time_input(end_time_input: str, start_time: float) -> tuple[float | None, str | None]:
    """Parse optional end time text; return (end_time, error_message)."""
    if not end_time_input.strip():
        return None, None
    try:
        end_time = float(end_time_input)
    except ValueError:
        return None, "End time must be a number or blank."
    if end_time <= start_time:
        return None, "End time must be greater than start time."
    return end_time, None


def show_image(image: Image.Image, caption: str = "") -> None:
    """Display an image with Streamlit version compatibility."""
    try:
        st.image(image, caption=caption, use_container_width=True)
    except TypeError:
        st.image(image, caption=caption, use_column_width=True)


def is_valid_editor_row(row: dict) -> bool:
    """Return True when a data-editor row contains a real highlight."""
    try:
        width = row.get("width")
        height = row.get("height")
        start = row.get("start_time")
        if width is None or height is None or start is None:
            return False
        if isinstance(width, float) and math.isnan(width):
            return False
        if isinstance(height, float) and math.isnan(height):
            return False
        if isinstance(start, float) and math.isnan(start):
            return False
        return float(width) > 0 and float(height) > 0
    except (TypeError, ValueError):
        return False


def save_timeline(timeline: HighlightTimeline) -> None:
    """Persist the timeline to session state."""
    st.session_state.highlight_timeline = timeline


def init_session_state() -> None:
    """Ensure required session state keys exist."""
    defaults = {
        "upload_key": None,
        "video_bytes": None,
        "video_suffix": ".mp4",
        "video_width": 0,
        "video_height": 0,
        "video_duration": 0.0,
        "highlight_timeline": None,
        "preview_timestamp": 0.0,
        "output_path": None,
        "output_bytes": None,
        "manual_start": 0.0,
        "manual_end": None,
        "manual_label": "",
        "draw_timestamp": 0.0,
        "editing_index": None,
        "canvas_revision": 0,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def timeline_to_rows(timeline: HighlightTimeline) -> list[dict]:
    return [
        {
            "start_time": event.start_time,
            "end_time": event.end_time,
            "label": event.label,
            "x": int(event.bbox.x),
            "y": int(event.bbox.y),
            "width": int(event.bbox.width),
            "height": int(event.bbox.height),
            "stroke_width": event.stroke_width,
        }
        for event in timeline.sorted_events()
    ]


def rows_to_timeline(rows: list[dict], template: HighlightTimeline) -> HighlightTimeline:
    events: list[HighlightEvent] = []
    for row in rows:
        if not is_valid_editor_row(row):
            continue
        end_time = row.get("end_time")
        if end_time is not None and isinstance(end_time, float) and math.isnan(end_time):
            end_time = None
        events.append(
            HighlightEvent(
                start_time=float(row["start_time"]),
                end_time=float(end_time) if end_time is not None else None,
                bbox=BoundingBox(
                    x=float(row["x"]),
                    y=float(row["y"]),
                    width=float(row["width"]),
                    height=float(row["height"]),
                ),
                label=str(row.get("label", "")),
                color=HIGHLIGHT_COLOR,
                stroke_width=int(row.get("stroke_width", 3)),
            )
        )
    return template.model_copy(update={"events": events})


def render_summary(timeline: HighlightTimeline) -> None:
    count = len(timeline.events)
    col1, col2 = st.columns([1, 3])
    col1.metric("Saved highlights", count)
    col2.info(
        "Draw red outline boxes on the video, add multiple highlights, "
        "then preview and export. Leave end time blank to keep a box visible until the video ends."
    )


def render_highlight_list(timeline: HighlightTimeline, duration: float) -> HighlightTimeline:
    """Show a compact list of highlights with edit and delete actions."""
    st.subheader("Your highlights")
    if not timeline.events:
        st.caption("No highlights yet. Draw a box above and click Add highlight.")
        return timeline

    sorted_events = list(enumerate(timeline.events))
    sorted_events.sort(key=lambda item: item[1].start_time)

    for display_index, (event_index, event) in enumerate(sorted_events, start=1):
        label = event.label or "Untitled"
        time_range = format_time_range(event, duration)
        col_info, col_edit, col_delete = st.columns([4, 1, 1])
        col_info.markdown(f"**#{display_index}** · {label} · {time_range}")
        if col_edit.button("Edit", key=f"edit_highlight_{event_index}"):
            st.session_state.editing_index = event_index
            st.session_state.manual_start = float(event.start_time)
            st.session_state.manual_end = event.end_time
            st.session_state.manual_label = event.label
            st.session_state.draw_timestamp = float(event.start_time)
            st.session_state.canvas_revision += 1
            st.rerun()
        if col_delete.button("Delete", key=f"delete_highlight_{event_index}"):
            updated_events = [
                item for idx, item in enumerate(timeline.events) if idx != event_index
            ]
            timeline = timeline.model_copy(update={"events": updated_events})
            if st.session_state.editing_index == event_index:
                st.session_state.editing_index = None
            elif (
                st.session_state.editing_index is not None
                and st.session_state.editing_index > event_index
            ):
                st.session_state.editing_index -= 1
            save_timeline(timeline)
            st.rerun()

    return timeline


def render_timeline_editor(timeline: HighlightTimeline) -> HighlightTimeline:
    st.subheader("All highlights")
    st.caption("Edit coordinates and timing directly in the table, or use Edit above to redraw a box.")
    if not timeline.events:
        st.caption("Highlights you add will appear here.")
        return timeline

    rows = timeline_to_rows(timeline)
    edited = st.data_editor(
        rows,
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "start_time": st.column_config.NumberColumn("Start (s)", min_value=0.0, step=0.1),
            "end_time": st.column_config.NumberColumn(
                "End (s)",
                min_value=0.0,
                step=0.1,
                help="Leave blank to show until end of video",
            ),
            "label": st.column_config.TextColumn("Label"),
            "x": st.column_config.NumberColumn("X", min_value=0, step=1),
            "y": st.column_config.NumberColumn("Y", min_value=0, step=1),
            "width": st.column_config.NumberColumn("Width", min_value=1, step=1),
            "height": st.column_config.NumberColumn("Height", min_value=1, step=1),
            "stroke_width": st.column_config.NumberColumn("Stroke", min_value=1, step=1),
        },
    )
    return rows_to_timeline(edited, timeline)


def render_add_or_edit_section(
    video_bytes: bytes,
    suffix: str,
    timeline: HighlightTimeline,
    duration: float,
) -> HighlightTimeline:
    editing_index = st.session_state.editing_index
    is_editing = editing_index is not None

    st.subheader("Edit highlight" if is_editing else "Add highlight")
    if is_editing:
        st.caption(f"Editing highlight #{editing_index + 1}. Redraw the box or adjust fields, then click Update.")

    col_start, col_end, col_label = st.columns(3)
    start_time = col_start.number_input("Start (s)", min_value=0.0, step=0.1, key="manual_start")
    end_default = ""
    if st.session_state.manual_end is not None:
        end_default = str(st.session_state.manual_end)
    end_time_input = col_end.text_input(
        "End (s)",
        value=end_default,
        help="Leave blank to show until end of video",
        key="manual_end_input",
    )
    label = col_label.text_input("Label", key="manual_label")

    draw_timestamp = st.number_input(
        "Draw box on frame at (s)",
        min_value=0.0,
        max_value=max(duration, 0.0),
        step=0.1,
        key="draw_timestamp",
    )

    frame = extract_frame_at_time(video_bytes, suffix, draw_timestamp)
    display_image, scale = scale_frame_for_display(frame)
    if display_image.mode != "RGB":
        display_image = display_image.convert("RGB")

    st.caption(f"Frame at {draw_timestamp:.1f}s — draw a red outline box on the image below")
    show_image(display_image, caption="Reference frame")

    initial_drawing = None
    if is_editing and 0 <= editing_index < len(timeline.events):
        initial_drawing = bbox_to_initial_drawing(timeline.events[editing_index].bbox, scale)

    canvas_key = f"highlight_canvas_{st.session_state.canvas_revision}"
    canvas_result = st_canvas(
        fill_color="rgba(255, 0, 0, 0)",
        stroke_width=CANVAS_STROKE_WIDTH,
        stroke_color=HIGHLIGHT_COLOR,
        background_image=display_image,
        initial_drawing=initial_drawing,
        update_streamlit=True,
        height=display_image.height,
        width=display_image.width,
        drawing_mode="rect",
        display_toolbar=True,
        key=canvas_key,
    )

    highlight_rect = parse_rectangle_from_canvas(
        canvas_result.json_data if canvas_result else None,
        scale,
    )

    if is_editing and highlight_rect is None and 0 <= editing_index < len(timeline.events):
        existing = timeline.events[editing_index].bbox
        highlight_rect = {
            "x": int(existing.x),
            "y": int(existing.y),
            "width": int(existing.width),
            "height": int(existing.height),
        }

    action_col1, action_col2, _ = st.columns([1, 1, 2])
    save_label = "Update highlight" if is_editing else "Add highlight"
    if action_col1.button(save_label, disabled=highlight_rect is None):
        end_time, error = parse_end_time_input(end_time_input, start_time)
        if error:
            st.error(error)
            return timeline

        new_event = HighlightEvent(
            start_time=float(start_time),
            end_time=end_time,
            bbox=BoundingBox(
                x=float(highlight_rect["x"]),
                y=float(highlight_rect["y"]),
                width=float(highlight_rect["width"]),
                height=float(highlight_rect["height"]),
            ),
            label=label,
            color=HIGHLIGHT_COLOR,
        )

        if is_editing:
            updated_events = list(timeline.events)
            updated_events[editing_index] = new_event
            timeline = timeline.model_copy(update={"events": updated_events})
            st.session_state.editing_index = None
        else:
            timeline = timeline.model_copy(update={"events": timeline.events + [new_event]})

        save_timeline(timeline)
        st.session_state.preview_timestamp = float(start_time)
        st.session_state.canvas_revision += 1
        st.session_state.manual_end = end_time
        st.rerun()

    if is_editing and action_col2.button("Cancel edit"):
        st.session_state.editing_index = None
        st.session_state.canvas_revision += 1
        st.rerun()

    return timeline


def render_preview_section(
    video_bytes: bytes,
    suffix: str,
    timeline: HighlightTimeline,
    duration: float,
) -> None:
    st.subheader("Preview")
    slider_max = max(duration, 0.1)
    timestamp = st.slider(
        "Preview timestamp (seconds)",
        min_value=0.0,
        max_value=slider_max,
        step=0.1,
        key="preview_timestamp",
    )

    frame = extract_frame_at_time(video_bytes, suffix, timestamp)
    active = active_events_at(timestamp, timeline.events, duration)
    for event in active:
        frame = draw_bbox_overlay(frame, event.bbox, stroke_width=event.stroke_width)

    display_image, _ = scale_frame_for_display(frame)
    active_count = len(active)
    if active_count:
        caption = f"Frame at {timestamp:.1f}s — {active_count} highlight(s) active"
    elif timeline.events:
        caption = f"Frame at {timestamp:.1f}s — no highlights active at this time"
    else:
        caption = f"Frame at {timestamp:.1f}s — add highlights to see them here"

    show_image(display_image, caption=caption)


def handle_upload(uploaded) -> None:
    """Load video into session state only when the uploaded file changes."""
    suffix = Path(uploaded.name).suffix or ".mp4"
    upload_key = f"{uploaded.name}:{uploaded.size}"
    if upload_key == st.session_state.get("upload_key"):
        return

    video_bytes = uploaded.getvalue()
    try:
        first_frame = extract_frame_at_time(video_bytes, suffix, 0.0)
        height, width = first_frame.shape[:2]
        duration = get_video_duration(video_bytes, suffix)
    except RuntimeError as exc:
        st.error(str(exc))
        st.session_state.video_bytes = None
        return

    st.session_state.upload_key = upload_key
    st.session_state.video_bytes = video_bytes
    st.session_state.video_suffix = suffix
    st.session_state.video_width = width
    st.session_state.video_height = height
    st.session_state.video_duration = duration
    st.session_state.highlight_timeline = HighlightTimeline(
        video_width=width,
        video_height=height,
    )
    st.session_state.output_path = None
    st.session_state.output_bytes = None
    st.session_state.editing_index = None
    st.session_state.canvas_revision = 0
    st.session_state.preview_timestamp = 0.0


def main() -> None:
    st.set_page_config(page_title="Video Highlight Editor", layout="wide")
    st.title("Video Highlight Editor")
    st.caption("Draw red box outlines on your video and export them baked into the final file.")

    init_session_state()

    uploaded = st.file_uploader(
        "Upload a video",
        type=SUPPORTED_VIDEO_TYPES,
        help="Supported formats: .mp4, .mov, .avi",
    )

    if uploaded is not None:
        handle_upload(uploaded)

    if st.session_state.video_bytes is None:
        st.stop()

    video_bytes = st.session_state.video_bytes
    suffix = st.session_state.video_suffix
    duration = st.session_state.video_duration
    timeline = st.session_state.highlight_timeline

    render_summary(timeline)
    timeline = render_add_or_edit_section(video_bytes, suffix, timeline, duration)
    timeline = render_highlight_list(timeline, duration)
    timeline = render_timeline_editor(timeline)
    st.session_state.highlight_timeline = timeline

    render_preview_section(video_bytes, suffix, timeline, duration)

    st.subheader("Render")
    if st.button("Generate highlighted video", disabled=not timeline.events):
        progress_bar = st.progress(0)
        with st.spinner("Rendering…"):
            output_path = render_highlight_video(
                video_bytes=video_bytes,
                suffix=suffix,
                timeline=timeline,
                output_dir=Path(tempfile.mkdtemp()),
                on_progress=lambda cur, total: progress_bar.progress(cur / total),
            )
        st.session_state.output_path = output_path
        st.session_state.output_bytes = output_path.read_bytes()
        st.success("Render complete.")

    if st.session_state.output_bytes is not None:
        st.subheader("Output")
        st.video(st.session_state.output_bytes)
        st.download_button(
            label="Download highlighted_output.mp4",
            data=st.session_state.output_bytes,
            file_name="highlighted_output.mp4",
            mime="video/mp4",
        )
        st.caption(f"Saved to: `{st.session_state.output_path}`")


if __name__ == "__main__":
    main()
