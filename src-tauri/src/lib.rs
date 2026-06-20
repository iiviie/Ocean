// Ocean desktop core. Owns the media engine + compositor (and, per the PRD, will
// own the command bus, audio analysis, export pipeline, and MCP server) with the
// webview as a thin client (PRD §6).
pub mod compositor;
pub mod decoder;
pub mod media;
pub mod model;

use base64::Engine;
use std::path::Path;
use std::sync::Mutex;

/// Decoded-frame cache fps + decode window + resolution cap for preview playback.
const CACHE_FPS: f64 = 30.0;
const DECODE_WINDOW: usize = 30;
const DECODE_CAP: u32 = 480; // longest side of cached frames

/// Engine state held across command invocations (Tauri managed state).
pub struct EngineState {
    cache: Mutex<decoder::FrameCache>,
}

/// Preview decode dimensions for an asset: capped to DECODE_CAP, even, aspect-kept.
fn preview_dims(nat_w: u32, nat_h: u32) -> (u32, u32) {
    let (w, h) = if nat_w == 0 || nat_h == 0 { (1280, 720) } else { (nat_w, nat_h) };
    let long = w.max(h);
    let (mut dw, mut dh) = if long > DECODE_CAP {
        let s = DECODE_CAP as f64 / long as f64;
        ((w as f64 * s) as u32, (h as f64 * s) as u32)
    } else {
        (w, h)
    };
    dw &= !1;
    dh &= !1;
    (dw.max(2), dh.max(2))
}

/// Fetch a clip's frame from cache, decoding a window on miss (streaming).
fn cached_frame(
    cache: &mut decoder::FrameCache,
    media_root: &Path,
    asset: &model::MediaAsset,
    src_secs: f64,
) -> Option<image::RgbaImage> {
    let path = media::resolve_uri(&asset.uri, media_root);
    if asset.kind == "image" {
        let key = decoder::FrameKey { uri: asset.uri.clone(), frame_index: -1, w: 0, h: 0 };
        if let Some(f) = cache.get(&key) {
            return Some(f);
        }
        let img = media::frame_at(&path, 0.0, true).ok()?;
        cache.put(key, img.clone());
        return Some(img);
    }
    let (dw, dh) = preview_dims(asset.natural_width, asset.natural_height);
    let idx = (src_secs * CACHE_FPS).round().max(0.0) as i64;
    let key = decoder::FrameKey { uri: asset.uri.clone(), frame_index: idx, w: dw, h: dh };
    if let Some(f) = cache.get(&key) {
        return Some(f);
    }
    let start = idx as f64 / CACHE_FPS;
    match decoder::decode_range(&path, start, DECODE_WINDOW, CACHE_FPS, dw, dh) {
        Ok(frames) => {
            for (k, fr) in frames.into_iter().enumerate() {
                cache.put(
                    decoder::FrameKey { uri: asset.uri.clone(), frame_index: idx + k as i64, w: dw, h: dh },
                    fr,
                );
            }
            cache.get(&key)
        }
        Err(e) => {
            eprintln!("[ocean] decode_range {}: {e}", asset.uri);
            None
        }
    }
}

#[tauri::command]
fn ping() -> String {
    "ocean-core".into()
}

/// Render the project at `t_secs` and return a PNG data URL. `max_dim` downscales
/// the longest side for fast preview. This is the same compositor that feeds the
/// agent's capture_frame tool and export.
#[tauri::command]
fn render_frame(
    state: tauri::State<EngineState>,
    project_json: String,
    t_secs: f64,
    media_root: String,
    max_dim: Option<u32>,
) -> Result<String, String> {
    let project: model::Project =
        serde_json::from_str(&project_json).map_err(|e| format!("project parse: {e}"))?;
    let mp = std::path::PathBuf::from(&media_root);
    let mut cache = state.cache.lock().map_err(|e| e.to_string())?;
    let mut frame =
        compositor::render_with(&project, t_secs, |asset, src| cached_frame(&mut cache, &mp, asset, src));
    drop(cache);

    if let Some(md) = max_dim {
        let (w, h) = frame.dimensions();
        let m = w.max(h);
        if m > md {
            let s = md as f64 / m as f64;
            frame = image::imageops::resize(
                &frame,
                (w as f64 * s).round() as u32,
                (h as f64 * s).round() as u32,
                image::imageops::FilterType::Triangle,
            );
        }
    }

    let mut buf = std::io::Cursor::new(Vec::new());
    frame
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("png encode: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Decode ahead of the playhead into the cache so playback can pull frames fast.
/// Returns how many frames were decoded. Call when playback starts/seeks.
#[tauri::command]
fn prefetch(
    state: tauri::State<EngineState>,
    project_json: String,
    from_secs: f64,
    to_secs: f64,
    media_root: String,
) -> Result<usize, String> {
    let project: model::Project =
        serde_json::from_str(&project_json).map_err(|e| format!("project parse: {e}"))?;
    let mp = std::path::PathBuf::from(&media_root);
    let mut cache = state.cache.lock().map_err(|e| e.to_string())?;
    let tb = model::TIMEBASE as f64;
    let from_ticks = (from_secs * tb) as i64;
    let to_ticks = (to_secs * tb) as i64;
    let mut decoded = 0usize;
    for track in &project.tracks {
        if track.kind != "video" {
            continue;
        }
        for clip in &track.clips {
            if clip.timeline_end <= from_ticks || clip.timeline_start >= to_ticks {
                continue;
            }
            let Some(aid) = &clip.asset_id else { continue };
            let Some(asset) = project.asset(aid) else { continue };
            if asset.kind == "image" {
                if cached_frame(&mut cache, &mp, asset, 0.0).is_some() {
                    decoded += 1;
                }
                continue;
            }
            let seg_from = from_ticks.max(clip.timeline_start);
            let src_start = clip.source_time_secs(seg_from);
            let span = (to_ticks.min(clip.timeline_end) - seg_from) as f64 / tb;
            let n = (((span * CACHE_FPS).ceil() as usize) + 4).min(150);
            let (dw, dh) = preview_dims(asset.natural_width, asset.natural_height);
            let path = media::resolve_uri(&asset.uri, &mp);
            if let Ok(frames) = decoder::decode_range(&path, src_start, n, CACHE_FPS, dw, dh) {
                let base = (src_start * CACHE_FPS).round() as i64;
                for (k, fr) in frames.into_iter().enumerate() {
                    cache.put(
                        decoder::FrameKey { uri: asset.uri.clone(), frame_index: base + k as i64, w: dw, h: dh },
                        fr,
                    );
                    decoded += 1;
                }
            }
        }
    }
    Ok(decoded)
}

/// Measured spatial layout at a time — the ground truth for get_canvas_layout.
/// Returns each visible object's normalized box (from the real font/media metrics)
/// plus overlap pairs. Numbers rounded to 2 decimals to stay token-compact.
#[tauri::command]
fn layout_at(project_json: String, t_secs: f64) -> Result<serde_json::Value, String> {
    let project: model::Project =
        serde_json::from_str(&project_json).map_err(|e| format!("project parse: {e}"))?;
    let boxes = compositor::layout(&project, t_secs);
    let r2 = |x: f64| (x * 100.0).round() / 100.0;
    let objects: Vec<serde_json::Value> = boxes
        .iter()
        .map(|c| {
            serde_json::json!({
                "clip": c.clip_id, "kind": c.kind,
                "cx": r2(c.bbox.center_x), "cy": r2(c.bbox.center_y),
                "w": r2(c.bbox.width), "h": r2(c.bbox.height), "z": c.z
            })
        })
        .collect();
    let mut overlaps = Vec::new();
    for i in 0..boxes.len() {
        for j in (i + 1)..boxes.len() {
            if compositor::boxes_overlap(&boxes[i].bbox, &boxes[j].bbox) {
                overlaps.push(format!("{}~{}", boxes[i].clip_id, boxes[j].clip_id));
            }
        }
    }
    Ok(serde_json::json!({
        "canvas": { "w": project.canvas.width, "h": project.canvas.height },
        "objects": objects,
        "overlaps": overlaps,
    }))
}

/// Probe a media file's real metadata (for import).
#[tauri::command]
fn probe_media(path: String) -> Result<serde_json::Value, String> {
    let info = media::probe(std::path::Path::new(&path))?;
    Ok(serde_json::json!({
        "width": info.width,
        "height": info.height,
        "durationSecs": info.duration_secs,
        "hasAudio": info.has_audio,
        "kind": info.kind,
    }))
}

/// Open a native file picker, probe the chosen file, and return its metadata
/// (or null if cancelled). The path is absolute and resolves directly in the
/// compositor.
#[tauri::command]
fn import_dialog(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter(
            "Media",
            &["mp4", "mov", "webm", "mkv", "m4v", "png", "jpg", "jpeg", "gif", "webp", "mp3", "wav", "m4a", "aac", "flac", "ogg"],
        )
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let info = media::probe(&path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Some(serde_json::json!({
        "path": path.to_string_lossy(),
        "name": name,
        "kind": info.kind,
        "width": info.width,
        "height": info.height,
        "durationSecs": info.duration_secs,
        "hasAudio": info.has_audio,
    })))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState { cache: Mutex::new(decoder::FrameCache::new(400)) })
        .invoke_handler(tauri::generate_handler![
            ping,
            render_frame,
            prefetch,
            layout_at,
            probe_media,
            import_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ocean");
}
