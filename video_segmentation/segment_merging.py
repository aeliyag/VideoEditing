"""Post-process scene segments to enforce minimum duration."""

from __future__ import annotations

import logging

from video_segmentation.models import SceneSegment

logger = logging.getLogger(__name__)


def merge_short_segments(
    segments: list[SceneSegment],
    min_duration: float,
) -> list[SceneSegment]:
    """Merge segments shorter than min_duration into adjacent segments."""
    if not segments or min_duration <= 0:
        return segments

    merged = list(segments)
    changed = True

    while changed:
        changed = False
        output: list[SceneSegment] = []
        index = 0

        while index < len(merged):
            segment = merged[index]
            duration = segment.end - segment.start

            if duration < min_duration and len(merged) > 1:
                if output:
                    previous = output[-1]
                    output[-1] = SceneSegment(start=previous.start, end=segment.end)
                    logger.info(
                        "Merged short segment %.2f-%.2f (%.2fs) into previous "
                        "segment (now %.2f-%.2f)",
                        segment.start,
                        segment.end,
                        duration,
                        output[-1].start,
                        output[-1].end,
                    )
                    changed = True
                elif index + 1 < len(merged):
                    nxt = merged[index + 1]
                    output.append(SceneSegment(start=segment.start, end=nxt.end))
                    logger.info(
                        "Merged short first segment %.2f-%.2f (%.2fs) forward "
                        "into %.2f-%.2f",
                        segment.start,
                        segment.end,
                        duration,
                        segment.start,
                        nxt.end,
                    )
                    index += 2
                    changed = True
                    continue
                else:
                    output.append(segment)
            else:
                output.append(segment)

            index += 1

        merged = output

    return merged
