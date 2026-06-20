//! Verify ffprobe parsing on real files. Usage: probe_test <file>...
use ocean_lib::media;
use std::path::Path;

fn main() {
    for path in std::env::args().skip(1) {
        match media::probe(Path::new(&path)) {
            Ok(i) => println!(
                "{path}: kind={} {}x{} dur={:.2}s audio={}",
                i.kind, i.width, i.height, i.duration_secs, i.has_audio
            ),
            Err(e) => println!("{path}: ERROR {e}"),
        }
    }
}
