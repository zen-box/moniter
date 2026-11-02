"""Contract checks for independent tags and release archive contents."""
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import zipfile

import release


def executable(platform):
    data = bytearray(80)
    if platform.startswith("linux"):
        data[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", data, 18, 183 if platform == "linux-arm64" else 62)
    else:
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 60, 64)
        data[64:70] = b"PE\0\0\x64\x86"
    return bytes(data)


class ReleaseTests(unittest.TestCase):
    def test_server_fetches_the_pinned_agent_release_without_building(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "server").mkdir()
            (root / "server/agent-version.txt").write_text("0.7.0")
            assets, payloads = [], {}
            for platform in release.TARGETS:
                name = release.archive_name("agent", "0.7.0", platform)
                url = f"https://github.com/{release.REPO}/releases/download/agent-v0.7.0/{name}"
                assets.append({"name": name, "browser_download_url": url})
                stream, binary = io.BytesIO(), executable(platform)
                if platform.startswith("windows"):
                    with zipfile.ZipFile(stream, "w") as archive:
                        archive.writestr(release.executable_name("agent", platform), binary)
                else:
                    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
                        entry = tarfile.TarInfo(release.executable_name("agent", platform))
                        entry.size = len(binary)
                        archive.addfile(entry, io.BytesIO(binary))
                payloads[url] = stream.getvalue()
            api = f"https://api.github.com/repos/{release.REPO}/releases/tags/agent-v0.7.0"
            payloads[api] = json.dumps({"tag_name":"agent-v0.7.0", "draft":False, "prerelease":False, "assets":assets}).encode()
            with patch.object(release, "ROOT", root), patch.object(release, "download", side_effect=lambda url, *args, **kwargs: payloads[url]) as download:
                self.assertEqual(release.fetch_agents(root / "agents"), "0.7.0")
                self.assertEqual(download.call_count, 4)
            for platform in release.TARGETS:
                self.assertEqual((root / f"agents/aegis-agent-{platform}").read_bytes(), executable(platform))
            assets[0]["browser_download_url"] = "https://example.com/untrusted"
            payloads[api] = json.dumps({"tag_name":"agent-v0.7.0", "draft":False, "prerelease":False, "assets":assets}).encode()
            with patch.object(release, "ROOT", root), patch.object(release, "download", side_effect=lambda url, *args, **kwargs: payloads[url]):
                with self.assertRaises(ValueError):
                    release.fetch_agents(root / "bad-agents")

    def test_tags_are_independent_and_must_match_component_version(self):
        for component, prefix, wrong_prefix in [("server", "v", "agent-v")]:
            current = tomllib.loads((release.ROOT / component / "Cargo.toml").read_text())["package"]["version"]
            self.assertEqual(release.version(component, prefix + current), current)
            for tag in (wrong_prefix + current, prefix + current + "-rc.1"):
                with self.assertRaises(ValueError):
                    release.version(component, tag)
        with self.assertRaisesRegex(ValueError, "agent branch"):
            release.version("agent", "agent-v0.1.0")

    def test_wrong_architecture_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "binary"
            binary.write_bytes(executable("linux-amd64"))
            release.check_binary(binary, "linux-amd64")
            for platform in ("linux-arm64", "windows-amd64"):
                with self.assertRaises(ValueError):
                    release.check_binary(binary, platform)

    def test_server_archive_includes_ui_and_agents_but_no_runtime_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename, data in {
                "README.md": "test",
                "install.sh": "#!/usr/bin/env bash\n",
                "install.ps1": "# installer\n",
                "server/Cargo.toml": '[package]\nversion="0.1.0"',
                "server/agent-version.txt": "0.1.0",
                "web/dist/index.html": "built app",
                "web/dist/build-manifest.json": json.dumps({"index.html": {"file": "app-12345678.js", "css": ["app-12345678.css"]}}),
                "web/dist/app-12345678.js": "current app",
                "web/dist/app-12345678.css": "current styles",
                "web/dist/old-12345678.js": "previous app kept for existing tabs",
                "web/assets/flags/cn.svg": "flag",
                "web/assets/world-map-paths.svg": "map",
                "web/themes/private/index.html": "user theme",
                "data/probe.db": "private data",
                ".env": "private config",
                "server.log": "private credentials",
            }.items():
                path = root / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(data)
            agents = root / "agents"
            agents.mkdir()
            for platform in release.TARGETS:
                (agents / f"aegis-agent-{platform}").write_bytes(executable(platform))
            binary = root / "server.exe"
            binary.write_bytes(executable("windows-amd64"))
            with patch.object(release, "ROOT", root):
                archive = release.package("server", "v0.1.0", "windows-amd64", binary, root / "out", agents)
            with zipfile.ZipFile(archive) as contents:
                names = set(contents.namelist())
                self.assertEqual(names, {
                    "moniter.exe", "README.md", "release.json", "install.sh", "install.ps1", "web/dist/index.html",
                    "web/dist/build-manifest.json", "web/dist/app-12345678.js", "web/dist/app-12345678.css",
                    "web/assets/flags/cn.svg", "web/assets/world-map-paths.svg",
                    *{f"binaries/aegis-agent-{platform}" for platform in release.TARGETS},
                })
                self.assertEqual(json.loads(contents.read("release.json"))["bundled_agent_version"], "0.1.0")


if __name__ == "__main__":
    unittest.main()
