//! Print the measured layout at a time. Usage: layout_test <project.json> <t_secs>
use ocean_lib::{compositor, model::Project};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let json = std::fs::read_to_string(args.get(1).expect("project.json")).unwrap();
    let t: f64 = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(1.5);
    let project: Project = serde_json::from_str(&json).unwrap();
    let boxes = compositor::layout(&project, t);
    println!("layout @ {t}s ({}x{}):", project.canvas.width, project.canvas.height);
    for c in &boxes {
        println!(
            "  {} [{}] center=({:.2},{:.2}) size=({:.2},{:.2}) z={}",
            c.clip_id, c.kind, c.bbox.center_x, c.bbox.center_y, c.bbox.width, c.bbox.height, c.z
        );
    }
}
