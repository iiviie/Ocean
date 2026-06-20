//! CPU reference compositor. Renders the document at a given time into an RGBA
//! frame, honoring the render contract (PRD §6.4): z-order = track index then
//! clip order; center-anchored normalized transforms; opacity with fades;
//! straight-alpha sources composited "over". Text is rasterized with a real font
//! and its TRUE pixel bounds are measured — so spatial awareness reflects actual
//! geometry, not an estimate.
//!
//! This path is the export/headless fallback and the correctness oracle the wgpu
//! path is validated against.
use crate::media::{self};
use crate::model::{MediaAsset, Project, TextProps, Transform};
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use image::{imageops, Rgba, RgbaImage};
use std::path::Path;

const FONT_BYTES: &[u8] = include_bytes!("../assets/fonts/DejaVuSans.ttf");

fn font() -> FontRef<'static> {
    FontRef::try_from_slice(FONT_BYTES).expect("bundled font is valid")
}

/// Parse "#rrggbb" / "#rrggbbaa" → Rgba. Falls back to opaque black.
fn parse_color(s: &str) -> Rgba<u8> {
    let h = s.trim_start_matches('#');
    let to = |a: usize, b: usize| u8::from_str_radix(&h[a..b], 16).unwrap_or(0);
    match h.len() {
        6 => Rgba([to(0, 2), to(2, 4), to(4, 6), 255]),
        8 => Rgba([to(0, 2), to(2, 4), to(4, 6), to(6, 8)]),
        _ => Rgba([0, 0, 0, 255]),
    }
}

/// Normalized bounding box (0..1 of canvas) — what spatial-awareness reports.
#[derive(Debug, Clone, Copy)]
pub struct LayoutBox {
    pub center_x: f64,
    pub center_y: f64,
    pub width: f64,
    pub height: f64,
}

/// Source-of-truth text measurement in pixels: (width, height, per-line widths).
fn measure_text(text: &TextProps) -> (f32, f32, Vec<f32>) {
    let f = font();
    let scale = PxScale::from(text.font_size as f32);
    let sf = f.as_scaled(scale);
    let line_h = text.font_size as f32 * text.line_height as f32;
    let lines: Vec<&str> = text.content.split('\n').collect();
    let mut widths = Vec::with_capacity(lines.len());
    for line in &lines {
        let mut w = 0.0f32;
        let mut prev = None;
        for c in line.chars() {
            let g = f.glyph_id(c);
            if let Some(p) = prev {
                w += sf.kern(p, g);
            }
            w += sf.h_advance(g);
            prev = Some(g);
        }
        widths.push(w);
    }
    let max_w = widths.iter().cloned().fold(0.0, f32::max);
    let total_h = line_h * lines.len() as f32;
    (max_w, total_h, widths)
}

/// True normalized bbox of a text clip's rendered glyphs (spatial awareness).
pub fn text_layout_box(text: &TextProps, tr: &Transform, canvas_w: u32, canvas_h: u32) -> LayoutBox {
    let (w, h, _) = measure_text(text);
    LayoutBox {
        center_x: tr.center_x,
        center_y: tr.center_y,
        width: (w as f64 * tr.scale) / canvas_w as f64,
        height: (h as f64 * tr.scale) / canvas_h as f64,
    }
}

/// True normalized bbox of a media clip (fit-to-canvas × scale).
pub fn media_layout_box(nat_w: u32, nat_h: u32, tr: &Transform, canvas_w: u32, canvas_h: u32) -> LayoutBox {
    let fit = (canvas_w as f64 / nat_w.max(1) as f64).min(canvas_h as f64 / nat_h.max(1) as f64);
    LayoutBox {
        center_x: tr.center_x,
        center_y: tr.center_y,
        width: (nat_w as f64 * fit * tr.scale) / canvas_w as f64,
        height: (nat_h as f64 * fit * tr.scale) / canvas_h as f64,
    }
}

/// Alpha-composite `src` (already RGBA) onto `dst` at top-left (ox, oy), scaling
/// the source's alpha by `opacity`.
fn blend_over(dst: &mut RgbaImage, src: &RgbaImage, ox: i64, oy: i64, opacity: f64) {
    let (dw, dh) = dst.dimensions();
    for (sx, sy, px) in src.enumerate_pixels() {
        let dx = ox + sx as i64;
        let dy = oy + sy as i64;
        if dx < 0 || dy < 0 || dx >= dw as i64 || dy >= dh as i64 {
            continue;
        }
        let a = (px[3] as f64 / 255.0) * opacity;
        if a <= 0.0 {
            continue;
        }
        let d = dst.get_pixel_mut(dx as u32, dy as u32);
        for c in 0..3 {
            d[c] = (px[c] as f64 * a + d[c] as f64 * (1.0 - a)).round() as u8;
        }
        let da = d[3] as f64 / 255.0;
        d[3] = ((a + da * (1.0 - a)) * 255.0).round() as u8;
    }
}

fn draw_text(dst: &mut RgbaImage, text: &TextProps, tr: &Transform, opacity: f64) {
    let (cw, ch) = dst.dimensions();
    let f = font();
    let px = text.font_size as f32 * tr.scale as f32;
    let scale = PxScale::from(px);
    let sf = f.as_scaled(scale);
    let color = parse_color(&text.color);

    let line_h = px * text.line_height as f32;
    let lines: Vec<&str> = text.content.split('\n').collect();

    // measure at the scaled size
    let scaled_props = TextProps { font_size: px as f64, ..text.clone() };
    let (box_w, box_h, line_widths) = measure_text(&scaled_props);

    let cx = tr.center_x as f32 * cw as f32;
    let cy = tr.center_y as f32 * ch as f32;
    let box_left = cx - box_w / 2.0;
    let box_top = cy - box_h / 2.0;
    let ascent = sf.ascent();

    for (i, line) in lines.iter().enumerate() {
        let lw = line_widths[i];
        let line_x = match text.align.as_str() {
            "left" => box_left,
            "right" => box_left + (box_w - lw),
            _ => box_left + (box_w - lw) / 2.0,
        };
        let baseline_y = box_top + ascent + i as f32 * line_h;
        let mut pen_x = line_x;
        let mut prev = None;
        for c in line.chars() {
            let gid = f.glyph_id(c);
            if let Some(p) = prev {
                pen_x += sf.kern(p, gid);
            }
            let mut glyph = gid.with_scale(scale);
            glyph.position = ab_glyph::point(pen_x, baseline_y);
            if let Some(outlined) = f.outline_glyph(glyph) {
                let bounds = outlined.px_bounds();
                outlined.draw(|gx, gy, cov| {
                    let dx = bounds.min.x as i64 + gx as i64;
                    let dy = bounds.min.y as i64 + gy as i64;
                    if dx < 0 || dy < 0 || dx >= cw as i64 || dy >= ch as i64 {
                        return;
                    }
                    let a = cov as f64 * opacity;
                    if a <= 0.0 {
                        return;
                    }
                    let d = dst.get_pixel_mut(dx as u32, dy as u32);
                    for ch3 in 0..3 {
                        d[ch3] = (color[ch3] as f64 * a + d[ch3] as f64 * (1.0 - a)).round() as u8;
                    }
                    let da = d[3] as f64 / 255.0;
                    d[3] = ((a + da * (1.0 - a)) * 255.0).round() as u8;
                });
            }
            pen_x += sf.h_advance(gid);
            prev = Some(gid);
        }
    }
}

fn draw_media(dst: &mut RgbaImage, mut frame: RgbaImage, tr: &Transform, opacity: f64) {
    let (cw, ch) = dst.dimensions();
    let (nw, nh) = frame.dimensions();
    let fit = (cw as f64 / nw.max(1) as f64).min(ch as f64 / nh.max(1) as f64);
    let tw = ((nw as f64 * fit * tr.scale).round() as u32).max(1);
    let th = ((nh as f64 * fit * tr.scale).round() as u32).max(1);
    let mut scaled = imageops::resize(&frame, tw, th, imageops::FilterType::Triangle);
    if tr.flip_h {
        scaled = imageops::flip_horizontal(&scaled);
    }
    if tr.flip_v {
        scaled = imageops::flip_vertical(&scaled);
    }
    frame = scaled;
    let cx = tr.center_x * cw as f64;
    let cy = tr.center_y * ch as f64;
    let ox = (cx - tw as f64 / 2.0).round() as i64;
    let oy = (cy - th as f64 / 2.0).round() as i64;
    blend_over(dst, &frame, ox, oy, opacity);
    // NOTE: arbitrary rotation is handled by the wgpu path; the CPU reference
    // applies flips + scale + position. rotation != 0 is ignored here for now.
}

/// Do two normalized boxes overlap? (axis-aligned approximation)
pub fn boxes_overlap(a: &LayoutBox, b: &LayoutBox) -> bool {
    (a.center_x - b.center_x).abs() * 2.0 < a.width + b.width
        && (a.center_y - b.center_y).abs() * 2.0 < a.height + b.height
}

/// One visible object's measured layout at a time.
pub struct ClipBox {
    pub clip_id: String,
    pub kind: String,
    pub bbox: LayoutBox,
    pub z: usize,
}

/// Measured layout of every visible (non-audio) clip at `t_secs`. Text bounds
/// come from the real font rasterizer; media bounds from fit-to-canvas × scale.
/// This is the ground truth behind the agent's spatial awareness.
pub fn layout(project: &Project, t_secs: f64) -> Vec<ClipBox> {
    let t_ticks = (t_secs * crate::model::TIMEBASE as f64).round() as i64;
    let cw = project.canvas.width;
    let ch = project.canvas.height;
    let mut out = Vec::new();
    for (z, track) in project.tracks.iter().enumerate() {
        if !track.enabled || track.kind == "audio" {
            continue;
        }
        for clip in &track.clips {
            if !clip.active_at(t_ticks) {
                continue;
            }
            let bbox = if let Some(text) = &clip.text {
                text_layout_box(text, &clip.transform, cw, ch)
            } else if let Some(aid) = &clip.asset_id {
                match project.asset(aid) {
                    Some(a) => media_layout_box(a.natural_width.max(1), a.natural_height.max(1), &clip.transform, cw, ch),
                    None => continue,
                }
            } else {
                continue;
            };
            out.push(ClipBox { clip_id: clip.id.clone(), kind: clip.kind.clone(), bbox, z });
        }
    }
    out
}

/// Render the project at `t_secs` into an RGBA frame, sourcing decoded media
/// frames from `provider` (given an asset + its source time in seconds → frame).
/// This lets callers inject a cache/decoder; the compositor stays pure.
pub fn render_with<F>(project: &Project, t_secs: f64, mut provider: F) -> RgbaImage
where
    F: FnMut(&MediaAsset, f64) -> Option<RgbaImage>,
{
    let cw = project.canvas.width;
    let ch = project.canvas.height;
    let bg = if project.canvas.background_color.is_empty() {
        Rgba([0, 0, 0, 255])
    } else {
        parse_color(&project.canvas.background_color)
    };
    let mut out = RgbaImage::from_pixel(cw, ch, bg);
    let t_ticks = (t_secs * crate::model::TIMEBASE as f64).round() as i64;

    for track in &project.tracks {
        if !track.enabled || track.kind == "audio" {
            continue;
        }
        for clip in &track.clips {
            if !clip.active_at(t_ticks) {
                continue;
            }
            let opacity = clip.opacity_at(t_ticks) * track.opacity;
            if let Some(text) = &clip.text {
                draw_text(&mut out, text, &clip.transform, opacity);
                continue;
            }
            let Some(asset_id) = &clip.asset_id else { continue };
            let Some(asset) = project.asset(asset_id) else { continue };
            let src_t = clip.source_time_secs(t_ticks);
            if let Some(frame) = provider(asset, src_t) {
                draw_media(&mut out, frame, &clip.transform, opacity);
            }
        }
    }
    out
}

/// Render with the direct (uncached, full-res) decoder. Used by examples/export.
pub fn render(project: &Project, t_secs: f64, media_root: &Path) -> Result<RgbaImage, String> {
    Ok(render_with(project, t_secs, |asset, src| {
        let path = media::resolve_uri(&asset.uri, media_root);
        match media::frame_at(&path, src, asset.kind == "image") {
            Ok(f) => Some(f),
            Err(e) => {
                eprintln!("[ocean] decode {}: {e}", asset.uri);
                None
            }
        }
    }))
}
