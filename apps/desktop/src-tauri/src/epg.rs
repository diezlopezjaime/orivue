//! Streaming XMLTV reader. A guide for thousands of channels is hundreds of
//! megabytes, far more than a webview can hold as a string, so the file is
//! read once from disk with bounded memory and only the programmes inside
//! the requested window are returned, in a compact row layout.

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::Serialize;

/// Lower bound on the memory used by a single text node or attribute.
const MAX_TEXT_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct GuideWindow {
    /// Milliseconds since the Unix epoch, inclusive.
    pub since_ms: i64,
    /// Milliseconds since the Unix epoch, exclusive.
    pub until_ms: i64,
}

/// `[channel id, start ms, stop ms, title, description, category]`.
pub type ProgrammeRow = (String, i64, i64, String, Option<String>, Option<String>);

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    /// Channel id to its first display name.
    pub channels: Vec<(String, String)>,
    pub programmes: Vec<ProgrammeRow>,
    /// Programmes outside the window or without the required fields.
    pub skipped: u64,
    pub warnings: Vec<String>,
}

/// Reads an XMLTV document (plain or gzip) from `path`.
pub fn read_guide(path: &Path, window: &GuideWindow) -> Result<Guide, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut magic = [0u8; 2];
    let gzip =
        file.read(&mut magic).map_err(|error| error.to_string())? == 2 && magic == [0x1f, 0x8b];
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    if gzip {
        let decoder = flate2::read::MultiGzDecoder::new(BufReader::with_capacity(1 << 16, file));
        parse(BufReader::with_capacity(1 << 16, decoder), window)
    } else {
        parse(BufReader::with_capacity(1 << 16, file), window)
    }
}

#[derive(Default)]
struct Programme {
    channel: String,
    start: Option<i64>,
    stop: Option<i64>,
    title: String,
    description: String,
    category: String,
}

/// Text field being collected: the first `display-name`, `title`, `desc`
/// or `category` of the open record. Text arrives in fragments (entity
/// references are separate events), so collection stays open until the
/// element closes.
#[derive(Clone, Copy, PartialEq)]
enum Field {
    DisplayName,
    Title,
    Description,
    Category,
}

fn parse<R: BufRead>(input: R, window: &GuideWindow) -> Result<Guide, String> {
    let mut reader = Reader::from_reader(input);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;
    let mut buffer = Vec::new();
    let mut guide = Guide::default();
    let mut depth: Vec<Vec<u8>> = Vec::new();
    let mut channel: Option<(String, String)> = None;
    let mut programme: Option<Programme> = None;
    let mut field: Option<Field> = None;
    let mut seen = std::collections::HashSet::new();
    loop {
        buffer.clear();
        let event = match reader.read_event_into(&mut buffer) {
            Ok(event) => event,
            Err(error) => {
                // A truncated download still yields what was read so far.
                guide.warnings.push(format!(
                    "the guide stopped being readable at byte {}: {error}",
                    reader.buffer_position()
                ));
                break;
            }
        };
        match event {
            Event::Eof => {
                if !depth.is_empty() {
                    guide.warnings.push(format!(
                        "the guide ended early with {} element(s) still open",
                        depth.len()
                    ));
                }
                break;
            }
            Event::Start(start) => {
                let name = start.local_name().as_ref().to_vec();
                match (depth.len(), name.as_slice()) {
                    (1, b"channel") => {
                        channel = Some((attribute(&start, b"id"), String::new()));
                    }
                    (1, b"programme") => {
                        programme = Some(Programme {
                            channel: attribute(&start, b"channel"),
                            start: parse_xmltv_date(&attribute(&start, b"start")),
                            stop: parse_xmltv_date(&attribute(&start, b"stop")),
                            ..Programme::default()
                        });
                    }
                    (2, _) => {
                        field = open_field(depth[1].as_slice(), &name, &channel, &programme);
                    }
                    _ => {}
                }
                depth.push(name);
            }
            Event::Empty(start) => {
                if depth.len() == 1 && start.local_name().as_ref() == b"programme" {
                    guide.skipped += 1;
                }
            }
            Event::Text(text) => {
                if field.is_some() {
                    let decoded = text
                        .decode()
                        .map(|value| value.into_owned())
                        .unwrap_or_else(|_| String::from_utf8_lossy(&text).into_owned());
                    let value = quick_xml::escape::unescape(&decoded)
                        .map(|value| value.into_owned())
                        .unwrap_or(decoded);
                    collect_text(field, &value, &mut channel, &mut programme);
                }
            }
            Event::CData(data) => {
                if field.is_some() {
                    let value = String::from_utf8_lossy(&data).into_owned();
                    collect_text(field, &value, &mut channel, &mut programme);
                }
            }
            Event::GeneralRef(reference) => {
                if field.is_some() {
                    let resolved = match reference.resolve_char_ref() {
                        Ok(Some(character)) => character.to_string(),
                        _ => match &reference[..] {
                            b"amp" => "&".into(),
                            b"lt" => "<".into(),
                            b"gt" => ">".into(),
                            b"quot" => "\"".into(),
                            b"apos" => "'".into(),
                            _ => String::new(),
                        },
                    };
                    collect_text(field, &resolved, &mut channel, &mut programme);
                }
            }
            Event::End(_) => {
                let name = depth.pop();
                if depth.len() == 2 {
                    field = None;
                }
                if depth.len() != 1 {
                    continue;
                }
                match name.as_deref() {
                    Some(b"channel") => {
                        if let Some((id, display_name)) = channel.take() {
                            if !id.is_empty() {
                                let display_name = display_name.trim().to_string();
                                let name = if display_name.is_empty() {
                                    id.clone()
                                } else {
                                    display_name
                                };
                                guide.channels.push((id, name));
                            }
                        }
                    }
                    Some(b"programme") => {
                        if let Some(programme) = programme.take() {
                            match keep(programme, window) {
                                Some(row) => {
                                    if seen.insert((row.0.clone(), row.1, row.3.clone())) {
                                        guide.programmes.push(row);
                                    } else {
                                        guide.skipped += 1;
                                    }
                                }
                                None => guide.skipped += 1,
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(guide)
}

/// Decides whether the child element that just opened is the first of its
/// kind for the open record; later duplicates (a second `display-name`) are
/// ignored.
fn open_field(
    parent: &[u8],
    name: &[u8],
    channel: &Option<(String, String)>,
    programme: &Option<Programme>,
) -> Option<Field> {
    match (parent, name) {
        (b"channel", b"display-name") => channel
            .as_ref()
            .filter(|(_, display_name)| display_name.is_empty())
            .map(|_| Field::DisplayName),
        (b"programme", b"title") => programme
            .as_ref()
            .filter(|programme| programme.title.is_empty())
            .map(|_| Field::Title),
        (b"programme", b"desc") => programme
            .as_ref()
            .filter(|programme| programme.description.is_empty())
            .map(|_| Field::Description),
        (b"programme", b"category") => programme
            .as_ref()
            .filter(|programme| programme.category.is_empty())
            .map(|_| Field::Category),
        _ => None,
    }
}

fn collect_text(
    field: Option<Field>,
    value: &str,
    channel: &mut Option<(String, String)>,
    programme: &mut Option<Programme>,
) {
    match field {
        Some(Field::DisplayName) => {
            if let Some((_, name)) = channel {
                append(name, value);
            }
        }
        Some(Field::Title) => {
            if let Some(programme) = programme {
                append(&mut programme.title, value);
            }
        }
        Some(Field::Description) => {
            if let Some(programme) = programme {
                append(&mut programme.description, value);
            }
        }
        Some(Field::Category) => {
            if let Some(programme) = programme {
                append(&mut programme.category, value);
            }
        }
        None => {}
    }
}

fn append(target: &mut String, value: &str) {
    let room = MAX_TEXT_BYTES.saturating_sub(target.len());
    let mut end = value.len().min(room);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&value[..end]);
}

fn keep(programme: Programme, window: &GuideWindow) -> Option<ProgrammeRow> {
    let start = programme.start?;
    let title = programme.title.trim().to_string();
    if programme.channel.is_empty() || title.is_empty() {
        return None;
    }
    let stop = programme.stop.unwrap_or(start + 30 * 60_000);
    if stop < window.since_ms || start >= window.until_ms || stop <= start {
        return None;
    }
    let description = programme.description.trim().to_string();
    let category = programme.category.trim().to_string();
    Some((
        programme.channel,
        start,
        stop,
        title,
        (!description.is_empty()).then_some(description),
        (!category.is_empty()).then_some(category),
    ))
}

fn attribute(start: &BytesStart<'_>, name: &[u8]) -> String {
    start
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.local_name().as_ref() == name)
        .map(|attribute| {
            attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map(|value| value.into_owned())
                .unwrap_or_else(|_| String::from_utf8_lossy(&attribute.value).into_owned())
        })
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

/// Parses `YYYYMMDDhhmmss ±hhmm` (every trailing component optional) into
/// milliseconds since the epoch. Without a zone the time is taken as UTC.
pub fn parse_xmltv_date(value: &str) -> Option<i64> {
    let value = value.trim();
    let digits: String = value.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() < 8 {
        return None;
    }
    let part = |from: usize, len: usize| -> i64 {
        digits
            .get(from..from + len)
            .and_then(|slice| slice.parse::<i64>().ok())
            .unwrap_or(0)
    };
    let (year, month, day) = (part(0, 4), part(4, 2), part(6, 2));
    let (hour, minute, second) = (part(8, 2), part(10, 2), part(12, 2));
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let mut millis = ((days * 86_400) + hour * 3_600 + minute * 60 + second) * 1000;
    let rest = value[digits.len()..].trim();
    if let Some(sign) = rest.chars().next() {
        if sign == '+' || sign == '-' {
            let zone: String = rest[1..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if zone.len() == 4 {
                let offset = zone[..2].parse::<i64>().unwrap_or(0) * 3_600
                    + zone[2..].parse::<i64>().unwrap_or(0) * 60;
                let offset = if sign == '+' { offset } else { -offset };
                millis -= offset * 1000;
            }
        }
    }
    Some(millis)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="News.ES"><display-name lang="es">Noticias 24</display-name><display-name>N24</display-name><icon src="x"/></channel>
  <channel id="empty"/>
  <programme start="20261010110000 +0000" stop="20261010123000 +0000" channel="News.ES"><title lang="es">Bolet&#237;n</title><desc><![CDATA[Noticias <b>de la mañana</b>]]></desc><category>News</category></programme>
  <programme start="20261010123000 +0200" stop="20261010140000 +0200" channel="News.ES"><title>Debate</title></programme>
  <programme start="20261010123000 +0200" stop="20261010140000 +0200" channel="News.ES"><title>Debate</title></programme>
  <programme start="20261001000000 +0000" stop="20261001010000 +0000" channel="News.ES"><title>Antiguo</title></programme>
  <programme start="20261010120000" channel="News.ES"><title>Sin fin</title></programme>
  <programme start="garbage" channel="News.ES"><title>Fecha mala</title></programme>
  <programme start="20261010120000 +0000" channel="News.ES"></programme>
  <programme start="20261010120000 +0000" channel="News.ES"/>
</tv>"#;

    fn window() -> GuideWindow {
        GuideWindow {
            since_ms: parse_xmltv_date("20261010100000 +0000").unwrap(),
            until_ms: parse_xmltv_date("20261013100000 +0000").unwrap(),
        }
    }

    #[test]
    fn parses_dates_with_and_without_zones() {
        assert_eq!(parse_xmltv_date("19700101000000 +0000"), Some(0));
        assert_eq!(parse_xmltv_date("19700101010000 +0100"), Some(0));
        assert_eq!(parse_xmltv_date("19700101000000 -0130"), Some(5_400_000));
        assert_eq!(parse_xmltv_date("19700102"), Some(86_400_000));
        assert_eq!(parse_xmltv_date("202610101200"), Some(1_791_633_600_000));
        assert_eq!(parse_xmltv_date("2026"), None);
        assert_eq!(parse_xmltv_date("20261310000000"), None);
    }

    #[test]
    fn keeps_only_programmes_inside_the_window() {
        let mut file = tempfile();
        file.write_all(SAMPLE.as_bytes()).unwrap();
        let guide = read_guide(file.path(), &window()).unwrap();
        assert_eq!(
            guide.channels,
            vec![("News.ES".to_string(), "Noticias 24".to_string())]
        );
        let titles: Vec<&str> = guide.programmes.iter().map(|row| row.3.as_str()).collect();
        assert_eq!(titles, vec!["Boletín", "Debate", "Sin fin"]);
        let first = &guide.programmes[0];
        assert_eq!(first.0, "News.ES");
        assert_eq!(first.1, parse_xmltv_date("20261010110000 +0000").unwrap());
        assert_eq!(first.4.as_deref(), Some("Noticias <b>de la mañana</b>"));
        assert_eq!(first.5.as_deref(), Some("News"));
        // Zone-aware: 12:30 +0200 is 10:30 UTC.
        assert_eq!(
            guide.programmes[1].1,
            parse_xmltv_date("20261010103000 +0000").unwrap()
        );
        // A missing stop defaults to thirty minutes.
        assert_eq!(guide.programmes[2].2 - guide.programmes[2].1, 30 * 60_000);
        // duplicate, old, bad date, no title, empty element
        assert_eq!(guide.skipped, 5);
        assert!(guide.warnings.is_empty());
    }

    #[test]
    fn reads_gzip_and_truncated_documents() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(SAMPLE.as_bytes()).unwrap();
        let mut file = tempfile();
        file.write_all(&encoder.finish().unwrap()).unwrap();
        let guide = read_guide(file.path(), &window()).unwrap();
        assert_eq!(guide.programmes.len(), 3);

        let mut truncated = tempfile();
        truncated
            .write_all(
                &SAMPLE.as_bytes()[..SAMPLE.find("<programme start=\"20261010123000").unwrap()],
            )
            .unwrap();
        let guide = read_guide(truncated.path(), &window()).unwrap();
        assert_eq!(guide.programmes.len(), 1);
        assert_eq!(guide.warnings.len(), 1);
    }

    struct TempFile(std::path::PathBuf, File);

    impl TempFile {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Write for TempFile {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            self.1.write(data)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.1.flush()
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn tempfile() -> TempFile {
        let path = std::env::temp_dir().join(format!(
            "orivue-epg-test-{}-{}.xml",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = File::create(&path).unwrap();
        TempFile(path, file)
    }
}
