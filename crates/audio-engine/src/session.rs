use serde::{Deserialize, Serialize};

// Mirrors @cutroom/session-model. Words and markers are ignored by the engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub sample_rate: u32,
    pub files: Vec<MediaFile>,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub id: String,
    pub path: String,
    pub duration_sec: f64,
    pub channel_count: u16,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub order: i32,
    pub mute: bool,
    pub solo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    pub file_id: String,
    pub source_in_sec: f64,
    pub source_out_sec: f64,
    pub timeline_start_sec: f64,
    pub gain_db: f64,
    pub fade_in_sec: f64,
    pub fade_out_sec: f64,
}

impl Clip {
    pub fn duration_sec(&self) -> f64 {
        self.source_out_sec - self.source_in_sec
    }

    pub fn timeline_end_sec(&self) -> f64 {
        self.timeline_start_sec + self.duration_sec()
    }

    // Same rule as clampFades in session-model: scale both fades down to fit.
    pub fn clamped_fades(&self) -> (f64, f64) {
        let duration = self.duration_sec().max(0.0);
        let fade_in = self.fade_in_sec.max(0.0);
        let fade_out = self.fade_out_sec.max(0.0);
        let total = fade_in + fade_out;
        if total <= duration {
            (fade_in, fade_out)
        } else if duration == 0.0 {
            (0.0, 0.0)
        } else {
            let scale = duration / total;
            (fade_in * scale, fade_out * scale)
        }
    }
}
