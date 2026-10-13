// Min/max per bucket of `bucket` samples. The last bucket may be partial.
pub fn peaks_minmax(pcm: &[f32], bucket: usize) -> Vec<(f32, f32)> {
    let bucket = bucket.max(1);
    pcm.chunks(bucket)
        .map(|chunk| {
            chunk.iter().fold((f32::MAX, f32::MIN), |(lo, hi), &s| (lo.min(s), hi.max(s)))
        })
        .collect()
}
