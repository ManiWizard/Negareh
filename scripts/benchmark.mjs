// Owns benchmark child processes and temporary reports; never cleans existing build caches.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir, release, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let samples = 3;
let name = 'latest';
let startupOnly = false;
let freshNative = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--startup-only') startupOnly = true;
  else if (arg === '--fresh-native') freshNative = true;
  else if (arg === '--samples') samples = Number(args[++index]);
  else if (arg === '--name') name = args[++index] ?? '';
  else throw new Error(`Unknown option: ${arg}`);
}
if (process.platform !== 'win32') throw new Error('This benchmark targets Windows.');
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error('Samples must be 1–10.');
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Use a simple report name, such as baseline or final.');
if (startupOnly && freshNative) throw new Error('Fresh native compilation requires build measurements.');

function run(command, commandArgs, env = process.env) {
  const start = performance.now();
  const result = spawnSync(command, commandArgs, { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr}\n${result.stdout}`);
  return { ms: performance.now() - start, output: result.stdout.trim(), compiledApp: /Compiling negareh-desktop/.test(result.stdout + result.stderr) };
}

async function startup(directory, index) {
  const reportPath = join(directory, `startup-${index}.json`);
  const start = performance.now();
  const child = spawn(join(root, 'src-tauri/target/release/negareh-desktop.exe'), [], {
    cwd: root,
    env: { ...process.env, NEGAREH_BENCH_REPORT: reportPath },
    stdio: 'ignore',
    windowsHide: false,
  });
  let failure;
  const exited = new Promise(resolveExit => {
    child.once('error', error => { failure = error; resolveExit(null); });
    child.once('exit', code => resolveExit(code));
  });
  try {
    let report;
    while (performance.now() - start < 30_000) {
      try {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error('App exited before reporting readiness.');
      await sleep(5);
    }
    if (!report || !Number.isFinite(report.nativeReadyMs)) throw new Error('Ready signal timed out or was invalid.');
    const externalReadyMs = performance.now() - start;
    console.log(`READY sample ${index}: ${externalReadyMs.toFixed(1)}ms. Take and inspect a screenshot NOW, then close this window to continue.`);
    let timeout;
    let exitCode;
    try {
      exitCode = await Promise.race([exited, new Promise(resolveTimeout => {
        timeout = setTimeout(() => resolveTimeout('timeout'), 300_000);
      })]);
    } finally {
      clearTimeout(timeout);
    }
    if (exitCode !== 0) throw new Error(`Benchmark app did not exit cleanly: ${exitCode}`);
    return { externalReadyMs, nativeReadyMs: report.nativeReadyMs, bootPaintMs: report.bootPaintMs, frontendReadyMs: report.frontendReadyMs, cleanExit: true };
  } finally {
    if (child.exitCode === null && child.pid) child.kill();
    await exited;
  }
}

async function size(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await size(path) : (await stat(path)).size;
  }
  return bytes;
}

const directory = await mkdtemp(join(tmpdir(), 'negareh-bench-'));
try {
  const report = {
    date: new Date().toISOString(),
    environment: { windows: release(), cpu: cpus()[0]?.model, node: process.version, cargo: run('cargo', ['--version']).output },
    method: 'Build-only by default. Startup is explicit (--startup-only): each instance stays open for a screenshot/inspection and manual close, outside ready timing. Run one inspected warm-up separately, then collect samples on an interactive unminimized desktop. Ready follows a paint opportunity; external poll interval 5ms. NativeBuild/verifiedBuild may recompile; Noop stages repeat identical commands unchanged. No clean build unless freshNativeMs is present.',
    stages: {},
    recompiledAppStages: [],
    startup: [],
  };
  if (!startupOnly) {
    const stages = [
      ['typecheckMs', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
      ['lintMs', process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', '--max-warnings', '0']],
      ['frontendMs', process.execPath, ['scripts/build.mjs']],
      ['nativeBuildMs', 'cargo', ['build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--manifest-path', 'src-tauri/Cargo.toml']],
      ['nativeNoopMs', 'cargo', ['build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--manifest-path', 'src-tauri/Cargo.toml']],
      ['verifiedBuildMs', process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run tauri build -- --no-bundle']],
      ['verifiedNoopBuildMs', process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run tauri build -- --no-bundle']],
    ];
    for (const [label, command, commandArgs] of stages) {
      const result = run(command, commandArgs);
      report.stages[label] = result.ms;
      if (result.compiledApp) report.recompiledAppStages.push(label);
      console.log(`${label}: ${report.stages[label].toFixed(1)}`);
    }
    if (freshNative) {
      report.stages.freshNativeMs = run('cargo', ['build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--manifest-path', 'src-tauri/Cargo.toml', '--target-dir', join(directory, 'fresh-target')]).ms;
    }
  }
  if (startupOnly) {
    for (let index = 0; index < samples; index += 1) report.startup.push(await startup(directory, index));
  }
  const times = report.startup.map(sample => sample.externalReadyMs).sort((a, b) => a - b);
  report.summary = times.length ? { minReadyMs: times[0], medianReadyMs: times[Math.floor(times.length / 2)], maxReadyMs: times.at(-1) } : null;
  report.bytes = { executable: (await stat(join(root, 'src-tauri/target/release/negareh-desktop.exe'))).size, frontend: await size(join(root, 'dist')) };
  await mkdir(join(root, 'benchmarks'), { recursive: true });
  await writeFile(join(root, 'benchmarks', `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ summary: report.summary, bytes: report.bytes, report: `benchmarks/${name}.json` }, null, 2));
} finally {
  const temporaryRoot = resolve(tmpdir());
  if (dirname(directory) !== temporaryRoot || !directory.startsWith(join(temporaryRoot, 'negareh-bench-'))) throw new Error('Refusing unexpected cleanup path.');
  await rm(directory, { recursive: true, force: true });
}
