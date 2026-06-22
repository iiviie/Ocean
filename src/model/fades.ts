import type { Ticks } from "./time";

/** Linear fade multiplier in [0,1] at a playhead time, from fade-in/out durations.
 *  One envelope for both channels: visual clips apply it to opacity, audio clips
 *  (and a video clip's own sound) apply it to volume. The clip's fade duration is
 *  stored in `opacityFadeIn/Out` and reused here regardless of channel. */
export function fadeGain(playhead: Ticks, start: Ticks, end: Ticks, fadeIn: Ticks, fadeOut: Ticks): number {
  let g = 1;
  const into = playhead - start;
  const toEnd = end - playhead;
  if (fadeIn > 0 && into < fadeIn) g *= Math.max(0, into / fadeIn);
  if (fadeOut > 0 && toEnd < fadeOut) g *= Math.max(0, toEnd / fadeOut);
  return Math.max(0, Math.min(1, g));
}
