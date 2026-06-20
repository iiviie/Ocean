// A small in-memory sample project so the editor shows something on first run
// and so the "AI changes appear in UI" demo has material to work with.
import type { Project } from "./types";
import { defaultTextProps, defaultTransform } from "./types";
import { secondsToTicks } from "./time";

export function createSampleProject(): Project {
  const now = Date.now();
  const sec = secondsToTicks;
  return {
    id: "p1",
    name: "Sample Reel",
    createdAt: now,
    modifiedAt: now,
    canvas: { width: 1080, height: 1920, fps: 30, backgroundColor: "#0a0a0f" },
    sampleRate: 48000,
    mediaLibrary: [
      { id: "a1", kind: "video", name: "intro.mp4", uri: "asset://intro.mp4", durationTicks: sec(8), naturalWidth: 1080, naturalHeight: 1920, hasAudio: true },
      { id: "a2", kind: "video", name: "broll.mp4", uri: "asset://broll.mp4", durationTicks: sec(12), naturalWidth: 1920, naturalHeight: 1080, hasAudio: true },
      { id: "a3", kind: "image", name: "logo.png", uri: "asset://logo.png", durationTicks: 0, naturalWidth: 512, naturalHeight: 512, hasAudio: false, colorInfo: { straightAlpha: true } },
      { id: "a4", kind: "audio", name: "track.mp3", uri: "asset://track.mp3", durationTicks: sec(30), naturalWidth: 0, naturalHeight: 0, hasAudio: true },
    ],
    tracks: [
      {
        id: "t1", kind: "video", name: "Video 1", enabled: true, locked: false, opacity: 1, volume: 1,
        clips: [
          { id: "c1", kind: "video", assetId: "a1", timelineStart: sec(0), timelineEnd: sec(5), sourceIn: sec(0), sourceOut: sec(5), speed: 1, transform: defaultTransform(), opacity: 1, opacityFadeIn: 0, opacityFadeOut: sec(0.5), volume: 1, keyframes: [], label: "c1" },
          { id: "c2", kind: "video", assetId: "a2", timelineStart: sec(5), timelineEnd: sec(11), sourceIn: sec(2), sourceOut: sec(8), speed: 1, transform: defaultTransform(), opacity: 1, opacityFadeIn: sec(0.3), opacityFadeOut: 0, volume: 1, keyframes: [], label: "c2" },
        ],
      },
      {
        id: "t2", kind: "text", name: "Text 1", enabled: true, locked: false, opacity: 1, volume: 1,
        clips: [
          { id: "c3", kind: "text", timelineStart: sec(0.5), timelineEnd: sec(3.5), sourceIn: 0, sourceOut: sec(3), speed: 1, transform: { ...defaultTransform(), centerY: 0.82 }, opacity: 1, opacityFadeIn: sec(0.2), opacityFadeOut: sec(0.2), volume: 1, keyframes: [], text: { ...defaultTextProps(), content: "OCEAN", fontSize: 120 }, label: "c3" },
        ],
      },
      {
        id: "t3", kind: "audio", name: "Audio 1", enabled: true, locked: false, opacity: 1, volume: 0.8,
        clips: [
          { id: "c4", kind: "audio", assetId: "a4", timelineStart: sec(0), timelineEnd: sec(11), sourceIn: sec(0), sourceOut: sec(11), speed: 1, transform: defaultTransform(), opacity: 1, opacityFadeIn: 0, opacityFadeOut: sec(1), volume: 0.8, keyframes: [], label: "c4" },
        ],
      },
    ],
    markers: [],
  };
}
