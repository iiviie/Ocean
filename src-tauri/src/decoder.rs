//! Streaming decoder + frame cache. The slow path (one FFmpeg seek per frame)
//! can't sustain playback, so for sequential playback we decode a *window* of
//! frames in a single FFmpeg invocation (rawvideo RGBA at a target fps + scale)
//! and cache them. Decoding sequential frames in one process is dramatically
//! faster than N independent seeks.
use image::RgbaImage;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

/// Decode `n_frames` consecutive frames starting at `start_secs`, resampled to
/// `fps` and scaled to `out_w`x`out_h`, in one FFmpeg invocation.
/// `-ss` before `-i` does a fast (keyframe) input seek — ideal for playback-ahead.
pub fn decode_range(
    path: &Path,
    start_secs: f64,
    n_frames: usize,
    fps: f64,
    out_w: u32,
    out_h: u32,
) -> Result<Vec<RgbaImage>, String> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss"])
        .arg(format!("{start_secs:.4}"))
        .arg("-i")
        .arg(path)
        .args(["-vf"])
        .arg(format!("fps={fps},scale={out_w}:{out_h}:flags=fast_bilinear"))
        .args(["-frames:v"])
        .arg(n_frames.to_string())
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
        .output()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ffmpeg decode_range failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let frame_bytes = (out_w * out_h * 4) as usize;
    if frame_bytes == 0 {
        return Err("zero frame size".into());
    }
    let count = out.stdout.len() / frame_bytes;
    let mut frames = Vec::with_capacity(count);
    for i in 0..count {
        let start = i * frame_bytes;
        let buf = out.stdout[start..start + frame_bytes].to_vec();
        let img = RgbaImage::from_raw(out_w, out_h, buf).ok_or("frame buffer size mismatch")?;
        frames.push(img);
    }
    Ok(frames)
}

/// Cache key: a specific decoded frame of an asset at a given preview resolution.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct FrameKey {
    pub uri: String,
    pub frame_index: i64, // at the cache fps
    pub w: u32,
    pub h: u32,
}

/// Simple LRU frame cache. Keeps decoded RGBA frames so scrubbing / replaying a
/// region is instant. Bounded by frame count to cap memory.
pub struct FrameCache {
    map: HashMap<FrameKey, RgbaImage>,
    order: Vec<FrameKey>,
    capacity: usize,
}

impl FrameCache {
    pub fn new(capacity: usize) -> Self {
        FrameCache { map: HashMap::new(), order: Vec::new(), capacity }
    }

    pub fn get(&mut self, key: &FrameKey) -> Option<RgbaImage> {
        if let Some(img) = self.map.get(key) {
            // bump recency
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                let k = self.order.remove(pos);
                self.order.push(k);
            }
            Some(img.clone())
        } else {
            None
        }
    }

    pub fn put(&mut self, key: FrameKey, img: RgbaImage) {
        if self.map.contains_key(&key) {
            self.map.insert(key.clone(), img);
            return;
        }
        while self.order.len() >= self.capacity {
            if let Some(old) = self.order.first().cloned() {
                self.order.remove(0);
                self.map.remove(&old);
            } else {
                break;
            }
        }
        self.order.push(key.clone());
        self.map.insert(key, img);
    }
}
