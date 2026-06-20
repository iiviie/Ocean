//! Rust mirror of the TypeScript document model (src/model/types.ts).
//! Only the fields the renderer needs are required; everything has a sensible
//! default and unknown fields are ignored, so partial project JSON still loads.
use serde::Deserialize;

pub const TIMEBASE: i64 = 600;

pub fn ticks_to_seconds(t: i64) -> f64 {
    t as f64 / TIMEBASE as f64
}

fn d_half() -> f64 { 0.5 }
fn d_one() -> f64 { 1.0 }
fn d_true() -> bool { true }
fn d_lineheight() -> f64 { 1.2 }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    #[serde(default = "d_thirty")]
    pub fps: f64,
    #[serde(default)]
    pub background_color: String,
}
fn d_thirty() -> f64 { 30.0 }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    #[serde(default = "d_half")]
    pub center_x: f64,
    #[serde(default = "d_half")]
    pub center_y: f64,
    #[serde(default = "d_one")]
    pub scale: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
}
impl Default for Transform {
    fn default() -> Self {
        Transform { center_x: 0.5, center_y: 0.5, scale: 1.0, rotation: 0.0, flip_h: false, flip_v: false }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextProps {
    pub content: String,
    #[serde(default)]
    pub font_name: String,
    #[serde(default = "d_sixtyfour")]
    pub font_size: f64,
    #[serde(default = "d_white")]
    pub color: String,
    #[serde(default = "d_center")]
    pub align: String,
    #[serde(default = "d_lineheight")]
    pub line_height: f64,
}
fn d_sixtyfour() -> f64 { 64.0 }
fn d_white() -> String { "#ffffff".into() }
fn d_center() -> String { "center".into() }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub asset_id: Option<String>,
    pub timeline_start: i64,
    pub timeline_end: i64,
    #[serde(default)]
    pub source_in: i64,
    #[serde(default)]
    pub source_out: i64,
    #[serde(default = "d_one")]
    pub speed: f64,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default = "d_one")]
    pub opacity: f64,
    #[serde(default)]
    pub opacity_fade_in: i64,
    #[serde(default)]
    pub opacity_fade_out: i64,
    #[serde(default = "d_one")]
    pub volume: f64,
    #[serde(default)]
    pub text: Option<TextProps>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub kind: String,
    #[serde(default = "d_true")]
    pub enabled: bool,
    #[serde(default = "d_one")]
    pub opacity: f64,
    #[serde(default)]
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    pub uri: String,
    #[serde(default)]
    pub natural_width: u32,
    #[serde(default)]
    pub natural_height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(default)]
    pub name: String,
    pub canvas: Canvas,
    #[serde(default)]
    pub media_library: Vec<MediaAsset>,
    #[serde(default)]
    pub tracks: Vec<Track>,
}

impl Project {
    pub fn asset(&self, id: &str) -> Option<&MediaAsset> {
        self.media_library.iter().find(|a| a.id == id)
    }
}

impl Clip {
    /// Visible at the given timeline tick?
    pub fn active_at(&self, t_ticks: i64) -> bool {
        t_ticks >= self.timeline_start && t_ticks < self.timeline_end
    }

    /// Effective opacity at a tick, including fade in/out.
    pub fn opacity_at(&self, t_ticks: i64) -> f64 {
        let mut op = self.opacity;
        let into = t_ticks - self.timeline_start;
        let to_end = self.timeline_end - t_ticks;
        if self.opacity_fade_in > 0 && into < self.opacity_fade_in {
            op *= (into as f64 / self.opacity_fade_in as f64).max(0.0);
        }
        if self.opacity_fade_out > 0 && to_end < self.opacity_fade_out {
            op *= (to_end as f64 / self.opacity_fade_out as f64).max(0.0);
        }
        op.clamp(0.0, 1.0)
    }

    /// Source media time (seconds) corresponding to a timeline tick.
    pub fn source_time_secs(&self, t_ticks: i64) -> f64 {
        let offset = (t_ticks - self.timeline_start) as f64;
        ticks_to_seconds(self.source_in + (offset * self.speed) as i64)
    }
}
