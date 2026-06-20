//! Media I/O via the system FFmpeg/ffprobe binaries. Using the binaries (rather
//! than native bindings) keeps us robust across FFmpeg versions and avoids
//! fragile linking — the PRD's media engine boundary (§6.1). Frames come back as
//! decoded RGBA images.
use image::RgbaImage;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolve a document URI to a filesystem path. `asset://name` resolves against
/// the given media root; `file://` / absolute paths are used directly.
pub fn resolve_uri(uri: &str, media_root: &Path) -> PathBuf {
    if let Some(rest) = uri.strip_prefix("asset://") {
        media_root.join(rest)
    } else if let Some(rest) = uri.strip_prefix("file://") {
        PathBuf::from(rest)
    } else {
        PathBuf::from(uri)
    }
}

#[derive(Debug, Clone)]
pub struct ProbeInfo {
    pub width: u32,
    pub height: u32,
    pub duration_secs: f64,
    pub has_audio: bool,
    pub kind: String, // "video" | "image" | "audio"
}

/// Probe a media file with ffprobe (JSON output).
pub fn probe(path: &Path) -> Result<ProbeInfo, String> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|e| format!("ffprobe spawn failed: {e}"))?;
    if !out.status.success() {
        return Err(format!("ffprobe failed for {}", path.display()));
    }
    let v: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe json: {e}"))?;
    let streams = v.get("streams").and_then(|s| s.as_array()).cloned().unwrap_or_default();

    // Still-image codecs: a video stream with one of these is an image, not a clip.
    const IMAGE_CODECS: &[&str] = &["png", "mjpeg", "bmp", "webp", "tiff", "gif", "apng"];

    let mut width = 0;
    let mut height = 0;
    let mut has_audio = false;
    let mut has_video = false;
    let mut nb_video_frames = 0i64;
    let mut video_codec = String::new();
    for s in &streams {
        match s.get("codec_type").and_then(|c| c.as_str()) {
            Some("video") => {
                has_video = true;
                width = s.get("width").and_then(|w| w.as_u64()).unwrap_or(0) as u32;
                height = s.get("height").and_then(|h| h.as_u64()).unwrap_or(0) as u32;
                video_codec = s.get("codec_name").and_then(|c| c.as_str()).unwrap_or("").to_string();
                nb_video_frames = s
                    .get("nb_frames")
                    .and_then(|n| n.as_str())
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0);
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    let duration_secs = v
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);

    // Classify: a still-image codec (or a single-frame stream with no audio) is
    // an image; otherwise video if it has a video stream, else audio.
    let is_image = has_video
        && !has_audio
        && (IMAGE_CODECS.contains(&video_codec.as_str()) || nb_video_frames == 1);
    let kind = if is_image {
        "image"
    } else if has_video {
        "video"
    } else if has_audio {
        "audio"
    } else {
        "video"
    };

    Ok(ProbeInfo { width, height, duration_secs, has_audio, kind: kind.into() })
}

/// Decode a single RGBA frame from a video at `t_secs`, or load a still image.
pub fn frame_at(path: &Path, t_secs: f64, is_image: bool) -> Result<RgbaImage, String> {
    if is_image {
        let img = image::open(path).map_err(|e| format!("image open {}: {e}", path.display()))?;
        return Ok(img.to_rgba8());
    }
    // Seek to t_secs and pull exactly one frame as PNG on stdout.
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss"])
        .arg(format!("{t_secs:.4}"))
        .arg("-i")
        .arg(path)
        .args(["-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"])
        .output()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err(format!(
            "ffmpeg frame extract failed @ {t_secs}s for {}: {}",
            path.display(),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let img = image::load_from_memory(&out.stdout)
        .map_err(|e| format!("decode extracted frame: {e}"))?;
    Ok(img.to_rgba8())
}
