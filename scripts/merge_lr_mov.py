#!/usr/bin/env python3
"""Join matching 320px L/R MOVs into 640px ProRes 4444 MOVs with alpha.

Run: python3 scripts/merge_lr_mov.py
Requires ffmpeg and ffprobe on PATH. Originals are never modified and existing
outputs are never overwritten. Date subfolders and optional -alpha suffixes
are preserved in mov_lr/.
"""

import argparse
from fractions import Fraction
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
COLOR_KEYS = ("color_range", "color_space", "color_transfer", "color_primaries")
COLOR_FLAGS = ("-color_range", "-colorspace", "-color_trc", "-color_primaries")


def probe(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    streams = json.loads(result.stdout)["streams"]
    if len(streams) != 1 or streams[0]["codec_type"] != "video":
        raise ValueError(f"Expected one video stream without audio: {path}")
    return streams[0]


def check_pair(left, right):
    a, b = probe(left), probe(right)
    for path, stream in ((left, a), (right, b)):
        if (stream["width"], stream["height"]) != (320, 320):
            raise ValueError(f"Expected 320x320 input: {path}")
        if (stream["codec_name"], stream.get("profile")) != ("prores", "4444") or not stream["pix_fmt"].startswith("yuva444p"):
            raise ValueError(f"Expected ProRes 4444 with alpha: {path}")
    for key in ("r_frame_rate", "avg_frame_rate", "time_base", "duration_ts", "nb_frames", *COLOR_KEYS):
        if a.get(key) != b.get(key):
            raise ValueError(f"L/R {key} differs: {left} / {right}")
    if int(a.get("nb_frames", 0)) <= 0 or Fraction(a["r_frame_rate"]) <= 0:
        raise ValueError(f"Missing frame count or frame rate: {left}")
    return a


def pairs(source, output):
    grouped = {}
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() != ".mov":
            continue
        match = re.fullmatch(r"(.+)-([LR])(-alpha)?\.mov", path.name, re.IGNORECASE)
        if not match:
            raise ValueError(f"Expected a -L/-R filename: {path}")
        base, side, suffix = match.groups()
        relative = path.parent.relative_to(source) / f"{base}-LR{suffix or ''}.mov"
        group = grouped.setdefault(relative, {})
        if side.upper() in group:
            raise ValueError(f"Duplicate {side} input: {path}")
        group[side.upper()] = path
    if not grouped:
        raise ValueError(f"No MOV pairs found in {source}")
    jobs = []
    for relative, group in sorted(grouped.items()):
        if set(group) != {"L", "R"}:
            raise ValueError(f"Missing L or R partner: {relative}")
        target = output / relative
        if target.exists():
            raise FileExistsError(f"Output already exists (choose another --output): {target}")
        jobs.append((group["L"], group["R"], target, check_pair(group["L"], group["R"])))
    return jobs


def merge(left, right, target, stream):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".merge-", dir=target.parent) as folder:
        temporary = Path(folder) / target.name
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
            "-i", str(left), "-i", str(right),
            "-filter_complex", "[0:v:0]setpts=PTS-STARTPTS[l];[1:v:0]setpts=PTS-STARTPTS[r];[l][r]hstack=inputs=2[v]",
            "-map", "[v]", "-an", "-c:v", "prores_ks", "-profile:v", "4444",
            "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0",
            "-qscale:v", "4", "-threads", "2", "-fps_mode", "passthrough",
            "-video_track_timescale", str(Fraction(stream["time_base"]).denominator),
        ]
        for key, flag in zip(COLOR_KEYS, COLOR_FLAGS):
            if stream.get(key) not in (None, "unknown", "unspecified"):
                command.extend([flag, stream[key]])
        command.extend(["-movflags", "+faststart", str(temporary)])
        subprocess.run(command, check=True)
        result = probe(temporary)
        for key, expected in {
            "width": 640, "height": 320, "codec_name": "prores", "profile": "4444",
            "codec_tag_string": stream["codec_tag_string"], "pix_fmt": stream["pix_fmt"],
            "nb_frames": stream["nb_frames"], "r_frame_rate": stream["r_frame_rate"],
            "time_base": stream["time_base"], "duration_ts": stream["duration_ts"],
            **{key: stream[key] for key in COLOR_KEYS if key in stream},
        }.items():
            if result.get(key) != expected:
                raise ValueError(f"Output {key}: expected {expected}, got {result.get(key)} ({target})")
        if target.exists():
            raise FileExistsError(f"Output appeared while converting: {target}")
        temporary.rename(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=ROOT / "mov_json")
    parser.add_argument("--output", type=Path, default=ROOT / "mov_lr")
    args = parser.parse_args()
    for program in ("ffmpeg", "ffprobe"):
        if not shutil.which(program):
            parser.error(f"Install {program} and add it to PATH")
    source, output = args.input.resolve(), args.output.resolve()
    if not source.is_dir():
        parser.error(f"Input folder does not exist: {source}")
    if output == source or source in output.parents:
        parser.error("Choose an output folder outside the input folder")
    jobs = pairs(source, output)
    print(f"Found {len(jobs)} pairs. L on the left, R on the right; preserving ProRes 4444, alpha, FPS and duration.", flush=True)
    for index, (left, right, target, stream) in enumerate(jobs, 1):
        merge(left, right, target, stream)
        print(f"[{index}/{len(jobs)}] {target.relative_to(output)} ({stream['duration']}s, {stream['nb_frames']} frames)", flush=True)
    print(f"Done: {output}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
