"""CLI entrypoint for the video segmentation engine."""

from __future__ import annotations

import logging
import warnings
from pathlib import Path

import click

warnings.filterwarnings("ignore", message=".*pin_memory.*MPS.*")

from video_segmentation.config import load_config
from video_segmentation.frame_sampling import sample_frames
from video_segmentation.ocr import extract_ocr, save_ocr_json
from video_segmentation.segmentation import detect_scenes, save_segments_json
from video_segmentation.timeline import build_timeline, save_timeline
from video_segmentation.transcription import (
    align_to_segments,
    save_transcript_json,
    transcribe_video,
)

logger = logging.getLogger(__name__)


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


@click.group()
@click.option("--verbose", is_flag=True, help="Enable debug logging.")
@click.pass_context
def cli(ctx: click.Context, verbose: bool) -> None:
    """Video Segmentation Engine for software tutorial videos."""
    _configure_logging(verbose)
    ctx.ensure_object(dict)


@cli.command("process")
@click.argument("video_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--config",
    "config_path",
    default="config.yaml",
    show_default=True,
    type=click.Path(dir_okay=False, path_type=Path),
    help="Path to YAML configuration file.",
)
@click.option(
    "--output",
    "output_path",
    default=None,
    type=click.Path(dir_okay=False, path_type=Path),
    help="Output timeline JSON path.",
)
@click.option(
    "--keep-frames",
    is_flag=True,
    help="Keep sampled frame directories after processing.",
)
def process_command(
    video_path: Path,
    config_path: Path,
    output_path: Path | None,
    keep_frames: bool,
) -> None:
    """Run the full segmentation pipeline on a tutorial video."""
    config = load_config(config_path if config_path.exists() else None)
    timeline_path = output_path or Path(config.output.output_file)

    logger.info("Starting full pipeline for %s", video_path)

    segments = detect_scenes(video_path, config.segmentation)
    transcript_chunks = transcribe_video(video_path, config.transcription)
    aligned = align_to_segments(transcript_chunks, segments)
    frames = sample_frames(
        video_path,
        segments,
        config.frame_sampling,
        clean_output=not keep_frames,
    )
    ocr_results = extract_ocr(frames, config.ocr)

    timeline = build_timeline(segments, aligned, ocr_results)
    save_timeline(timeline, timeline_path)
    click.echo(f"Timeline written to {timeline_path}")


@cli.command("segment-only")
@click.argument("video_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--config",
    "config_path",
    default="config.yaml",
    show_default=True,
    type=click.Path(dir_okay=False, path_type=Path),
)
@click.option(
    "--output",
    "output_path",
    default="segments.json",
    show_default=True,
    type=click.Path(dir_okay=False, path_type=Path),
)
def segment_only_command(
    video_path: Path,
    config_path: Path,
    output_path: Path,
) -> None:
    """Run Phase 1 scene segmentation only."""
    config = load_config(config_path if config_path.exists() else None)
    segments = detect_scenes(video_path, config.segmentation)
    save_segments_json(segments, output_path)
    click.echo(f"Segments written to {output_path}")


@cli.command("transcribe-only")
@click.argument("video_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--config",
    "config_path",
    default="config.yaml",
    show_default=True,
    type=click.Path(dir_okay=False, path_type=Path),
)
@click.option(
    "--output",
    "output_path",
    default="transcript.json",
    show_default=True,
    type=click.Path(dir_okay=False, path_type=Path),
)
def transcribe_only_command(
    video_path: Path,
    config_path: Path,
    output_path: Path,
) -> None:
    """Run Phase 2 transcription only."""
    config = load_config(config_path if config_path.exists() else None)
    chunks = transcribe_video(video_path, config.transcription)
    save_transcript_json(chunks, output_path)
    click.echo(f"Transcript written to {output_path}")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
