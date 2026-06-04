#!/usr/bin/env python3
"""
Second-brain index for the VideoEditing repo.

Keeps codebase.mb and .codebase/index.json in sync with the Python tree so
file/function search stays accurate after each change.

Usage:
  python scripts/codebase_brain.py sync
  python scripts/codebase_brain.py search "ocr ui text"
  python scripts/codebase_brain.py search "scene detection" --update
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
INDEX_DIR = REPO_ROOT / ".codebase"
INDEX_PATH = INDEX_DIR / "index.json"
CODEBASE_MB = REPO_ROOT / "codebase.mb"
PLAN_MB = REPO_ROOT / "plan.mb"

SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".codebase",
    "frames",
    "ocr_debug",
    "node_modules",
}

# Plan step -> implementation status (updated when features land).
ROADMAP: list[dict[str, str]] = [
    {
        "id": "1a",
        "name": "Cut / transition detection",
        "status": "done",
        "code": "video_segmentation/segmentation.py — detect_scenes (PySceneDetect)",
    },
    {
        "id": "1b",
        "name": "Workflow section chunking + narration alignment",
        "status": "partial",
        "code": "timeline.py + transcription.align_to_segments; no LLM workflow labels",
    },
    {
        "id": "1c",
        "name": "Edited regions (zoom, crop, highlight, cursor focus)",
        "status": "planned",
        "code": "Not started — edit metadata on timeline",
    },
    {
        "id": "2",
        "name": "UI element targets (cursor, narration, zoom, overlays)",
        "status": "partial",
        "code": "OCR ui_elements + transcript; no cursor/zoom/highlight geometry",
    },
    {
        "id": "3",
        "name": "Locate equivalent elements in new UI / video",
        "status": "planned",
        "code": "Needs old/new comparison pipeline",
    },
    {
        "id": "4",
        "name": "Semantic UI diffing (layout, rename, feature changes)",
        "status": "planned",
        "code": "OpenCV diff + LLM + optional DOM — not implemented",
    },
    {
        "id": "5",
        "name": "Editing intent transfer (re-anchor zoom/highlight/crop)",
        "status": "planned",
        "code": "Editing Intent Transfer Engine",
    },
    {
        "id": "6",
        "name": "Merge updated segments + voice clone",
        "status": "planned",
        "code": "Timeline merge + TTS — not implemented",
    },
    {
        "id": "7",
        "name": "Export to Akool / editable project data",
        "status": "planned",
        "code": "timeline.json only; no Akool/MCP export yet",
    },
]

COMPONENTS: list[dict[str, str]] = [
    {
        "name": "Video segmentation engine",
        "status": "mvp",
        "modules": "segmentation, transcription, frame_sampling, ocr, timeline, cli",
    },
    {
        "name": "Semantic UI diff engine",
        "status": "planned",
        "modules": "—",
    },
    {
        "name": "Editing intent transfer engine",
        "status": "planned",
        "modules": "—",
    },
    {
        "name": "Narration sync / regeneration",
        "status": "partial",
        "modules": "transcription (Whisper only)",
    },
]


@dataclass
class SymbolInfo:
    name: str
    kind: str  # function | class | method
    lineno: int
    doc: str = ""
    parent: str | None = None


@dataclass
class FileIndex:
    path: str
    module: str
    doc: str = ""
    symbols: list[SymbolInfo] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)


def _doc_first_line(node: ast.AST) -> str:
    doc = ast.get_docstring(node) or ""
    return doc.strip().split("\n")[0] if doc else ""


def _iter_py_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        files.append(path)
    return sorted(files)


def _index_file(path: Path) -> FileIndex:
    rel = path.relative_to(REPO_ROOT).as_posix()
    module = rel.replace("/", ".").removesuffix(".py")
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    file_doc = _doc_first_line(tree)

    imports: list[str] = []
    symbols: list[SymbolInfo] = []

    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)

        if isinstance(node, ast.ClassDef):
            symbols.append(
                SymbolInfo(
                    name=node.name,
                    kind="class",
                    lineno=node.lineno,
                    doc=_doc_first_line(node),
                )
            )
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    symbols.append(
                        SymbolInfo(
                            name=item.name,
                            kind="method",
                            lineno=item.lineno,
                            doc=_doc_first_line(item),
                            parent=node.name,
                        )
                    )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append(
                SymbolInfo(
                    name=node.name,
                    kind="function",
                    lineno=node.lineno,
                    doc=_doc_first_line(node),
                )
            )

    return FileIndex(path=rel, module=module, doc=file_doc, symbols=symbols, imports=imports)


def build_index() -> dict[str, Any]:
    py_files = _iter_py_files(REPO_ROOT)
    files = [_index_file(p) for p in py_files]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(REPO_ROOT),
        "plan_file": "plan.mb" if PLAN_MB.exists() else None,
        "files": [asdict(f) for f in files],
        "roadmap": ROADMAP,
        "components": COMPONENTS,
    }


def _status_icon(status: str) -> str:
    return {
        "done": "[x]",
        "partial": "[~]",
        "mvp": "[~]",
        "planned": "[ ]",
    }.get(status, "[?]")


def render_codebase_mb(index: dict[str, Any]) -> str:
    lines: list[str] = [
        "# Codebase second brain",
        "",
        f"_Auto-synced: {index['generated_at']}_",
        f"_Regenerate: `python scripts/codebase_brain.py sync`_",
        "",
        "## Problem & goal",
        "",
        "Tutorial videos go stale when the product UI changes. Goal: preserve",
        "high-quality edited tutorials and minimize manual re-editing by diffing",
        "old vs new screen recordings and transferring edit intent.",
        "",
        "Full product spec: `plan.mb`.",
        "",
        "## Pipeline (plan.mb → code)",
        "",
        "| Step | Status | Where in code |",
        "|------|--------|---------------|",
    ]

    for item in index["roadmap"]:
        icon = _status_icon(item["status"])
        lines.append(
            f"| {item['id']} {item['name']} | {icon} {item['status']} | {item['code']} |"
        )

    lines.extend(
        [
            "",
            "## Core components",
            "",
            "| Component | Status | Modules |",
            "|-----------|--------|---------|",
        ]
    )
    for comp in index["components"]:
        icon = _status_icon(comp["status"])
        lines.append(
            f"| {comp['name']} | {icon} {comp['status']} | {comp['modules']} |"
        )

    lines.extend(
        [
            "",
            "## What is implemented (MVP)",
            "",
            "- **CLI** (`video-segment`): `process`, `segment-only`, `transcribe-only`",
            "- **Phase 1** Scene cuts/fades → `SceneSegment` list",
            "- **Phase 2** Whisper transcript → `TranscriptChunk`, aligned per segment",
            "- **Phase 3** 1 FPS frame samples per segment (OpenCV)",
            "- **Phase 4** EasyOCR + layout heuristics → `OCRResult` / `ui_elements`",
            "- **Output** Semantic `timeline.json` (`Timeline` / `TimelineSegment`)",
            "",
            "## What is next (priority order)",
            "",
            "1. Edit metadata detection (zoom, crop, highlight, cursor) on timeline",
            "2. Semantic UI target map (geometry + narration/cursor links)",
            "3. Old/new video pairing + visual similarity / LLM UI matching",
            "4. Semantic UI diff categories + invalidation flags",
            "5. Editing intent transfer + segment replacement merge",
            "6. Narration diff, regeneration, voice clone",
            "7. Akool / video-editing MCP export (see plan.mb resources)",
            "",
            "## Module index",
            "",
        ]
    )

    for entry in sorted(index["files"], key=lambda e: e["path"]):
        if not entry["path"].startswith("video_segmentation/"):
            continue
        lines.append(f"### `{entry['path']}`")
        if entry["doc"]:
            lines.append(f"- {entry['doc']}")
        public = [
            s
            for s in entry["symbols"]
            if not s["name"].startswith("_") or s["kind"] == "class"
        ]
        for sym in sorted(public, key=lambda s: s["lineno"]):
            qual = (
                f"{sym['parent']}.{sym['name']}"
                if sym.get("parent")
                else sym["name"]
            )
            doc = f" — {sym['doc']}" if sym.get("doc") else ""
            lines.append(f"- L{sym['lineno']}: `{qual}` ({sym['kind']}){doc}")
        lines.append("")

    lines.extend(
        [
            "## All Python files (search index)",
            "",
        ]
    )
    for entry in sorted(index["files"], key=lambda e: e["path"]):
        symbols = ", ".join(
            s["name"]
            for s in entry["symbols"]
            if not s["name"].startswith("_")
        )[:120]
        lines.append(f"- `{entry['path']}` — {symbols or '(no public symbols)'}")

    lines.extend(
        [
            "",
            "## External resources (from plan)",
            "",
            "- [mcp-video](https://pypi.org/project/mcp-video/1.4.0/) — scene detect, timeline, crops",
            "- [video-editing-mcp](https://github.com/burningion/video-editing-mcp)",
            "- Autovio / text-to-video pipeline (metadata reference)",
            "",
        ]
    )
    return "\n".join(lines)


def write_artifacts(index: dict[str, Any]) -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
    CODEBASE_MB.write_text(render_codebase_mb(index), encoding="utf-8")


def _tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1]


def search(index: dict[str, Any], query: str, limit: int = 15) -> list[tuple[float, str, str]]:
    tokens = _tokenize(query)
    if not tokens:
        return []

    results: list[tuple[float, str, str]] = []

    for entry in index["files"]:
        path = entry["path"]
        haystack_parts = [
            path.lower(),
            entry.get("module", "").lower(),
            entry.get("doc", "").lower(),
        ]
        for sym in entry["symbols"]:
            haystack_parts.append(sym["name"].lower())
            haystack_parts.append(sym.get("doc", "").lower())
            if sym.get("parent"):
                haystack_parts.append(sym["parent"].lower())
        haystack = " ".join(haystack_parts)

        score = 0.0
        for token in tokens:
            if token in path.lower():
                score += 3.0
            if token in haystack:
                score += 1.0
            for sym in entry["symbols"]:
                if token in sym["name"].lower():
                    score += 2.0

        if score > 0:
            best_sym = max(
                entry["symbols"],
                key=lambda s: sum(1 for t in tokens if t in s["name"].lower()),
                default=None,
            )
            hint = ""
            if best_sym and any(t in best_sym["name"].lower() for t in tokens):
                hint = f" → {best_sym['name']} (L{best_sym['lineno']})"
            results.append((score, path, hint))

    for item in index.get("roadmap", []):
        blob = f"{item['name']} {item['code']} {item['status']}".lower()
        score = sum(1.0 for t in tokens if t in blob)
        if score:
            results.append(
                (
                    score + 0.5,
                    "plan.mb",
                    f" → roadmap {item['id']}: {item['name']} ({item['status']})",
                )
            )

    results.sort(key=lambda r: (-r[0], r[1]))
    return results[:limit]


def cmd_sync(_: argparse.Namespace) -> int:
    index = build_index()
    write_artifacts(index)
    print(f"Wrote {INDEX_PATH}")
    print(f"Wrote {CODEBASE_MB}")
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    if args.update or not INDEX_PATH.exists():
        cmd_sync(argparse.Namespace())
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    hits = search(index, args.query, limit=args.limit)
    if not hits:
        print("No matches.")
        return 1
    for score, path, hint in hits:
        print(f"{score:5.1f}  {path}{hint}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Codebase second-brain index")
    sub = parser.add_subparsers(dest="command", required=True)

    p_sync = sub.add_parser("sync", help="Rebuild index and codebase.mb from source")
    p_sync.set_defaults(func=cmd_sync)

    p_search = sub.add_parser("search", help="Find relevant files/symbols")
    p_search.add_argument("query", help="Search terms (e.g. 'ocr timeline')")
    p_search.add_argument(
        "--update",
        action="store_true",
        help="Run sync before searching",
    )
    p_search.add_argument("--limit", type=int, default=15)
    p_search.set_defaults(func=cmd_search)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
