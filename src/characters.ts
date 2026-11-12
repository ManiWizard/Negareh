// Owns canonical character instances, field scopes, validation and atomic edits.
import catalogue from './character-catalogue.json' with { type: 'json' };
export interface CharacterCategory { id: string; traits: { id: string; value: string }[] }
export interface CharacterReference { id: string; image: string; caption: string; kind?: 'image' | 'note'; note?: string; category?: string; view?: 'front' | 'side' | 'back'; x?: number; y?: number; rotation?: number; pinColor?: string; links?: string[] }
export function pruneReferenceLinks(references: CharacterReference[]): CharacterReference[] {
  const ids = new Set(references.map(reference => reference.id));
  return references.map(reference => reference.links ? { ...reference, links: reference.links.filter(target => ids.has(target)) } : reference);
}
export interface CharacterConnection { id: string; target: string; label: string; bond: string; tension: string; context: string }
export interface CharacterValues { roleSummary: string; quote: string; birthplaceImage: string; references: CharacterReference[]; connections: CharacterConnection[]; portrait: string; name: string; familyName: string; middleName: string; aliases: string[]; birth: string; death: string; age: string; tags: string[]; categories: CharacterCategory[] }
export interface CharacterInstance { id: string; label: string; values: CharacterValues }
export type CharacterFieldValue = string | string[] | CharacterReference[] | CharacterConnection[];
export interface Character extends CharacterValues { id: string; instances?: CharacterInstance[]; primaryInstance?: string; sharedValues?: Record<string, CharacterFieldValue> }
export const characterFields = [
  { id: 'name', title: 'Name' }, { id: 'middleName', title: 'Middle name' }, { id: 'familyName', title: 'Family name' }, { id: 'aliases', title: 'Aliases' }, { id: 'age', title: 'Age / life stage' }, { id: 'birth', title: 'Birth time' }, { id: 'death', title: 'Death time' }, { id: 'portrait', title: 'Portrait' }, { id: 'tags', title: 'Tags' },
  { id: 'roleSummary', title: 'Role summary' }, { id: 'quote', title: 'Character quote' }, { id: 'birthplaceImage', title: 'Birthplace background' }, { id: 'references', title: 'References & notes' }, { id: 'connections', title: 'Relationship connections' },
  ...catalogue.flatMap(category => category.traits.map(trait => ({ id: `${category.id}/${trait.id}`, title: `${category.title}: ${trait.title}` }))),
];
export type CharacterChange =
  | { type: 'field'; instance: string; field: string; value: CharacterFieldValue }
  | { type: 'categories'; instance: string; categories: CharacterCategory[] }
  | { type: 'configure'; source: string; sharedFields: string[]; create?: { label: string; copyFields: string[]; categories: CharacterCategory[] } }
  | { type: 'rename'; instance: string; label: string }
  | { type: 'delete'; instance: string };
export class CharacterError extends Error { field: string; constructor(field: string, message: string) { super(message); this.field = field; } }
export const emptyCharacterValues = (): CharacterValues => ({ roleSummary: '', quote: '', birthplaceImage: '', references: [], connections: [], portrait: '', name: 'Unnamed', middleName: '', familyName: '', aliases: [], birth: '', death: '', age: '', tags: [], categories: [] });
export function characterInstances(character: Character): CharacterInstance[] {
  return character.instances ?? [{ id: 'instance-initial', label: 'Initial', values: { roleSummary: character.roleSummary, quote: character.quote, birthplaceImage: character.birthplaceImage, references: character.references, connections: character.connections, portrait: character.portrait, name: character.name, familyName: character.familyName, middleName: character.middleName, aliases: character.aliases, birth: character.birth, death: character.death, age: character.age, tags: character.tags, categories: character.categories } }];
}
export function characterInstance(character: Character, id?: string): CharacterInstance {
  const instances = characterInstances(character), instance = instances.find(item => item.id === id) ?? instances.find(item => item.id === character.primaryInstance) ?? instances[0];
  if (!instance) throw new Error('Character has no instances.'); return instance;
}
export function fieldValue(values: CharacterValues, field: string): CharacterFieldValue {
  if (field.includes('/')) { const [category, trait] = field.split('/'); return values.categories.find(item => item.id === category)?.traits.find(item => item.id === trait)?.value ?? ''; }
  if (field === 'aliases' || field === 'tags' || field === 'references' || field === 'connections') return values[field];
  if (['name', 'middleName', 'familyName', 'age', 'birth', 'death', 'portrait', 'roleSummary', 'quote', 'birthplaceImage'].includes(field)) return values[field as 'name'];
  throw new CharacterError(field, 'Unknown character field.');
}
function setValue(values: CharacterValues, field: string, value: CharacterFieldValue): void {
  if (field.includes('/')) { const [category, trait] = field.split('/'), entry = values.categories.find(item => item.id === category)?.traits.find(item => item.id === trait); if (entry && typeof value === 'string') entry.value = value; return; }
  if (field === 'connections' && Array.isArray(value) && value.every((item): item is CharacterConnection => typeof item !== 'string' && 'target' in item)) { values.connections = structuredClone(value); return; }
  if (field === 'references' && Array.isArray(value) && value.every((item): item is CharacterReference => typeof item !== 'string' && 'image' in item)) { values.references = structuredClone(value); return; }
  if ((field === 'aliases' || field === 'tags') && Array.isArray(value) && value.every(item => typeof item === 'string')) { values[field] = [...value]; return; }
  if (typeof value === 'string' && ['name', 'middleName', 'familyName', 'age', 'birth', 'death', 'portrait', 'roleSummary', 'quote', 'birthplaceImage'].includes(field)) { values[field as 'name'] = value; return; }
  throw new CharacterError(field, 'Invalid field value.');
}
export function instanceValues(character: Character, id?: string): CharacterValues {
  const result = structuredClone(characterInstance(character, id).values);
  for (const [field, value] of Object.entries(character.sharedValues ?? {})) setValue(result, field, value);
  return result;
}
function validImage(value: string): boolean { return value.length <= 1_000_000 && (!value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)); }
export function validateField(field: string, value: CharacterFieldValue): void {
  if (!characterFields.some(item => item.id === field)) throw new CharacterError(field, 'Unknown character field.');
  if (field === 'connections') {
    const ids = new Set<string>(), targets = new Set<string>();
    if (!Array.isArray(value) || value.length > 24 || value.some(item => {
      if (typeof item === 'string' || !('target' in item) || !/^connection-[A-Za-z0-9-]+$/.test(item.id) || item.id.length > 80 || ids.has(item.id) || !/^character-[A-Za-z0-9-]+$/.test(item.target) || item.target.length > 80 || targets.has(item.target) || item.label.length > 80 || [item.bond, item.tension, item.context].some(text => text.length > 10_000)) return true;
      ids.add(item.id); targets.add(item.target); return false;
    })) throw new CharacterError(field, 'Use up to 24 unique character connections with a label within 80 characters and notes within 10,000 characters.');
    return;
  }
  if (field === 'references') {
    const ids = new Set<string>();
    if (!Array.isArray(value) || value.length > 62 || value.filter(item => typeof item !== 'string' && 'image' in item && item.kind !== 'note').length > 12 || value.filter(item => typeof item !== 'string' && 'image' in item && item.kind === 'note').length > 50 || value.some(item => {
      if (typeof item === 'string' || !('image' in item) || !/^reference-[A-Za-z0-9-]+$/.test(item.id) || item.id.length > 80 || ids.has(item.id) || item.caption.length > 200 || (item.kind !== undefined && !['image', 'note'].includes(item.kind)) || (item.kind === 'note' ? Boolean(item.image) : !item.image) || !validImage(item.image) || (item.note?.length ?? 0) > 10_000 || (item.category !== undefined && item.category !== '' && !catalogue.some(category => category.id === item.category)) || (item.view !== undefined && !['front', 'side', 'back'].includes(item.view)) || [item.x, item.y].some(position => position !== undefined && (!Number.isFinite(position) || position < 0 || position > 1))) return true;
      if (item.rotation !== undefined && (!Number.isFinite(item.rotation) || item.rotation < -180 || item.rotation > 180)) return true;
      if (item.pinColor !== undefined && !/^#[0-9a-f]{6}$/i.test(item.pinColor)) return true;
      if (item.links !== undefined && (!Array.isArray(item.links) || item.links.length > 61 || new Set(item.links).size !== item.links.length || item.links.some(target => target === item.id || !value.some(other => typeof other !== 'string' && 'image' in other && other.id === target)))) return true;
      ids.add(item.id); return false;
    })) throw new CharacterError(field, 'Use up to 12 images and 50 notes, valid board positions, rotation between −180° and 180°, and captions within 200 characters.');
    return;
  }
  if (field === 'tags' || field === 'aliases') {
    const limit = field === 'tags' ? 3 : 50;
    if (!Array.isArray(value) || value.length > limit || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 80)) throw new CharacterError(field, `Use up to ${String(limit)} ${field}, each within 80 characters.`);
    return;
  }
  if (typeof value !== 'string') throw new CharacterError(field, 'Enter text for this field.');
  if (field === 'portrait' || field === 'birthplaceImage') {
    if (!validImage(value)) throw new CharacterError(field, 'Choose a valid PNG, JPEG, or WebP portrait.'); return;
  }
  const limit = field.includes('/') ? 10_000 : field === 'quote' ? 1000 : field === 'roleSummary' ? 160 : 80;
  if (value.length > limit || (field === 'name' && !value.trim())) throw new CharacterError(field, field === 'name' ? 'Enter a name within 80 characters.' : `Keep this value within ${String(limit)} characters.`);
}
function validateValues(values: CharacterValues): void {
  for (const field of characterFields.filter(item => !item.id.includes('/'))) validateField(field.id, fieldValue(values, field.id));
  const seen = new Set<string>();
  for (const category of values.categories) {
    const definition = catalogue.find(item => item.id === category.id);
    if (!definition || seen.has(category.id)) throw new CharacterError('categories', 'Choose each category once from the catalogue.'); seen.add(category.id);
    const traits = new Set<string>();
    for (const trait of category.traits) {
      if (!definition.traits.some(item => item.id === trait.id) || traits.has(trait.id)) throw new CharacterError('categories', 'Choose each trait once from its category.');
      traits.add(trait.id); validateField(`${category.id}/${trait.id}`, trait.value);
    }
  }
}
export function validateCharacter(character: Character): void {
  validateValues(character);
  if (!/^character-[A-Za-z0-9-]+$/.test(character.id) || character.id.length > 80) throw new Error('Invalid character ID.');
  const instances = characterInstances(character);
  if (!instances.length || instances.length > 1000) throw new Error('Use between one and 1,000 instances.');
  const ids = new Set<string>(), labels = new Set<string>();
  for (const instance of instances) {
    if (!/^instance-[A-Za-z0-9-]+$/.test(instance.id) || instance.id.length > 80 || ids.has(instance.id)) throw new Error('Invalid or duplicate instance ID.'); ids.add(instance.id);
    if (!instance.label.trim() || instance.label.length > 80 || labels.has(instance.label.trim())) throw new CharacterError('label', 'Use a unique instance label within 80 characters.'); labels.add(instance.label.trim()); validateValues(instance.values);
  }
  for (const instance of instances) if (instance.values.connections.some(connection => connection.target === character.id)) throw new Error('Connect this character to another character.');
  if (character.instances && !ids.has(character.primaryInstance ?? '')) throw new Error('The primary instance is unavailable.');
  for (const [field, value] of Object.entries(character.sharedValues ?? {})) validateField(field, value);
  const sharedConnections = character.sharedValues?.connections;
  if (Array.isArray(sharedConnections) && sharedConnections.some(connection => typeof connection !== 'string' && 'target' in connection && connection.target === character.id)) throw new Error('Connect this character to another character.');
}
export function newCharacter(): Character {
  const values = emptyCharacterValues(), instance = { id: `instance-${crypto.randomUUID()}`, label: 'Initial', values: structuredClone(values) };
  return { id: `character-${crypto.randomUUID()}`, ...values, primaryInstance: instance.id, instances: [instance], sharedValues: {} };
}
export function sharingConflicts(character: Character, source: string, sharedFields: string[]): { field: string; instances: string[] }[] {
  const values = instanceValues(character, source);
  return sharedFields.filter(field => !(field in (character.sharedValues ?? {}))).map(field => ({ field, instances: characterInstances(character).filter(instance => JSON.stringify(fieldValue(instanceValues(character, instance.id), field)) !== JSON.stringify(fieldValue(values, field))).map(instance => instance.label) })).filter(item => item.instances.length);
}
export function changeCharacter(original: Character, change: CharacterChange): Character {
  const character = structuredClone(original); character.instances = structuredClone(characterInstances(original)); character.primaryInstance ??= character.instances[0]?.id ?? ''; character.sharedValues ??= {};
  const instances = character.instances;
  if ('instance' in change && !instances.some(item => item.id === change.instance)) throw new Error('The instance is unavailable.');
  if (change.type === 'field') {
    validateField(change.field, change.value);
    if (change.field in character.sharedValues) character.sharedValues[change.field] = structuredClone(change.value);
    else setValue(characterInstance(character, change.instance).values, change.field, change.value);
  }
  if (change.type === 'categories') characterInstance(character, change.instance).values.categories = structuredClone(change.categories);
  if (change.type === 'rename') characterInstance(character, change.instance).label = change.label.trim();
  if (change.type === 'delete') {
    if (instances.length === 1) throw new Error('Keep at least one instance.');
    character.instances = instances.filter(item => item.id !== change.instance);
    if (character.primaryInstance === change.instance) character.primaryInstance = character.instances[0]?.id ?? '';
  }
  if (change.type === 'configure') {
    if (!instances.some(item => item.id === change.source)) throw new Error('The source instance is unavailable.');
    const source = instanceValues(character, change.source);
    if (new Set(change.sharedFields).size !== change.sharedFields.length) throw new Error('Duplicate shared fields.');
    for (const [field, value] of Object.entries(character.sharedValues)) {
      if (change.sharedFields.includes(field)) continue;
      for (const instance of instances) setValue(instance.values, field, value);
      character.sharedValues = Object.fromEntries(Object.entries(character.sharedValues).filter(([key]) => key !== field));
    }
    for (const field of change.sharedFields) { validateField(field, fieldValue(source, field)); character.sharedValues[field] = structuredClone(fieldValue(source, field)); }
    if (change.create) {
      const values = emptyCharacterValues(); values.categories = structuredClone(change.create.categories);
      for (const field of change.create.copyFields) { validateField(field, fieldValue(source, field)); setValue(values, field, fieldValue(source, field)); }
      instances.push({ id: `instance-${crypto.randomUUID()}`, label: change.create.label.trim(), values });
    }
  }
  Object.assign(character, instanceValues(character, character.primaryInstance)); validateCharacter(character); return character;
}
