//! Benchmark: streaming window decode vs per-frame seek.
//! Usage: decode_bench <video> [n_frames] [fps] [out_w] [out_h]
use ocean_lib::{decoder, media};
use std::path::Path;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = Path::new(args.get(1).expect("video path"));
    let n: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(60);
    let fps: f64 = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(30.0);
    let w: u32 = args.get(4).map(|s| s.parse().unwrap()).unwrap_or(640);
    let h: u32 = args.get(5).map(|s| s.parse().unwrap()).unwrap_or(360);

    // Streaming window decode (one ffmpeg).
    let t0 = Instant::now();
    let frames = decoder::decode_range(path, 0.0, n, fps, w, h).expect("decode_range");
    let dt = t0.elapsed();
    let per = dt.as_secs_f64() * 1000.0 / frames.len().max(1) as f64;
    println!(
        "streaming: {} frames @ {w}x{h} in {:?}  =>  {:.2} ms/frame  ({:.0} fps decode)",
        frames.len(),
        dt,
        per,
        1000.0 / per
    );

    // Per-frame seek (the old path), 10 frames for comparison.
    let probe = media::probe(path).unwrap();
    let sample = 10.min(n);
    let t1 = Instant::now();
    for i in 0..sample {
        let t = i as f64 / fps;
        let _ = media::frame_at(path, t, probe.kind == "image").unwrap();
    }
    let dt1 = t1.elapsed();
    let per1 = dt1.as_secs_f64() * 1000.0 / sample as f64;
    println!("per-frame seek: {sample} frames (full-res) in {:?}  =>  {:.2} ms/frame", dt1, per1);

    println!(
        "\nplayback needs <= {:.1} ms/frame for {fps}fps. streaming headroom: {:.1}x",
        1000.0 / fps,
        (1000.0 / fps) / per
    );
}
