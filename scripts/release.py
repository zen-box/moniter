"""Build explicit, data-free release archives using only the Python standard library."""
import argparse
import json
from pathlib import Path
import re
import shutil
import struct
import tarfile
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = "zen-box/moniter"
TARGETS = {
    "linux-amd64": "x86_64-unknown-linux-musl",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "windows-amd64": "x86_64-pc-windows-msvc",
}


def version(component, tag):
    if component != "agent":
        raise ValueError("Server source and builds are maintained on the main branch")
    current = tomllib.loads((ROOT / component / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    prefix = "agent-v"
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", current) or tag != prefix + current:
        raise ValueError(f"Expected tag {prefix}{current}, received {tag!r}")
    return current


def archive_name(component, current, platform):
    suffix = ".zip" if platform.startswith("windows") else ".tar.gz"
    return f"moniter{'-agent' if component == 'agent' else ''}-{current}-{platform}{suffix}"


def executable_name(component, platform):
    return ("moniter-agent" if component == "agent" else "moniter") + (".exe" if platform.startswith("windows") else "")


def check_binary(path, platform):
    with path.open("rb") as handle:
        header = handle.read(64)
        if platform.startswith("linux"):
            expected_machine = 183 if platform == "linux-arm64" else 62
            if header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != expected_machine:
                raise ValueError(f"Incorrect Linux executable for {platform}: {path}")
        else:
            if header[:2] != b"MZ":
                raise ValueError(f"Not a Windows executable: {path}")
            handle.seek(struct.unpack_from("<I", header, 60)[0])
            pe = handle.read(6)
            if pe[:4] != b"PE\0\0" or struct.unpack_from("<H", pe, 4)[0] != 0x8664:
                raise ValueError(f"Not a Windows amd64 executable: {path}")


def write_archive(staging, destination):
    if destination.name.endswith(".zip"):
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(staging))
    else:
        with tarfile.open(destination, "w:gz") as archive:
            def permissions(entry):
                entry.mode = 0o755 if entry.name == "moniter-agent" else 0o644
                return entry
            for path in sorted(staging.iterdir()):
                archive.add(path, arcname=path.name, filter=permissions)


def package(component, tag, platform, binary, output):
    current = version(component, tag)
    check_binary(binary, platform)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / archive_name(component, current, platform)
    with tempfile.TemporaryDirectory(prefix="moniter-release-") as temporary:
        staging = Path(temporary)
        executable = staging / executable_name(component, platform)
        shutil.copyfile(binary, executable)
        executable.chmod(0o755)
        manifest = {"component": component, "version": current, "platform": platform, "repository": REPO}
        shutil.copyfile(ROOT / "README.md", staging / "README.md")
        (staging / "release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        write_archive(staging, destination)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("component", choices=("agent",))
    validate.add_argument("tag")
    build = commands.add_parser("package")
    build.add_argument("component", choices=("agent",))
    build.add_argument("tag")
    build.add_argument("platform", choices=TARGETS)
    build.add_argument("--binary", type=Path, required=True)
    build.add_argument("--output", type=Path, default=ROOT / "release-output")
    args = parser.parse_args()
    if args.command == "validate":
        print(version(args.component, args.tag))
    else:
        print(package(args.component, args.tag, args.platform, args.binary, args.output))


if __name__ == "__main__":
    main()
