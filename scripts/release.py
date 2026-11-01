"""Build explicit, data-free release archives using only the Python standard library."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import shutil
import struct
import tarfile
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = "zen-box/moniter"
TARGETS = {
    "linux-amd64": "x86_64-unknown-linux-musl",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "windows-amd64": "x86_64-pc-windows-msvc",
}


def version(component, tag):
    if component != "server":
        raise ValueError("Agent source and builds are maintained on the agent branch")
    current = tomllib.loads((ROOT / component / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    prefix = "v"
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


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.hostname not in {
            "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
        }:
            raise ValueError("Refused a non-GitHub download redirect")
        redirected = super().redirect_request(request, fp, code, message, headers, url)
        if redirected:
            redirected.remove_header("Authorization")
        return redirected


def download(url, limit, api=False):
    headers = {"User-Agent": "Moniter-release-builder", "Accept": "application/vnd.github+json" if api else "application/octet-stream"}
    if api:
        headers["X-GitHub-Api-Version"] = "2022-11-28"
        if os.environ.get("GH_TOKEN"):
            headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    with urllib.request.build_opener(GitHubRedirect()).open(urllib.request.Request(url, headers=headers), timeout=60) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Release download exceeds its size limit")
    return data


def fetch_agents(destination):
    current = (ROOT / "server/agent-version.txt").read_text().strip()
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", current):
        raise ValueError("Invalid server/agent-version.txt")
    tag = "agent-v" + current
    try:
        release = json.loads(download(f"https://api.github.com/repos/{REPO}/releases/tags/{tag}", 1024 * 1024, api=True))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError(f"Publish {tag} before releasing the server") from error
        raise
    if release.get("draft") or release.get("prerelease") or release.get("tag_name") != tag:
        raise ValueError("Expected a published stable Agent release")
    assets = {asset["name"]: asset for asset in release.get("assets", [])}
    destination.mkdir(parents=True, exist_ok=True)
    for platform in TARGETS:
        name = archive_name("agent", current, platform)
        expected_url = f"https://github.com/{REPO}/releases/download/{tag}/{name}"
        if assets.get(name, {}).get("browser_download_url") != expected_url:
            raise ValueError(f"Agent release is missing the expected asset {name}")
        payload = download(expected_url, 64 * 1024 * 1024)
        executable = executable_name("agent", platform)
        if name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                entry = archive.getinfo(executable)
                if entry.file_size > 64 * 1024 * 1024:
                    raise ValueError("Agent executable exceeds its size limit")
                binary = archive.read(entry)
        else:
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
                entry = archive.getmember(executable)
                if not entry.isfile() or entry.size > 64 * 1024 * 1024:
                    raise ValueError("Invalid Agent archive entry")
                binary = archive.extractfile(entry).read()
        path = destination / f"aegis-agent-{platform}"
        path.write_bytes(binary)
        check_binary(path, platform)
        path.chmod(0o755)
    return current


def write_archive(staging, destination):
    if destination.name.endswith(".zip"):
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(staging))
    else:
        with tarfile.open(destination, "w:gz") as archive:
            for path in sorted(staging.iterdir()):
                archive.add(path, arcname=path.name)


def package(component, tag, platform, binary, output, agents):
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
        if component == "server":
            # Explicit allowlist: no databases, custom themes, logs, or credentials.
            for installer in ("install.sh", "install.ps1"):
                shutil.copyfile(ROOT / installer, staging / installer)
            (staging / "install.sh").chmod(0o755)
            for relative in ("web/dist", "web/assets"):
                shutil.copytree(ROOT / relative, staging / relative)
            if not (staging / "web/dist/index.html").is_file():
                raise ValueError("Build the React frontend before packaging the server")
            for target_platform in TARGETS:
                source = agents / f"aegis-agent-{target_platform}"
                check_binary(source, target_platform)
                target = staging / "binaries" / source.name
                target.parent.mkdir(exist_ok=True)
                shutil.copyfile(source, target)
                target.chmod(0o755)
            manifest["bundled_agent_version"] = (ROOT / "server/agent-version.txt").read_text().strip()
        (staging / "release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        write_archive(staging, destination)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("component", choices=("server",))
    validate.add_argument("tag")
    fetch = commands.add_parser("fetch-agents")
    fetch.add_argument("--output", type=Path, default=ROOT / "release-output/agents")
    build = commands.add_parser("package")
    build.add_argument("component", choices=("server",))
    build.add_argument("tag")
    build.add_argument("platform", choices=TARGETS)
    build.add_argument("--binary", type=Path, required=True)
    build.add_argument("--output", type=Path, default=ROOT / "release-output")
    build.add_argument("--agents", type=Path, default=ROOT / "release-output/agents")
    args = parser.parse_args()
    if args.command == "validate":
        print(version(args.component, args.tag))
    elif args.command == "fetch-agents":
        print(fetch_agents(args.output))
    else:
        print(package(args.component, args.tag, args.platform, args.binary, args.output, args.agents))


if __name__ == "__main__":
    main()
