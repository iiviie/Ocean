// Electron main process: window + lifecycle, a custom protocol that serves local
// media to the renderer (so <video>/<img> can load user files under webSecurity),
// and IPC for ffprobe-based import.
import { app, BrowserWindow, ipcMain, dialog, protocol, net } from "electron";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

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
  return { width, height, durationSecs, hasAudio, kind };
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

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
