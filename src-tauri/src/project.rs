// Owns constrained project IO; paths originate in native dialogs or persisted app state.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timeline {
    id: String,
    name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Character {
    id: String,
    #[serde(flatten)]
    values: CharacterValues,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    instances: Option<Vec<CharacterInstance>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    primary_instance: Option<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    shared_values: std::collections::BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterValues {
    #[serde(default)]
    role_summary: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    birthplace_image: String,
    #[serde(default)]
    references: Vec<CharacterReference>,
    #[serde(default)]
    connections: Vec<CharacterConnection>,
    portrait: String,
    name: String,
    family_name: String,
    middle_name: String,
    aliases: Vec<String>,
    birth: String,
    death: String,
    #[serde(default)]
    age: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    categories: Vec<CharacterCategory>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CharacterReference {
    id: String,
    image: String,
    caption: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    note: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    category: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    view: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rotation: Option<f64>,
    #[serde(default, rename = "pinColor", skip_serializing_if = "String::is_empty")]
    pin_color: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    links: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CharacterConnection {
    id: String,
    target: String,
    label: String,
    bond: String,
    tension: String,
    context: String,
}
fn valid_connections(connections: &[CharacterConnection]) -> bool {
    let mut ids = std::collections::HashSet::new();
    let mut targets = std::collections::HashSet::new();
    connections.len() <= 24
        && connections.iter().all(|connection| {
            connection.id.starts_with("connection-")
                && connection.id.len() <= 80
                && connection
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && ids.insert(&connection.id)
                && targets.insert(&connection.target)
                && connection.target.starts_with("character-")
                && connection.target.len() <= 80
                && connection
                    .target
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && connection.label.encode_utf16().take(81).count() <= 80
                && [&connection.bond, &connection.tension, &connection.context]
                    .iter()
                    .all(|text| text.encode_utf16().take(10_001).count() <= 10_000)
        })
}
fn valid_character_image(image: &str) -> bool {
    image.len() <= 1_000_000
        && (image.is_empty()
            || image.split_once(',').is_some_and(|(header, data)| {
                [
                    "data:image/png;base64",
                    "data:image/jpeg;base64",
                    "data:image/webp;base64",
                ]
                .contains(&header)
                    && !data.is_empty()
                    && data
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
            }))
}
fn valid_references(references: &[CharacterReference]) -> bool {
    let mut ids = std::collections::HashSet::new();
    references.len() <= 62
        && references.iter().filter(|item| item.kind != "note").count() <= 12
        && references.iter().filter(|item| item.kind == "note").count() <= 50
        && references.iter().all(|reference| {
            reference.id.starts_with("reference-")
                && reference.id.len() <= 80
                && reference
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && ids.insert(&reference.id)
                && reference.caption.encode_utf16().take(201).count() <= 200
                && ["", "image", "note"].contains(&reference.kind.as_str())
                && (if reference.kind == "note" {
                    reference.image.is_empty()
                } else {
                    !reference.image.is_empty()
                })
                && valid_character_image(&reference.image)
                && reference.note.encode_utf16().take(10_001).count() <= 10_000
                && [
                    "",
                    "essence",
                    "appearance",
                    "personality",
                    "history",
                    "relationships",
                    "body",
                    "life",
                ]
                .contains(&reference.category.as_str())
                && ["", "front", "side", "back"].contains(&reference.view.as_str())
                && [reference.x, reference.y].iter().all(|position| {
                    position.is_none_or(|value| value.is_finite() && (0.0..=1.0).contains(&value))
                })
                && reference
                    .rotation
                    .is_none_or(|value| value.is_finite() && (-180.0..=180.0).contains(&value))
                && (reference.pin_color.is_empty()
                    || (reference.pin_color.len() == 7
                        && reference.pin_color.starts_with('#')
                        && reference
                            .pin_color
                            .bytes()
                            .skip(1)
                            .all(|byte| byte.is_ascii_hexdigit())))
                && reference.links.len() <= 61
                && reference
                    .links
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    == reference.links.len()
                && reference.links.iter().all(|target| {
                    target != &reference.id && references.iter().any(|other| &other.id == target)
                })
        })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CharacterInstance {
    id: String,
    label: String,
    values: CharacterValues,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CharacterCategory {
    id: String,
    traits: Vec<CharacterTrait>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CharacterTrait {
    id: String,
    value: String,
}
#[derive(Deserialize)]
struct CategoryDefinition {
    id: String,
    traits: Vec<TraitDefinition>,
}
#[derive(Deserialize)]
struct TraitDefinition {
    id: String,
}
fn valid_character_sheet(character: &CharacterValues, catalogue: &[CategoryDefinition]) -> bool {
    let mut categories = std::collections::HashSet::new();
    character.age.encode_utf16().take(81).count() <= 80
        && character.tags.len() <= 3
        && character
            .tags
            .iter()
            .all(|tag| !tag.trim().is_empty() && tag.encode_utf16().take(81).count() <= 80)
        && character.categories.len() <= catalogue.len()
        && character.categories.iter().all(|category| {
            let Some(definition) = catalogue.iter().find(|item| item.id == category.id) else {
                return false;
            };
            let mut traits = std::collections::HashSet::new();
            categories.insert(&category.id)
                && category.traits.len() <= definition.traits.len()
                && category.traits.iter().all(|item| {
                    traits.insert(&item.id)
                        && definition
                            .traits
                            .iter()
                            .any(|trait_definition| trait_definition.id == item.id)
                        && item.value.encode_utf16().take(10_001).count() <= 10_000
                })
        })
}
fn invalid_character_values(character: &CharacterValues, catalogue: &[CategoryDefinition]) -> bool {
    character.name.trim().is_empty()
        || [
            &character.name,
            &character.family_name,
            &character.middle_name,
            &character.birth,
            &character.death,
        ]
        .iter()
        .any(|value| value.encode_utf16().take(81).count() > 80)
        || character.aliases.len() > 50
        || character
            .aliases
            .iter()
            .any(|alias| alias.trim().is_empty() || alias.encode_utf16().take(81).count() > 80)
        || character.portrait.len() > 1_000_000
        || !valid_character_image(&character.portrait)
        || !valid_character_image(&character.birthplace_image)
        || character.role_summary.encode_utf16().take(161).count() > 160
        || character.quote.encode_utf16().take(1001).count() > 1000
        || !valid_references(&character.references)
        || !valid_connections(&character.connections)
        || !valid_character_sheet(character, catalogue)
}
fn valid_shared_value(
    field: &str,
    value: &serde_json::Value,
    catalogue: &[CategoryDefinition],
) -> bool {
    if field == "tags" || field == "aliases" {
        return value.as_array().is_some_and(|items| {
            items.len() <= if field == "tags" { 3 } else { 50 }
                && items.iter().all(|item| {
                    item.as_str().is_some_and(|text| {
                        !text.trim().is_empty() && text.encode_utf16().take(81).count() <= 80
                    })
                })
        });
    }
    if field == "connections" {
        return serde_json::from_value::<Vec<CharacterConnection>>(value.clone())
            .is_ok_and(|connections| valid_connections(&connections));
    }
    if field == "references" {
        return serde_json::from_value::<Vec<CharacterReference>>(value.clone())
            .is_ok_and(|references| valid_references(&references));
    }
    let Some(text) = value.as_str() else {
        return false;
    };
    if field == "portrait" || field == "birthplaceImage" {
        return valid_character_image(text);
    }
    if field == "roleSummary" {
        return text.encode_utf16().take(161).count() <= 160;
    }
    if field == "quote" {
        return text.encode_utf16().take(1001).count() <= 1000;
    }
    if let Some((category, trait_id)) = field.split_once('/') {
        return catalogue
            .iter()
            .any(|item| item.id == category && item.traits.iter().any(|item| item.id == trait_id))
            && text.encode_utf16().take(10_001).count() <= 10_000;
    }
    ["name", "middleName", "familyName", "age", "birth", "death"].contains(&field)
        && text.encode_utf16().take(81).count() <= 80
        && (field != "name" || !text.trim().is_empty())
}
fn valid_character_instances(character: &Character, catalogue: &[CategoryDefinition]) -> bool {
    if !character
        .shared_values
        .iter()
        .all(|(key, value)| valid_shared_value(key, value, catalogue))
    {
        return false;
    }
    let Some(instances) = &character.instances else {
        return character.primary_instance.is_none() && character.shared_values.is_empty();
    };
    let mut ids = std::collections::HashSet::new();
    let mut labels = std::collections::HashSet::new();
    !instances.is_empty()
        && instances.len() <= 1000
        && character
            .primary_instance
            .as_ref()
            .is_some_and(|id| instances.iter().any(|instance| &instance.id == id))
        && instances.iter().all(|instance| {
            instance.id.starts_with("instance-")
                && instance.id.len() <= 80
                && instance
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && ids.insert(&instance.id)
                && !instance.label.trim().is_empty()
                && instance.label.encode_utf16().take(81).count() <= 80
                && labels.insert(instance.label.trim())
                && !invalid_character_values(&instance.values, catalogue)
        })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    version: u8,
    name: String,
    notes: String,
    #[serde(default)]
    timelines: Vec<Timeline>,
    #[serde(default)]
    characters: Vec<Character>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace: Option<serde_json::Value>,
}
impl Project {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.name.trim().is_empty()
            || self.name.encode_utf16().take(201).count() > 200
            || self.notes.encode_utf16().take(1_000_001).count() > 1_000_000
        {
            return Err("Invalid or unsupported Negareh project.".into());
        }
        let mut ids = std::collections::HashSet::new();
        if self.timelines.len() > 1000
            || self.timelines.iter().any(|timeline| {
                !timeline.id.starts_with("timeline-")
                    || timeline.id.len() > 80
                    || !timeline
                        .id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                    || !ids.insert(&timeline.id)
                    || timeline.name.trim().is_empty()
                    || timeline.name.encode_utf16().take(81).count() > 80
            })
        {
            return Err("Invalid project timelines.".into());
        }
        let catalogue: Vec<CategoryDefinition> =
            serde_json::from_str(include_str!("../../src/character-catalogue.json"))
                .map_err(|error| error.to_string())?;
        let mut character_ids = std::collections::HashSet::new();
        if self.characters.len() > 1000
            || self.characters.iter().any(|character| {
                !character.id.starts_with("character-")
                    || character.id.len() > 80
                    || !character
                        .id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                    || !character_ids.insert(&character.id)
                    || invalid_character_values(&character.values, &catalogue)
                    || !valid_character_instances(character, &catalogue)
            })
        {
            return Err("Invalid project characters.".into());
        }
        for character in &self.characters {
            let valid_targets = |connections: &[CharacterConnection]| {
                connections.iter().all(|connection| {
                    connection.target != character.id
                        && self
                            .characters
                            .iter()
                            .any(|target| target.id == connection.target)
                })
            };
            if !valid_targets(&character.values.connections)
                || character.instances.as_ref().is_some_and(|instances| {
                    instances
                        .iter()
                        .any(|instance| !valid_targets(&instance.values.connections))
                })
                || character
                    .shared_values
                    .get("connections")
                    .is_some_and(|value| {
                        serde_json::from_value::<Vec<CharacterConnection>>(value.clone())
                            .map_or(true, |connections| !valid_targets(&connections))
                    })
            {
                return Err("A character connection points to an unavailable character.".into());
            }
        }
        Ok(())
    }
    fn validate_for_write(&self) -> Result<(), String> {
        self.validate()?;
        if self
            .workspace
            .as_ref()
            .is_some_and(|value| value.to_string().len() > 4_000_000)
        {
            return Err("Workspace state exceeds the 4 MB limit.".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct Files {
    current: Mutex<Option<PathBuf>>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct History {
    recent: Option<PathBuf>,
}
#[derive(Serialize)]
pub struct Startup {
    recent: Option<String>,
    recovery: bool,
    version: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    project: Project,
    path: Option<PathBuf>,
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    const LIMIT: u64 = 12_100_000;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
        return Err("Project is too large.".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Project is too large.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid Negareh file.".into())
}
fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = path.with_extension(format!("negareh-writing-{}-{stamp}", std::process::id()));
    let result = (|| {
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        if bytes.len() > 12_100_000 {
            return Err("Project is too large.".into());
        }
        let mut file = fs::File::options()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn history(app: &tauri::AppHandle) -> Result<History, String> {
    let path = directory(app)?.join("history.json");
    if !path.exists() {
        return Ok(History::default());
    }
    read(&path)
}
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window only.".into());
    }
    Ok(())
}
fn automation_path(path: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    if !cfg!(debug_assertions) {
        return Err("Explicit automation paths are disabled in release builds.".into());
    }
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.extension().and_then(|s| s.to_str()) != Some("negareh") {
        return Err("Automation requires an absolute .negareh path.".into());
    }
    Ok(Some(path))
}
#[tauri::command]
pub fn automation_geometry(
    window: tauri::WebviewWindow,
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    main_only(&window)?;
    if !cfg!(debug_assertions) {
        return Err("Automation geometry is disabled in release builds.".into());
    }
    match (x, y, width, height) {
        (Some(x), Some(y), None, None)
            if (-32768..=32768).contains(&x) && (-32768..=32768).contains(&y) =>
        {
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())
        }
        (None, None, Some(width), Some(height))
            if (760..=8192).contains(&width) && (480..=8192).contains(&height) =>
        {
            window
                .set_size(tauri::PhysicalSize::new(width, height))
                .map_err(|e| e.to_string())
        }
        _ => Err("Provide a bounded position OR size.".into()),
    }
}
#[tauri::command]
pub fn project_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Startup, String> {
    main_only(&window)?;
    Ok(Startup {
        recent: history(&app)
            .unwrap_or_default()
            .recent
            .map(|p| p.to_string_lossy().into_owned()),
        recovery: directory(&app)?.join("recovery.json").exists(),
        version: app.package_info().version.to_string(),
    })
}
#[tauri::command]
pub async fn project_open(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    files: tauri::State<'_, Files>,
    recent: bool,
    path: Option<String>,
) -> Result<Option<Session>, String> {
    main_only(&window)?;
    let explicit = automation_path(path)?;
    let path = if explicit.is_some() {
        explicit
    } else if recent {
        history(&app)?.recent
    } else {
        rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .add_filter("Negareh project", &["negareh"])
            .pick_file()
            .await
            .map(|f| f.path().to_path_buf())
    };
    let Some(path) = path else {
        return Ok(None);
    };
    if path.extension().and_then(|s| s.to_str()) != Some("negareh") {
        return Err("Select a .negareh project.".into());
    }
    let project: Project = read(&path)?;
    project.validate()?;
    write(
        &directory(&app)?.join("history.json"),
        &History {
            recent: Some(path.clone()),
        },
    )?;
    *files.current.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(Some(Session {
        project,
        path: Some(path),
    }))
}
#[tauri::command]
pub async fn project_save(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    files: tauri::State<'_, Files>,
    project: Project,
    destination: Option<String>,
    overwrite: Option<bool>,
) -> Result<Option<String>, String> {
    main_only(&window)?;
    project.validate_for_write()?;
    let explicit = automation_path(destination)?;
    if explicit.as_ref().is_some_and(|path| path.exists()) && overwrite != Some(true) {
        return Err("Destination exists; explicit overwrite=true is required.".into());
    }
    let current = explicit.or(files.current.lock().map_err(|e| e.to_string())?.clone());
    let path = match current {
        Some(path) => Some(path),
        None => rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .add_filter("Negareh project", &["negareh"])
            .set_file_name("Untitled.negareh")
            .save_file()
            .await
            .map(|f| f.path().to_path_buf()),
    };
    let Some(mut path) = path else {
        return Ok(None);
    };
    if path.extension().is_none() {
        path.set_extension("negareh");
    }
    if path.extension().and_then(|s| s.to_str()) != Some("negareh") {
        return Err("Save with the .negareh extension.".into());
    }
    write(&path, &project)?;
    *files.current.lock().map_err(|e| e.to_string())? = Some(path.clone());
    write(
        &directory(&app)?.join("history.json"),
        &History {
            recent: Some(path.clone()),
        },
    )?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
#[tauri::command]
pub fn project_recovery(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    files: tauri::State<'_, Files>,
    project: Option<Project>,
    restore: bool,
) -> Result<Option<Session>, String> {
    main_only(&window)?;
    let path = directory(&app)?.join("recovery.json");
    if restore {
        let session: Session = read(&path)?;
        session.project.validate()?;
        // Recover into an unsaved copy; the original is never overwritten implicitly.
        *files.current.lock().map_err(|e| e.to_string())? = None;
        return Ok(Some(Session {
            project: session.project,
            path: None,
        }));
    }
    if let Some(project) = project {
        project.validate_for_write()?;
        write(
            &path,
            &Session {
                project,
                path: None,
            },
        )?;
    }
    Ok(None)
}
#[tauri::command]
pub fn project_reset(
    window: tauri::WebviewWindow,
    files: tauri::State<'_, Files>,
) -> Result<(), String> {
    main_only(&window)?;
    *files.current.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn character_studio_roundtrip_validation_and_legacy_defaults() {
        let original = serde_json::json!({"id":"character-mira", "portrait":"", "name":"Mira", "middleName":"", "familyName":"", "aliases":[], "birth":"", "death":""});
        let mut peer = original.clone();
        peer["id"] = serde_json::json!("character-ilen");
        peer["name"] = serde_json::json!("Ilen");
        let mut project: Project = serde_json::from_value(serde_json::json!({"version":1, "name":"Studio", "notes":"", "characters":[original, peer]})).unwrap();
        assert!(project.characters[0].values.connections.is_empty());
        let note = CharacterReference {
            id: "reference-note".into(),
            image: "".into(),
            caption: "Home".into(),
            kind: "note".into(),
            note: "A place to return".into(),
            category: "personality".into(),
            x: Some(0.2),
            y: Some(0.4),
            rotation: Some(-12.0),
            pin_color: "#ea5145".into(),
            links: vec!["reference-side".into()],
            ..Default::default()
        };
        let study = CharacterReference {
            id: "reference-side".into(),
            image: "data:image/webp;base64,AAAA".into(),
            caption: "Side".into(),
            view: "side".into(),
            category: "appearance".into(),
            ..Default::default()
        };
        project.characters[0].values.references = vec![note.clone(), study];
        project.characters[0].values.connections = vec![CharacterConnection {
            id: "connection-brother".into(),
            target: "character-ilen".into(),
            label: "Brother".into(),
            bond: "Shared childhood".into(),
            tension: "Distance".into(),
            context: "Warmer in private".into(),
        }];
        assert!(project.validate_for_write().is_ok());
        let bytes = serde_json::to_vec(&project).unwrap();
        let restored: Project = serde_json::from_slice(&bytes).unwrap();
        assert!(restored.validate().is_ok());
        assert_eq!(bytes, serde_json::to_vec(&restored).unwrap());
        assert_eq!(
            restored.characters[0].values.references[0].rotation,
            Some(-12.0)
        );
        assert_eq!(
            restored.characters[0].values.references[0].links,
            vec!["reference-side"]
        );
        for targets in [
            vec!["reference-note"],
            vec!["reference-missing"],
            vec!["reference-side", "reference-side"],
        ] {
            project.characters[0].values.references[0].links =
                targets.into_iter().map(String::from).collect();
            assert!(project.validate().is_err());
        }
        project.characters[0].values.references[0] = note.clone();
        assert_eq!(
            restored.characters[0].values.references[0].pin_color,
            "#ea5145"
        );
        assert_eq!(
            serde_json::to_value(&restored.characters[0].values.references[0]).unwrap()["pinColor"],
            "#ea5145"
        );
        project.characters[0].values.references[0].pin_color = "#invalid".into();
        assert!(project.validate().is_err());
        project.characters[0].values.references[0] = note.clone();
        project.characters[0].values.references[0].rotation = Some(181.0);
        assert!(project.validate().is_err());
        project.characters[0].values.references[0] = note.clone();
        project.characters[0].values.references[0].x = Some(-0.1);
        assert!(project.validate().is_err());
        project.characters[0].values.references[0] = note.clone();
        project.characters[0].values.references[0].category = "unknown".into();
        assert!(project.validate().is_err());
        project.characters[0].values.references[0] = note.clone();
        project.characters[0].values.connections[0].target = "character-missing".into();
        assert!(project.validate().is_err());
        project.characters[0].values.connections[0].target = "character-mira".into();
        assert!(project.validate().is_err());
        project.characters[0].values.connections[0].target = "character-ilen".into();
        let connection = project.characters[0].values.connections[0].clone();
        project.characters[0]
            .values
            .connections
            .push(connection.clone());
        assert!(project.validate().is_err());
        project.characters[0].values.connections.pop();
        project.characters[0].shared_values.insert("connections".into(), serde_json::json!([{"id":"connection-shared", "target":"character-missing", "label":"", "bond":"", "tension":"", "context":""}]));
        assert!(project.validate().is_err());
        project.characters[0].shared_values.clear();
        project.characters[0].values.references = (0..51)
            .map(|index| CharacterReference {
                id: format!("reference-{index}"),
                links: Vec::new(),
                ..note.clone()
            })
            .collect();
        assert!(project.validate().is_err());
        project.characters[0].values.references.pop();
        assert!(project.validate().is_ok());
    }
    #[test]
    fn validates_and_roundtrips_characters() {
        let mut project: Project = serde_json::from_value(serde_json::json!({
            "version": 1, "name": "Characters", "notes": "", "characters": [{
                "id": "character-example", "portrait": "data:image/webp;base64,UklGRg==", "name": "Mira", "familyName": "Vale", "middleName": "Elin", "aliases": ["The Wanderer"], "birth": "Year 128", "death": "Year 207"
            }]
        })).unwrap();
        assert!(project.validate_for_write().is_ok());
        let restored: Project =
            serde_json::from_slice(&serde_json::to_vec(&project).unwrap()).unwrap();
        assert_eq!(restored.characters[0].values.family_name, "Vale");
        assert_eq!(restored.characters[0].values.aliases, ["The Wanderer"]);
        assert_eq!(restored.characters[0].values.birth, "Year 128");
        assert_eq!(restored.characters[0].values.death, "Year 207");
        assert_eq!(
            restored.characters[0].values.portrait,
            project.characters[0].values.portrait
        );
        project.characters.push(project.characters[0].clone());
        assert!(project.validate().is_err());
        project.characters.pop();
        project.characters[0].values.portrait = "data:text/html,invalid".into();
        assert!(project.validate().is_err());
        project.characters[0].values.portrait.clear();
        project.characters[0].values.name.clear();
        assert!(project.validate().is_err());
    }
    #[test]
    fn character_sheet_defaults_validation_and_roundtrip() {
        let mut project: Project = serde_json::from_value(serde_json::json!({
            "version": 1, "name": "Legacy", "notes": "", "characters": [{
                "id": "character-legacy", "portrait": "", "name": "Mira", "familyName": "Vale", "middleName": "Elin", "aliases": ["M"], "birth": "Before dawn", "death": ""
            }]
        })).unwrap();
        let character = &mut project.characters[0];
        assert!(
            character.values.age.is_empty()
                && character.values.tags.is_empty()
                && character.values.categories.is_empty()
        );
        character.values.age = "Young adult".into();
        character.values.tags = vec!["Scholar".into(), "Traveler".into()];
        character.values.categories = vec![CharacterCategory {
            id: "essence".into(),
            traits: vec![CharacterTrait {
                id: "want".into(),
                value: "Find home\nKeep a promise".into(),
            }],
        }];
        assert!(project.validate_for_write().is_ok());
        let serialized = serde_json::to_value(&project).unwrap();
        let restored: Project = serde_json::from_value(serialized.clone()).unwrap();
        assert_eq!(serde_json::to_value(restored).unwrap(), serialized);
        assert_eq!(serialized["characters"][0]["birth"], "Before dawn");
        let original = project.characters[0].clone();
        project.characters[0].values.tags = vec!["Tag".into(); 4];
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0].values.tags.push("  ".into());
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0]
            .values
            .categories
            .push(original.values.categories[0].clone());
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0].values.categories[0]
            .traits
            .push(original.values.categories[0].traits[0].clone());
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0].values.categories[0].traits[0].id = "hair".into();
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0].values.categories[0].id = "custom".into();
        assert!(project.validate().is_err());
        project.characters[0] = original.clone();
        project.characters[0].values.categories[0].traits[0].value = "😀".repeat(5001);
        assert!(project.validate().is_err());
        project.characters[0] = original;
        project.characters[0].values.age = "a".repeat(81);
        assert!(project.validate().is_err());
    }
    #[test]
    fn character_instances_validation_and_roundtrip() {
        let legacy = serde_json::json!({"id":"character-old", "name":"Mira", "portrait":"", "middleName":"Elin", "familyName":"Vale", "aliases":["M"], "birth":"Before dawn", "death":""});
        let mut character: Character = serde_json::from_value(legacy.clone()).unwrap();
        assert!(character.instances.is_none());
        character.instances = Some(vec![
            CharacterInstance {
                id: "instance-one".into(),
                label: "Initial".into(),
                values: character.values.clone(),
            },
            CharacterInstance {
                id: "instance-two".into(),
                label: "Changed".into(),
                values: character.values.clone(),
            },
        ]);
        character.primary_instance = Some("instance-one".into());
        character
            .shared_values
            .insert("name".into(), serde_json::json!("Mira"));
        character
            .shared_values
            .insert("essence/want".into(), serde_json::json!("Find home"));
        let mut project = Project {
            version: 1,
            name: "Instances".into(),
            notes: String::new(),
            timelines: vec![],
            characters: vec![character.clone()],
            workspace: None,
        };
        assert!(project.validate_for_write().is_ok());
        let bytes = serde_json::to_vec(&project).unwrap();
        let restored: Project = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(bytes, serde_json::to_vec(&restored).unwrap());
        project.characters[0].primary_instance = Some("instance-missing".into());
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0]
            .shared_values
            .insert("unknown".into(), serde_json::json!("bad"));
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0]
            .shared_values
            .insert("tags".into(), serde_json::json!(["1", "2", "3", "4"]));
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0]
            .shared_values
            .insert("essence/hair".into(), serde_json::json!("bad"));
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0].instances.as_mut().unwrap()[1].id = "instance-one".into();
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0].instances.as_mut().unwrap()[1].label = "Initial".into();
        assert!(project.validate().is_err());
        project.characters[0] = character.clone();
        project.characters[0].instances = Some(vec![]);
        assert!(project.validate().is_err());
        project.characters[0] = character;
        project.characters[0].instances.as_mut().unwrap()[1]
            .values
            .name
            .clear();
        assert!(project.validate().is_err());
        let mut unknown = legacy;
        unknown["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<Character>(unknown).is_err());
        let mut unknown = serde_json::to_value(&restored.characters[0]).unwrap();
        unknown["instances"][0]["values"]["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<Character>(unknown).is_err());
    }
    #[test]
    fn character_header_media_validation_and_legacy_defaults() {
        let mut character: Character = serde_json::from_value(serde_json::json!({"id":"character-media","name":"Mira","middleName":"","familyName":"Vale","portrait":"","aliases":[],"birth":"","death":""})).unwrap();
        assert!(
            character.values.references.is_empty()
                && character.values.birthplace_image.is_empty()
                && character.values.role_summary.is_empty()
                && character.values.quote.is_empty()
        );
        character.values.role_summary = "Protagonist · mapmaker".into();
        character.values.quote = "Every road leads somewhere.".into();
        character.values.birthplace_image = "data:image/webp;base64,AAAA".into();
        character.values.references = vec![CharacterReference {
            id: "reference-one".into(),
            image: "data:image/png;base64,AAAA".into(),
            caption: "At home".into(),
            ..Default::default()
        }];
        let catalogue: Vec<CategoryDefinition> =
            serde_json::from_str(include_str!("../../src/character-catalogue.json")).unwrap();
        assert!(!invalid_character_values(&character.values, &catalogue));
        let bytes = serde_json::to_vec(&character).unwrap();
        assert_eq!(
            bytes,
            serde_json::to_vec(&serde_json::from_slice::<Character>(&bytes).unwrap()).unwrap()
        );
        assert!(valid_shared_value(
            "references",
            &serde_json::to_value(&character.values.references).unwrap(),
            &catalogue
        ));
        character
            .values
            .references
            .push(character.values.references[0].clone());
        assert!(invalid_character_values(&character.values, &catalogue));
        character.values.references.pop();
        character.values.references[0].image = "data:text/html,bad".into();
        assert!(invalid_character_values(&character.values, &catalogue));
        character.values.references.clear();
        character.values.quote = "x".repeat(1001);
        assert!(invalid_character_values(&character.values, &catalogue));
        assert!(!valid_shared_value(
            "birthplaceImage",
            &serde_json::json!("javascript:bad"),
            &catalogue
        ));
    }
    #[test]
    fn validates_version_and_limits() {
        let mut project = Project {
            version: 1,
            name: "Untitled".into(),
            notes: String::new(),
            timelines: Vec::new(),
            characters: Vec::new(),
            workspace: None,
        };
        assert!(project.validate().is_ok());
        let legacy: Project =
            serde_json::from_str(r#"{"version":1,"name":"Legacy","notes":"intact"}"#).unwrap();
        assert!(legacy.workspace.is_none());
        assert!(legacy.timelines.is_empty());
        assert!(legacy.characters.is_empty());
        assert!(legacy.validate_for_write().is_ok());
        project.timelines.push(Timeline {
            id: "timeline-example".into(),
            name: "Main history".into(),
        });
        let restored: Project =
            serde_json::from_value(serde_json::to_value(&project).unwrap()).unwrap();
        assert_eq!(restored.timelines[0].name, "Main history");
        project.timelines.push(project.timelines[0].clone());
        assert!(project.validate().is_err());
        project.timelines.pop();
        project.workspace =
            Some(serde_json::json!({"version":1,"tabs":[],"activeTab":null,"nodes":[]}));
        assert_eq!(
            serde_json::to_value(&project).unwrap()["workspace"]["version"],
            1
        );
        project.version = 2;
        assert!(project.validate().is_err());
        project.version = 1;
        project.name.clear();
        assert!(project.validate().is_err());
        project.name = "نور🎨".repeat(40);
        project.notes = "王".repeat(1_000_000);
        assert!(project.validate().is_ok());
        project.name.push('J');
        assert!(project.validate().is_err());
        project.name = "J".into();
        project.notes.push('王');
        assert!(project.validate().is_err());
    }
    #[test]
    fn replaces_snapshot_and_rejects_invalid_files() {
        let directory =
            std::env::temp_dir().join(format!("negareh-project-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("test.negareh");
        let mut project = Project {
            version: 1,
            name: "First".into(),
            notes: String::new(),
            timelines: Vec::new(),
            characters: Vec::new(),
            workspace: None,
        };
        write(&path, &project).unwrap();
        project.name = "Second".into();
        write(&path, &project).unwrap();
        assert_eq!(read::<Project>(&path).unwrap().name, "Second");
        fs::write(
            &path,
            br#"{"version":1,"name":"Bad","notes":"","unknown":true}"#,
        )
        .unwrap();
        assert!(read::<Project>(&path).is_err());
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
