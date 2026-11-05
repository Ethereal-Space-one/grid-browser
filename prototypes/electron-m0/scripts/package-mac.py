"""Package the installed Electron runtime, using a clean production dependency install."""
import argparse, hashlib, json, plistlib, re, shutil, subprocess, platform
from datetime import datetime, timezone
from pathlib import Path
root=Path(__file__).resolve().parents[1]
repo=root.parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',default='.local/release',help='Output directory inside .local')
parser.add_argument('--build-number',default='1')
parser.add_argument('--label',default='local-preview')
args=parser.parse_args()
if not re.fullmatch(r'\d{1,4}(?:\.\d{1,2}){0,2}',args.build_number): parser.error('Use a numeric major.minor.patch build number')
output=(root/args.output).resolve()
if root/'.local' not in output.parents: parser.error('Output must be a subdirectory of .local')
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
# Identify the actual staged source, including uncommitted files, without bundling local reports/profiles.
fingerprint=hashlib.sha256()
for file in sorted((stage/'dist').rglob('*')):
 if file.is_file(): fingerprint.update(file.relative_to(stage).as_posix().encode());fingerprint.update(b'\0');fingerprint.update(file.read_bytes())
fingerprint.update((stage/'package.json').read_bytes())
build={'label':args.label,'version':pkg['version'],'build':args.build_number,'architecture':platform.machine(),'builtAt':datetime.now(timezone.utc).isoformat(),'sourceSha256':fingerprint.hexdigest(),'scope':'local developer preview; ad-hoc signed; not notarized'}
(stage/'build-info.json').write_text(json.dumps(build,indent=2)+'\n')
(output/'build-info.json').write_text(json.dumps(build,indent=2)+'\n')
info=app/'Contents/Info.plist'
with info.open('rb') as f:data=plistlib.load(f)
old=data['CFBundleExecutable']
data.update(CFBundleExecutable='Grid Preview',CFBundleName='Grid Preview',CFBundleDisplayName='Grid Preview',CFBundleIdentifier='org.etherealspace.grid.preview',CFBundleShortVersionString=pkg['version'],CFBundleVersion=args.build_number)
with info.open('wb') as f:plistlib.dump(data,f)
(app/'Contents/MacOS'/old).rename(app/'Contents/MacOS/Grid Preview')
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
archive=output/f'Grid-{pkg["version"]}-mac-{platform.machine()}.zip'
if archive.exists():archive.unlink()
subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(app),str(archive)],check=True)
digest=hashlib.sha256()
with archive.open('rb') as file:
 for chunk in iter(lambda:file.read(1024*1024),b''):digest.update(chunk)
(output/(archive.name+'.sha256')).write_text(digest.hexdigest()+'  '+archive.name+'\n')
print(archive)
