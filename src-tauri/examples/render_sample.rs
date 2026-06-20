//! Headless render: load a project JSON, render one frame to PNG.
//! Usage: cargo run --example render_sample -- <project.json> <media_root> <t_secs> <out.png>
use ocean_lib::{compositor, model::Project};
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let project_path = args.get(1).expect("project.json path");
    let media_root = args.get(2).expect("media root dir");
    let t_secs: f64 = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(2.0);
    let out_path = args.get(4).map(|s| s.as_str()).unwrap_or("/tmp/ocean-render.png");

    let json = std::fs::read_to_string(project_path).expect("read project json");
    let project: Project = serde_json::from_str(&json).expect("parse project");

    let t0 = std::time::Instant::now();
    let frame = compositor::render(&project, t_secs, Path::new(media_root)).expect("render");
    let dt = t0.elapsed();
    frame.save(out_path).expect("save png");
    println!(
        "rendered {}x{} @ {t_secs}s in {:?} -> {out_path}",
        frame.width(),
        frame.height(),
        dt
    );
}
