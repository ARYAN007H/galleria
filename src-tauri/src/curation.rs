/// 64-bit perceptual hash as 16-char hex (from 32×32 grayscale average hash).
pub fn compute_phash_from_path(path: &str) -> Option<String> {
    let img = image::ImageReader::open(path).ok()?.decode().ok()?;
    let gray = img.resize_exact(32, 32, image::imageops::FilterType::Triangle).to_luma8();
    let pixels: Vec<u8> = gray.into_raw();
    if pixels.len() < 1024 {
        return None;
    }
    let avg: u32 = pixels.iter().map(|&p| p as u32).sum::<u32>() / pixels.len() as u32;
    let mut hash: u64 = 0;
    for (i, &p) in pixels.iter().enumerate().take(64) {
        if (p as u32) >= avg {
            hash |= 1 << i;
        }
    }
    Some(format!("{:016x}", hash))
}
