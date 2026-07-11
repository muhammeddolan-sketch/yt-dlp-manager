// Builds the versioned browser-extension zip packages from web-extension/.
// Usage: node scripts/pack-extensions.js [chrome|firefox]  (default: both)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const version = require(path.join(rootDir, 'package.json')).version;
const srcDir = path.join(rootDir, 'web-extension');
const stageRoot = path.join(rootDir, '.tmp');

function stageExtension(dest) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(srcDir)) {
        if (entry.toLowerCase().endsWith('.zip')) continue; // never bundle stale packages
        fs.cpSync(path.join(srcDir, entry), path.join(dest, entry), { recursive: true });
    }
}

function zipDir(dir, outZip) {
    fs.rmSync(outZip, { force: true });
    if (process.platform === 'win32') {
        execFileSync('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            `Compress-Archive -Path "${dir}\\*" -DestinationPath "${outZip}" -Force`
        ], { stdio: 'inherit' });
    } else {
        execFileSync('zip', ['-r', outZip, '.'], { cwd: dir, stdio: 'inherit' });
    }
}

function removeOldPackages(prefix) {
    for (const entry of fs.readdirSync(rootDir)) {
        if (entry.startsWith(prefix) && entry.endsWith('.zip')) {
            fs.rmSync(path.join(rootDir, entry), { force: true });
        }
    }
}

function buildChrome() {
    const stage = path.join(stageRoot, 'chrome-extension');
    stageExtension(stage);
    removeOldPackages('UniGet-Extension-v');
    const outZip = path.join(rootDir, `UniGet-Extension-v${version}.zip`);
    zipDir(stage, outZip);
    console.log(`Built ${path.basename(outZip)}`);
}

function buildFirefox() {
    const stage = path.join(stageRoot, 'firefox-extension');
    stageExtension(stage);
    // Firefox MV3 uses background.scripts instead of service_worker.
    const manifestPath = path.join(stage, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.background = manifest.background || {};
    manifest.background.scripts = ['background.js'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    removeOldPackages('UniGet-Firefox-Extension-v');
    const outZip = path.join(rootDir, `UniGet-Firefox-Extension-v${version}.zip`);
    zipDir(stage, outZip);
    console.log(`Built ${path.basename(outZip)}`);
}

const target = (process.argv[2] || 'all').toLowerCase();
if (target === 'chrome' || target === 'all') buildChrome();
if (target === 'firefox' || target === 'all') buildFirefox();
