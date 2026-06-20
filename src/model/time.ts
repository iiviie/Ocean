// Ocean uses an integer tick timebase internally for frame-accuracy and to keep
// tool output compact (ints, not floats). 600 is divisible by 24/25/30/60 fps.
export const TIMEBASE = 600;

export type Ticks = number; // integer

export const secondsToTicks = (s: number): Ticks => Math.round(s * TIMEBASE);
export const ticksToSeconds = (t: Ticks): number => t / TIMEBASE;

// Round seconds to <=2 decimals for any agent-facing / display output (PRD §7).
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const framesToTicks = (frames: number, fps: number): Ticks =>
  Math.round((frames / fps) * TIMEBASE);

/** Format ticks as mm:ss.cs (centiseconds) timecode. */
export function formatTimecode(t: Ticks): string {
  const total = ticksToSeconds(t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}
