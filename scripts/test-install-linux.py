"""Installer lifecycle contract on Linux, with OS/service/network boundaries mocked."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SHIM = r'''#!/usr/bin/env python3
import json,os,pathlib,shutil,sys
state=pathlib.Path(os.environ['TEST_STATE']); name=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
root=pathlib.Path(os.environ['MONITER_INSTALL_DIR'])
if name=='id': print('0')
elif name=='uname': print('Linux' if '-s' in args else os.uname().machine)
elif name in ('getent','chown'): pass
elif name=='sleep': pass
elif name=='journalctl': print('管理员账号: admin\n管理员密码: fixture-only-password')
elif name=='systemctl':
    command=args[0]
    if command in ('is-active','is-enabled'): sys.exit(0 if (state/command).exists() else 3)
    elif command=='stop':
        with (state/'stops').open('a') as log: log.write('stop\n')
        (state/'is-active').unlink(missing_ok=True)
    elif command=='enable': (state/'is-enabled').touch()
    elif command=='disable': (state/'is-enabled').unlink(missing_ok=True)
    elif command in ('start','restart'):
        if (state/'fail-start').exists():
            (state/'fail-start').unlink(); (root/'data/probe.db').write_text('bad migration'); sys.exit(1)
        (state/'is-active').touch()
        if not (root/'data/probe.db').exists(): (root/'data/probe.db').write_text('database fixture')
elif name=='curl':
    if '-o' in args:
        output=args[args.index('-o')+1]
        shutil.copyfile(state/('release.json' if '/releases/latest' in ' '.join(args) or '/releases/tags/' in ' '.join(args) else 'package.tar.gz'),output)
    else:
        if not (state/'is-active').exists(): sys.exit(7)
        print('pong')
else: sys.exit('Unexpected mock command: '+name)
'''


class FrontendRetentionTest(unittest.TestCase):
    def test_update_keeps_only_the_previous_manifest_dependencies(self):
        installer = (REPO / 'install.sh').read_text(encoding='utf-8')
        marker = 'python3 - "$ROOT/web/dist" "$STAGING/package/web/dist" <<\'PY\'\n'
        code = installer.split(marker, 1)[1].split('\nPY', 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source', Path(directory) / 'target'
            source.mkdir(); target.mkdir()
            for name in ('app-Abcdef12.js', 'lazy-Abcdef12.js', 'app-Abcdef12.css', 'stale-Abcdef12.js'):
                (source / name).write_text('previous')
            (target / 'app-Abcdef12.js').write_text('already present')
            (source / 'build-manifest.json').write_text(json.dumps({
                'index.html': {'file': 'app-Abcdef12.js', 'css': ['app-Abcdef12.css']},
                'detail': {'file': 'lazy-Abcdef12.js'},
            }))
            result = subprocess.run([sys.executable, '-c', code, str(source), str(target)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual({path.name for path in target.iterdir()}, {'app-Abcdef12.js', 'lazy-Abcdef12.js', 'app-Abcdef12.css'})
            self.assertEqual((target / 'app-Abcdef12.js').read_text(), 'already present')


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux installer requires Linux')
class InstallerTest(unittest.TestCase):
    def test_install_update_rejection_and_rollback(self):
        with tempfile.TemporaryDirectory(prefix='moniter-installer-') as temporary:
            base = Path(temporary)
            root, state, commands = base/'server', base/'state', base/'commands'
            state.mkdir(); commands.mkdir()
            for command in ('id','uname','getent','chown','sleep','journalctl','systemctl','curl'):
                path = commands/command; path.write_text(SHIM); path.chmod(0o755)
            env = {**os.environ, 'PATH':str(commands)+os.pathsep+os.environ['PATH'],
                   'MONITER_INSTALL_DIR':str(root), 'MONITER_SYSTEMD_DIR':str(base/'units'),
                   'MONITER_BIN_DIR':str(base/'bin'), 'TEST_STATE':str(state)}
            package = base/'package'; package.mkdir()
            platform = 'linux-arm64' if os.uname().machine in ('aarch64','arm64') else 'linux-amd64'
            shutil.copyfile('/bin/true', package/'moniter')
            for file, content in {
                'release.json':json.dumps({'component':'server','version':'0.1.0','platform':platform}),
                'web/dist/index.html':'new frontend', 'web/assets/world-map-paths.svg':'map',
                **{f'binaries/aegis-agent-{platform}':'fixture' for platform in ('linux-amd64','linux-arm64','windows-amd64')},
            }.items():
                path=package/file; path.parent.mkdir(parents=True,exist_ok=True); path.write_text(content)
            for file in ('install.sh','install.ps1'): shutil.copyfile(REPO/file,package/file)
            def archive():
                with tarfile.open(state/'package.tar.gz','w:gz') as tar:
                    for file in sorted(package.iterdir()): tar.add(file,arcname=file.name)
            def metadata(tag='v0.1.0', assets=True):
                name=f'moniter-0.1.0-{platform}.tar.gz'
                (state/'release.json').write_text(json.dumps({'tag_name':tag,'assets':[
                    {'name':name,'browser_download_url':f'https://github.com/zen-box/moniter/releases/download/v0.1.0/{name}'}] if assets else []}))
            def run(*args, wrapper=False, success=True):
                result=subprocess.run(['bash',str(base/'bin/moniter' if wrapper else REPO/'install.sh'),*args],env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode==0,success,result.stdout+result.stderr)
                return result.stdout+result.stderr
            archive(); metadata()
            installed=run('--port','08080')
            self.assertIn('管理员密码:',installed)
            self.assertIn(':8080', (root/'moniter.env').read_text())
            self.assertTrue((state/'is-active').exists()); self.assertTrue((state/'is-enabled').exists())
            unit=(base/'units/moniter.service').read_text()
            self.assertIn('User=moniter',unit); self.assertIn('ProtectSystem=strict',unit)
            (root/'web/themes/custom').mkdir(); (root/'web/themes/custom/index.html').write_text('my theme')
            (root/'web/dist/old-chunk-Abcdef12.js').write_text('old chunk')
            with (root/'moniter.env').open('a') as config: config.write('AEGIS_PUBLIC_URL=https://fixture.example\n')
            updated=run('update',wrapper=True)
            self.assertNotIn('管理员密码:',updated)
            self.assertEqual((root/'web/themes/custom/index.html').read_text(),'my theme')
            self.assertIn('https://fixture.example',(root/'moniter.env').read_text())
            self.assertEqual((root/'data/probe.db').read_text(),'database fixture')
            self.assertTrue((root/'web/dist/old-chunk-Abcdef12.js').is_file())
            # New builds retain only the previous manifest's graph, not every
            # chunk inherited from older installations.
            (root/'web/dist/build-manifest.json').write_text(json.dumps({'index.html':{'file':'old-chunk-Abcdef12.js'}}))
            (root/'web/dist/stale-chunk-Abcdef12.js').write_text('stale chunk')
            run('update',wrapper=True)
            self.assertTrue((root/'web/dist/old-chunk-Abcdef12.js').is_file())
            self.assertFalse((root/'web/dist/stale-chunk-Abcdef12.js').exists())
            for tag,assets in [('agent-v0.1.0',True),('v0.1.0',False)]:
                metadata(tag,assets); stops=(state/'stops').read_text()
                run('update',success=False)
                self.assertEqual((state/'stops').read_text(),stops)
                self.assertTrue((state/'is-active').exists())
            metadata()
            (package/'binaries/aegis-agent-linux-arm64').unlink(); archive()
            stops=(state/'stops').read_text(); run('update',success=False)
            self.assertEqual((state/'stops').read_text(),stops)
            (package/'binaries/aegis-agent-linux-arm64').write_text('fixture'); archive()
            # Reject archive traversal before touching the current service.
            with tarfile.open(state/'package.tar.gz','w:gz') as tar:
                entry=tarfile.TarInfo('../escape'); entry.size=0; tar.addfile(entry)
            run('update',success=False)
            self.assertEqual((state/'stops').read_text(),stops); archive()
            (state/'fail-start').touch()
            run('update',success=False)
            self.assertTrue((state/'is-active').exists())
            self.assertEqual((root/'data/probe.db').read_text(),'database fixture')
            self.assertEqual((root/'web/themes/custom/index.html').read_text(),'my theme')
            self.assertEqual((base/'units/moniter.service').read_text(),unit)
            self.assertTrue(any((root/'backups').iterdir()))


if __name__ == '__main__': unittest.main()
