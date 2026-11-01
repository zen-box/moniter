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
    def test_tags_are_independent_and_must_match_component_version(self):
        for component, prefix, wrong_prefix in [("agent", "agent-v", "v")]:
            current = tomllib.loads((release.ROOT / component / "Cargo.toml").read_text())["package"]["version"]
            self.assertEqual(release.version(component, prefix + current), current)
            for tag in (wrong_prefix + current, prefix + current + "-rc.1"):
                with self.assertRaises(ValueError):
                    release.version(component, tag)

    def test_wrong_architecture_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "binary"
            binary.write_bytes(executable("linux-amd64"))
            release.check_binary(binary, "linux-amd64")
            for platform in ("linux-arm64", "windows-amd64"):
                with self.assertRaises(ValueError):
                    release.check_binary(binary, platform)

    def test_agent_archives_have_only_binary_readme_and_manifest(self):
        for platform in release.TARGETS:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for filename, data in {"README.md":"agent", "agent/Cargo.toml":'[package]\nversion="0.1.0"', "agent.token":"private"}.items():
                    path=root/filename; path.parent.mkdir(parents=True,exist_ok=True); path.write_text(data)
                binary=root/"binary"; binary.write_bytes(executable(platform))
                with patch.object(release,"ROOT",root):
                    path=release.package("agent","agent-v0.1.0",platform,binary,root/"out")
                name=release.executable_name("agent",platform)
                if path.suffix==".zip":
                    with zipfile.ZipFile(path) as archive:
                        self.assertEqual(set(archive.namelist()),{name,"README.md","release.json"})
                        self.assertEqual(archive.read(name),executable(platform))
                        manifest=json.loads(archive.read("release.json"))
                else:
                    with tarfile.open(path) as archive:
                        self.assertEqual(set(archive.getnames()),{name,"README.md","release.json"})
                        self.assertEqual(archive.extractfile(name).read(),executable(platform))
                        self.assertTrue(archive.getmember(name).mode & 0o111)
                        manifest=json.load(archive.extractfile("release.json"))
                self.assertEqual((manifest["component"],manifest["platform"],manifest["version"]),("agent",platform,"0.1.0"))
        with self.assertRaisesRegex(ValueError,"main branch"):
            release.version("server","v0.1.0")


if __name__ == "__main__":
    unittest.main()
