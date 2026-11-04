"""Package the installed Electron runtime, using a clean production dependency install."""
import json, plistlib, shutil, subprocess, platform
from pathlib import Path
root=Path(__file__).resolve().parents[1]
repo=root.parents[1]
output=root/'.local'/'release'
output.mkdir(parents=True, exist_ok=True)
app=output/'Grid Preview.app'
if app.exists(): shutil.rmtree(app)
shutil.copytree(root/'node_modules/electron/dist/Electron.app',app,symlinks=True)
resources=app/'Contents/Resources'
default=resources/'default_app.asar'
if default.exists(): default.unlink()
stage=resources/'app'
stage.mkdir()
pkg=json.loads((root/'package.json').read_text())
pkg['name']='grid-preview'
pkg['productName']='Grid Preview'
pkg['devDependencies']={}
pkg['scripts']={}
# Keep dependency metadata matching the lockfile for reproducible npm ci.
(stage/'package.json').write_text((root/'package.json').read_text())
shutil.copy2(root/'package-lock.json',stage/'package-lock.json')
subprocess.run(['npm','ci','--omit=dev','--ignore-scripts','--offline','--no-audit','--no-fund'],cwd=stage,check=True)
(stage/'package.json').write_text(json.dumps(pkg,indent=2))
(stage/'package-lock.json').unlink()
shutil.copytree(root/'dist',stage/'dist',ignore=shutil.ignore_patterns('*.test.js'))
shutil.copy2(repo/'LICENSE',stage/'LICENSE')
info=app/'Contents/Info.plist'
with info.open('rb') as f:data=plistlib.load(f)
old=data['CFBundleExecutable']
data.update(CFBundleExecutable='Grid Preview',CFBundleName='Grid Preview',CFBundleDisplayName='Grid Preview',CFBundleIdentifier='org.etherealspace.grid.preview',CFBundleShortVersionString='0.1.0',CFBundleVersion='1')
with info.open('wb') as f:plistlib.dump(data,f)
(app/'Contents/MacOS'/old).rename(app/'Contents/MacOS/Grid Preview')
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
archive=output/f'Grid-Preview-mac-{platform.machine()}.zip'
if archive.exists():archive.unlink()
subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(app),str(archive)],check=True)
print(archive)
