// Electron main process: window + lifecycle, a custom protocol that serves local
// media to the renderer (so <video>/<img> can load user files under webSecurity),
// and IPC for ffprobe-based import.
import { app, BrowserWindow, ipcMain, dialog, protocol, net } from "electron";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { open, stat, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { buildExportArgs, runExport, findFont, type ProjectDoc, type ExportOpts } from "./export";

const execFileP = promisify(execFile);

// Content identity used as the cache key for analysis artifacts (PERCEPTION_LAYER
// §1.2). Hashing a multi-GB file at import is too slow, so we hash a cheap
// signature: first + last 1 MiB plus the byte size. Collision-safe enough for a
// local cache, sub-100ms. Truncated to 128 bits for a tidy directory name.
async function fileIdentity(path: string): Promise<{ hash: string; size: number; mtime: number }> {
  const st = await stat(path);
  const size = st.size;
  const CHUNK = 1024 * 1024;
  const h = createHash("sha256");
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size));
    if (head.length) await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > CHUNK) {
      const tailLen = Math.min(CHUNK, size - CHUNK);
      const tail = Buffer.alloc(tailLen);
      await fh.read(tail, 0, tailLen, size - tailLen);
      h.update(tail);
    }
  } finally {
    await fh.close();
  }
  h.update(String(size));
  return { hash: h.digest("hex").slice(0, 32), size, mtime: Math.round(st.mtimeMs) };
}

// Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: "ocean-media", privileges: { secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
]);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#0a0b0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ---- ffprobe import ----
async function probe(path: string) {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path,
  ]);
  const v = JSON.parse(stdout);
  const streams: any[] = v.streams ?? [];
  let width = 0, height = 0, hasAudio = false, hasVideo = false, codec = "", nbFrames = 0;
  for (const s of streams) {
    if (s.codec_type === "video") {
      hasVideo = true;
      width = s.width ?? 0;
      height = s.height ?? 0;
      codec = s.codec_name ?? "";
      nbFrames = Number(s.nb_frames ?? 0);
    } else if (s.codec_type === "audio") hasAudio = true;
  }
  const durationSecs = Number(v.format?.duration ?? 0);
  const IMAGE = ["png", "mjpeg", "bmp", "webp", "tiff", "gif", "apng"];
  const isImage = hasVideo && !hasAudio && (IMAGE.includes(codec) || nbFrames === 1);
  const kind = isImage ? "image" : hasVideo ? "video" : hasAudio ? "audio" : "video";
  return { width, height, durationSecs, hasAudio, kind, fileIdentity: await fileIdentity(path) };
}

// ---- single-frame extraction (the model's vision escape hatch) ----
// Source-asset frame grab via ffmpeg (-ss before -i = fast seek). Returns a PNG
// data URL; the MCP server turns {image:"data:..."} into an image block.
async function extractFrame(path: string, atSec: number, maxPx: number): Promise<string> {
  const { stdout } = await execFileP(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-ss", String(Math.max(0, atSec)), "-i", path, "-frames:v", "1",
      "-vf", `scale=${Math.max(16, Math.round(maxPx))}:-2`, "-f", "image2pipe", "-vcodec", "png", "-"],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  return `data:image/png;base64,${(stdout as unknown as Buffer).toString("base64")}`;
}

// ---- analysis cache (out-of-band, keyed by fileIdentity hash) ----
// Heavy artifacts (shots, transcript, …) live here, NOT in the document model.
// Tools resolve them on demand and store only lightweight refs on the asset.
function analysisDir(hash: string): string {
  return join(app.getPath("userData"), "analysis", hash);
}

async function readAnalysis(hash: string, kind: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(join(analysisDir(hash), `${kind}.json`), "utf8"));
  } catch {
    return null; // not analyzed yet (or unreadable) — caller treats as "none"
  }
}

async function writeAnalysis(hash: string, kind: string, data: unknown): Promise<void> {
  const dir = analysisDir(hash);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${kind}.json`), JSON.stringify(data));
}

// ---- shot detection (ffmpeg scene-cut; no extra deps) ----
// `select=gt(scene,T)` emits one showinfo line per cut frame; pts_time is the
// cut timestamp. Output is bounded by the number of cuts, not the frame count.
const SHOTS_SCHEMA_VERSION = 1;

async function detectShots(path: string, durationSec: number) {
  const { stderr } = await execFileP(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-filter:v", "select='gt(scene,0.4)',showinfo", "-an", "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const cuts: number[] = [];
  const re = /pts_time:([0-9]+\.?[0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const tt = Number(m[1]);
    if (Number.isFinite(tt) && tt > 0.05) cuts.push(tt);
  }
  cuts.sort((a, b) => a - b);
  // Bounds = [0, ...cuts, end], dropping points closer than 50ms to the prior.
  const bounds = [0, ...cuts, durationSec].filter((v, i, arr) => i === 0 || v > arr[i - 1] + 0.05);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const shots: { idx: number; startSec: number; endSec: number; durSec: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    shots.push({ idx: i, startSec: r2(bounds[i]), endSec: r2(bounds[i + 1]), durSec: r2(bounds[i + 1] - bounds[i]) });
  }
  return { schemaVersion: SHOTS_SCHEMA_VERSION, analyzedAt: Date.now(), durationSec: r2(durationSec), shotCount: shots.length, shots };
}

// ---- transcript (speech-to-text) ----
// Backends are tried in preference order. whisper-ctranslate2 is the
// faster-whisper (CTranslate2) CLI — ~4-5x faster, lower memory, int8 on CPU —
// and is flag-compatible with openai-whisper, which is the fallback. Both write
// an openai-style JSON sidecar with segment timings that we normalize.
const TRANSCRIPT_SCHEMA_VERSION = 1;

const cmdCache = new Map<string, boolean>();
async function commandExists(cmd: string): Promise<boolean> {
  const cached = cmdCache.get(cmd);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    await execFileP(process.platform === "win32" ? "where" : "which", [cmd]);
    ok = true;
  } catch {
    ok = false;
  }
  cmdCache.set(cmd, ok);
  return ok;
}

interface TranscriptBackend { cmd: string; args: (path: string, outDir: string) => string[] }
const TRANSCRIPT_BACKENDS: TranscriptBackend[] = [
  // faster-whisper via its OpenAI-compatible CLI (`pip install whisper-ctranslate2`)
  { cmd: "whisper-ctranslate2", args: (p, o) => [p, "--model", "base", "--output_format", "json", "--output_dir", o, "--verbose", "False"] },
  // openai-whisper fallback (`pip install openai-whisper`)
  { cmd: "whisper", args: (p, o) => [p, "--model", "base", "--output_format", "json", "--output_dir", o, "--fp16", "False", "--verbose", "False"] },
];

async function transcriptBackend(): Promise<TranscriptBackend | null> {
  for (const b of TRANSCRIPT_BACKENDS) if (await commandExists(b.cmd)) return b;
  return null;
}

async function transcribe(path: string, hash: string) {
  const backend = await transcriptBackend();
  if (!backend) throw new Error("no transcript backend on PATH");
  const outDir = join(analysisDir(hash), "_whisper");
  await mkdir(outDir, { recursive: true });
  await execFileP(backend.cmd, backend.args(path, outDir), { maxBuffer: 64 * 1024 * 1024 });
  const jf = (await readdir(outDir)).find((f) => f.endsWith(".json"));
  if (!jf) throw new Error("transcript backend produced no JSON output");
  const parsed = JSON.parse(await readFile(join(outDir, jf), "utf8")) as {
    language?: string;
    segments?: { start: number; end: number; text: string }[];
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const segments = (parsed.segments ?? []).map((s, i) => ({ id: i, start: r2(s.start), end: r2(s.end), text: (s.text ?? "").trim() }));
  return { schemaVersion: TRANSCRIPT_SCHEMA_VERSION, analyzedAt: Date.now(), language: parsed.language ?? "", segmentCount: segments.length, segments };
}

// ---- silence detection (ffmpeg silencedetect; no extra deps) ----
// Spans below -30dB for >=0.5s — gaps / dead air, useful as cut points and to
// distinguish speech vs music coverage. silencedetect prints start/end pairs.
const SILENCE_SCHEMA_VERSION = 1;

async function detectSilence(path: string) {
  const { stderr } = await execFileP(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  const startRe = /silence_start:\s*([0-9]+\.?[0-9]*)/g;
  while ((m = startRe.exec(stderr))) starts.push(Number(m[1]));
  const silences: { start: number; end: number; dur: number }[] = [];
  const endRe = /silence_end:\s*([0-9]+\.?[0-9]*)\s*\|\s*silence_duration:\s*([0-9]+\.?[0-9]*)/g;
  let i = 0;
  while ((m = endRe.exec(stderr))) {
    const end = Number(m[1]);
    const dur = Number(m[2]);
    const start = starts[i] ?? end - dur;
    silences.push({ start: r2(start), end: r2(end), dur: r2(dur) });
    i++;
  }
  return { schemaVersion: SILENCE_SCHEMA_VERSION, analyzedAt: Date.now(), threshold: "-30dB", minDurSec: 0.5, silenceCount: silences.length, silences };
}

// ---- loudness / waveform envelope (ffmpeg; always available) ----
// Decode to mono PCM and reduce to a coarse RMS envelope so the model can "see"
// the audio as text: where it's loud vs quiet (highs/lows), prominent hits, and
// overall dynamics. The heavy PCM never leaves this process — only the envelope.
const WAVEFORM_SCHEMA_VERSION = 1;
const ENV_HZ = 50; // envelope resolution (points per second, 20ms windows)
const DECODE_HZ = 8000; // plenty for loudness/onset; keeps the PCM small

async function decodeMono(path: string, hz: number): Promise<Int16Array> {
  const { stdout } = await execFileP(
    "ffmpeg",
    ["-v", "quiet", "-i", path, "-ac", "1", "-ar", String(hz), "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  const buf = stdout as unknown as Buffer;
  const n = Math.floor(buf.length / 2);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(i * 2);
  return pcm;
}

function rmsEnvelope(pcm: Int16Array, hz: number) {
  const win = Math.max(1, Math.round(hz / ENV_HZ));
  const env: number[] = [];
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i += win) {
    const end = Math.min(i + win, pcm.length);
    let s = 0;
    let p = 0;
    for (let j = i; j < end; j++) {
      const v = Math.abs(pcm[j]);
      s += v * v;
      if (v > p) p = v;
    }
    env.push(Math.sqrt(s / Math.max(1, end - i)) / 32768);
    sumSq += s;
    peak = Math.max(peak, p / 32768);
  }
  return { env, peak, rms: Math.sqrt(sumSq / Math.max(1, pcm.length)) / 32768 };
}

/** Merge a boolean mask (per env-window) into [start,end] spans ≥ minDur seconds. */
function maskSpans(mask: boolean[], minDur: number) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const spans: { start: number; end: number }[] = [];
  let run = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (i < mask.length && mask[i]) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      const start = run / ENV_HZ;
      const end = i / ENV_HZ;
      if (end - start >= minDur) spans.push({ start: r2(start), end: r2(end) });
      run = -1;
    }
  }
  return spans;
}

async function analyzeWaveform(path: string, durationSec: number) {
  const pcm = await decodeMono(path, DECODE_HZ);
  const { env, peak, rms } = rmsEnvelope(pcm, DECODE_HZ);
  // Normalise by the 95th percentile (not the max) so a single transient hit
  // doesn't crush a sustained loud section below the "loud" threshold.
  const sorted = [...env].sort((a, b) => a - b);
  const ref = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const norm = env.map((v) => Math.min(1, v / ref));
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // downsample to ~200 points as 0..100 ints for a compact, text-friendly curve
  const TARGET = 200;
  const step = Math.max(1, Math.ceil(norm.length / TARGET));
  const points: number[] = [];
  for (let i = 0; i < norm.length; i += step) {
    let s = 0;
    const end = Math.min(i + step, norm.length);
    for (let j = i; j < end; j++) s += norm[j];
    points.push(Math.round((s / (end - i)) * 100));
  }

  const loud = maskSpans(norm.map((v) => v > 0.6), 0.3);
  const quiet = maskSpans(norm.map((v) => v < 0.15), 0.4);
  // prominent hits: local maxima above 0.6, spaced ≥0.3s apart
  const peaks: number[] = [];
  let lastPeak = -1;
  for (let i = 1; i < norm.length - 1; i++) {
    if (norm[i] > 0.6 && norm[i] >= norm[i - 1] && norm[i] > norm[i + 1]) {
      const t = i / ENV_HZ;
      if (lastPeak < 0 || t - lastPeak >= 0.3) { peaks.push(r2(t)); lastPeak = t; }
    }
  }
  return {
    schemaVersion: WAVEFORM_SCHEMA_VERSION, analyzedAt: Date.now(),
    durationSec: r2(durationSec), envHz: ENV_HZ,
    peak: r2(peak), rms: r2(rms),
    points, loud, quiet, peaks,
  };
}

// ---- beat tracking (aubiotrack if present; energy-onset fallback otherwise) ----
const BEATS_SCHEMA_VERSION = 1;

async function aubioBeats(path: string): Promise<number[] | null> {
  if (!(await commandExists("aubiotrack"))) return null;
  const { stdout } = await execFileP("aubiotrack", [path], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").map((l) => Number(l.trim())).filter((n) => Number.isFinite(n) && n >= 0);
}

/** Approximate beats from the loudness envelope's energy flux — used when no
 *  beat-tracking backend is installed. Coarser than aubio but always works. */
function energyBeats(env: number[]): number[] {
  const flux = env.map((v, i) => (i === 0 ? 0 : Math.max(0, v - env[i - 1])));
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const std = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, flux.length));
  const thresh = mean + 1.2 * std;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const beats: number[] = [];
  let last = -1;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > thresh && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      const t = i / ENV_HZ;
      if (last < 0 || t - last >= 0.18) { beats.push(r2(t)); last = t; } // ≤~330bpm
    }
  }
  return beats;
}

function tempoFromBeats(beats: number[]): { bpm: number; medianIntervalSec: number } {
  if (beats.length < 2) return { bpm: 0, medianIntervalSec: 0 };
  const intervals = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] || 0;
  return { bpm: median > 0 ? Math.round(60 / median) : 0, medianIntervalSec: Math.round(median * 100) / 100 };
}

async function analyzeBeats(path: string, durationSec: number) {
  let beats = await aubioBeats(path);
  let method = "aubio";
  if (!beats || beats.length < 2) {
    const pcm = await decodeMono(path, DECODE_HZ);
    const { env } = rmsEnvelope(pcm, DECODE_HZ);
    beats = energyBeats(env);
    method = "energy";
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const { bpm, medianIntervalSec } = tempoFromBeats(beats);
  return {
    schemaVersion: BEATS_SCHEMA_VERSION, analyzedAt: Date.now(),
    durationSec: r2(durationSec), method, bpm, medianIntervalSec,
    beatCount: beats.length, beats: beats.map(r2),
  };
}

// ---- job orchestration ----
// Async by design: analysis (ffmpeg/whisper) far exceeds the MCP bridge's 10s
// timeout, so callers START a job and POLL status; they never block on it.
interface AnalyzeCtx { durationSec: number; hash: string }
interface Analyzer {
  run: (path: string, ctx: AnalyzeCtx) => Promise<unknown>;
  available?: () => Promise<boolean>; // is the backend (e.g. whisper) on PATH?
}
const inFlight = new Map<string, Promise<void>>(); // key `${hash}:${kind}`

const ANALYZERS: Record<string, Analyzer> = {
  shots: { run: (p, c) => detectShots(p, c.durationSec) },
  silence: { run: (p) => detectSilence(p) },
  transcript: { run: (p, c) => transcribe(p, c.hash), available: async () => (await transcriptBackend()) !== null },
  waveform: { run: (p, c) => analyzeWaveform(p, c.durationSec) },
  beats: { run: (p, c) => analyzeBeats(p, c.durationSec) },
};

// "ok" | "unsupported" (no analyzer) | "unavailable" (backend not installed)
async function backendStatus(kind: string): Promise<string> {
  const a = ANALYZERS[kind];
  if (!a) return "unsupported";
  if (a.available && !(await a.available())) return "unavailable";
  return "ok";
}

function startAnalysis(hash: string, path: string, kind: string, ctx: AnalyzeCtx): string {
  const a = ANALYZERS[kind];
  if (!a) return "unsupported";
  const key = `${hash}:${kind}`;
  if (inFlight.has(key)) return "pending";
  const job = (async () => {
    try {
      await writeAnalysis(hash, kind, await a.run(path, ctx));
    } catch (e) {
      console.error(`[ocean] analysis '${kind}' failed:`, e);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return "pending";
}

async function analysisStatus(hash: string, kinds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const kind of kinds) {
    if (inFlight.has(`${hash}:${kind}`)) out[kind] = "pending";
    else if (await readAnalysis(hash, kind)) out[kind] = "ready";
    else out[kind] = await backendStatus(kind); // "none"→reported as ok-but-absent below
  }
  // backendStatus returns "ok" when a kind could run but hasn't — surface as "none".
  for (const kind of kinds) if (out[kind] === "ok") out[kind] = "none";
  return out;
}

// ---- project files (a project is a folder holding project.json) ----
// Assets are referenced by absolute path (not copied), so the folder only needs
// to carry the document JSON. New/Open/Save all flow through these handlers.
const PROJECT_FILE = "project.json";

async function readProjectAt(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, PROJECT_FILE), "utf8");
  } catch {
    return null;
  }
}

async function writeProjectAt(dir: string, json: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PROJECT_FILE), json, "utf8");
}

app.whenReady().then(() => {
  // Serve local files to the renderer via ocean-media://media<abs-path>
  protocol.handle("ocean-media", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURI(url.pathname);
    return net.fetch("file://" + filePath);
  });

  ipcMain.handle("ping", () => "ocean-core");
  ipcMain.handle("probe-media", (_e, path: string) => probe(path));

  // ---- perception analysis (async jobs + out-of-band cache) ----
  ipcMain.handle("analyze-media", async (_e, hash: string, path: string, kinds: string[], opts: { durationSec: number }) => {
    const status: Record<string, string> = {};
    for (const kind of kinds) {
      if (await readAnalysis(hash, kind)) { status[kind] = "ready"; continue; } // cache-first: no-op
      const b = await backendStatus(kind);
      if (b !== "ok") { status[kind] = b; continue; } // unsupported / unavailable backend
      status[kind] = startAnalysis(hash, path, kind, { durationSec: opts?.durationSec ?? 0, hash });
    }
    return status;
  });
  ipcMain.handle("analysis-status", (_e, hash: string, kinds: string[]) => analysisStatus(hash, kinds));
  ipcMain.handle("read-analysis", (_e, hash: string, kind: string) => readAnalysis(hash, kind));
  ipcMain.handle("extract-frame", (_e, path: string, atSec: number, maxPx: number) => extractFrame(path, atSec, maxPx));
  ipcMain.handle("import-dialog", async () => {
    const res = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Media", extensions: ["mp4", "mov", "webm", "mkv", "m4v", "png", "jpg", "jpeg", "gif", "webp", "mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const path = res.filePaths[0];
    const info = await probe(path);
    return { path, name: path.split("/").pop() ?? path, ...info };
  });

  // ---- project file IO ----
  ipcMain.handle("project-pick-new", async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog({
      title: "Create Project",
      defaultPath: defaultName || "Untitled",
      buttonLabel: "Create Project",
      properties: ["createDirectory"],
    });
    if (res.canceled || !res.filePath) return null;
    // Treat the chosen path as the project folder (strip any extension the OS added).
    const p = res.filePath;
    return p.replace(/\.(ocean|json)$/i, "");
  });
  ipcMain.handle("project-open", async () => {
    const res = await dialog.showOpenDialog({
      title: "Open Project",
      buttonLabel: "Open",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const json = await readProjectAt(dir);
    if (json == null) throw new Error(`No ${PROJECT_FILE} in ${basename(dir)}`);
    return { path: dir, json };
  });
  ipcMain.handle("project-read", (_e, dir: string) => readProjectAt(dir));
  ipcMain.handle("project-save", async (_e, dir: string, json: string) => {
    await writeProjectAt(dir, json);
    return true;
  });

  // ---- export ----
  ipcMain.handle("export-pick", async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog({
      title: "Export Video",
      defaultPath: defaultName.endsWith(".mp4") ? defaultName : `${defaultName}.mp4`,
      buttonLabel: "Export",
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    });
    return res.canceled || !res.filePath ? null : res.filePath;
  });
  ipcMain.handle("export-video", async (e, spec: { project: ProjectDoc } & ExportOpts) => {
    try {
      const fontFile = await findFont();
      const { args, durationSec } = buildExportArgs(spec.project, spec, fontFile);
      await runExport(args, durationSec, (p) => {
        if (!e.sender.isDestroyed()) e.sender.send("export-progress", p);
      });
      return { ok: true, outPath: spec.outPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
