// Owns the retained character dossier, instance dialogs and scoped editors.
import { mountCharacterStudio } from './character-studio';
import catalogue from './character-catalogue.json';
import { characterFields, characterInstance, characterInstances, instanceValues, fieldValue, sharingConflicts, validateField, pruneReferenceLinks, CharacterError } from './characters';
import type { Character, CharacterChange, CharacterValues, CharacterCategory, CharacterFieldValue, CharacterReference } from './characters';
import { icon, icons } from './surfaces';
import type { SurfaceContext, SurfaceHandle } from './surfaces';
const categorySections: Record<string, { title: string; description: string; traits: string[]; compact?: boolean }[]> = {
  essence: [
    { title: 'The character in a few words', description: 'A starting point, not a complete explanation of a person.', traits: ['story-role', 'one-line-description'] },
    { title: 'What matters right now', description: 'Wants, needs, and stakes can conflict or change with the situation.', traits: ['want', 'need', 'greatest-fear', 'personal-stakes'] },
    { title: 'The private side', description: 'What is hidden, and how they understand themselves.', traits: ['secret', 'self-image'] },
  ],
  appearance: [
    { title: 'At a glance', description: 'Recognizable details. Use a few words or as much detail as you need.', traits: ['build', 'hair', 'eyes', 'voice'], compact: true },
    { title: 'How they present themselves', description: 'Consider the occasion, company, or place.', traits: ['clothing', 'posture'] },
    { title: 'Details that stay with you', description: 'A distinguishing feature or something they carry.', traits: ['distinctive-features', 'signature-possessions'] },
  ],
  personality: [
    { title: 'Patterns, not rules', description: 'Describe what tends to happen, when it happens, and the exceptions.', traits: ['temperament', 'strengths', 'flaws'] },
    { title: 'In different situations', description: 'People act differently depending on who they are with and what is at stake.', traits: ['social-behavior', 'stress-response', 'contradictions'] },
    { title: 'What guides their choices', description: 'Beliefs and decisions do not always line up. Leave room for that.', traits: ['principles', 'decision-making-style'] },
  ],
  history: [
    { title: 'What brought them here', description: 'Keep the experiences that matter to this version of the character.', traits: ['origin', 'childhood', 'formative-event', 'proudest-achievement', 'regret'] },
    { title: 'Where they are headed', description: 'Possibilities and intentions, rather than a predetermined outcome.', traits: ['current-goal', 'current-arc', 'desired-change'] },
  ],
  relationships: [
    { title: 'Close connections', description: 'Who is involved, what connects them, and how each person sees the relationship.', traits: ['family', 'friends', 'romantic-bonds'] },
    { title: 'Support & influence', description: 'Describe the people and the give-and-take between them.', traits: ['allies', 'mentors'] },
    { title: 'Tension & commitments', description: 'Relationships can overlap, change, or mean different things to each person.', traits: ['rivals', 'enemies', 'obligations'] },
  ],
  body: [
    { title: 'Physical details', description: 'Use whatever units or descriptions fit the character.', traits: ['height', 'weight', 'handedness'], compact: true },
    { title: 'Current wellbeing', description: 'Consider daily experience, support, and changes over time.', traits: ['general-health', 'fitness', 'disabilities-limitations'] },
    { title: 'What their body has lived through', description: 'Record only the history and marks that matter here.', traits: ['scars-marks', 'medical-history'] },
  ],
  life: [
    { title: 'Everyday circumstances', description: 'The setting and practical details of this life.', traits: ['occupation', 'education', 'home', 'resources'], compact: true },
    { title: 'Rhythms & interests', description: 'Typical days, preferences, and exceptions. No one follows a routine perfectly.', traits: ['daily-routine', 'hobbies', 'likes', 'dislikes'] },
  ],
};
const writingPrompts: Record<string, string> = {
  want: 'What do they want at this point in their life?', need: 'What might help them, even if they do not recognize it?', secret: 'What do they keep to themselves, and from whom?', 'greatest-fear': 'What frightens them most? When does that fear surface?', 'personal-stakes': 'What could they lose, and why does it matter?', 'one-line-description': 'What would you say first when introducing them?', 'self-image': 'How do they see themselves? Where might others disagree?', 'story-role': 'Their part in the story, if useful…',
  strengths: 'What comes more easily to them? In what situations?', flaws: 'Where do they struggle? What makes it harder or easier?', temperament: 'What is their usual disposition, and what changes it?', 'social-behavior': 'How are they with strangers, friends, or people they trust?', 'stress-response': 'Under what pressure, and how might they respond?', principles: 'What matters to them? What could test those beliefs?', 'decision-making-style': 'How do they approach choices? Does it depend on the stakes?', contradictions: 'Which sides of them seem at odds, and when do they appear?',
  family: 'Who do they consider family? How do those connections feel?', friends: 'Who are they close to, and what is different with each person?', allies: 'Who supports them, and what does each person offer?', rivals: 'Who challenges them, and over what?', enemies: 'Who is in conflict with them? How does each side see it?', mentors: 'Who has shaped or guided them?', 'romantic-bonds': 'Who are they drawn or committed to? How does that connection work?', obligations: 'Who do they feel responsible to, and why?',
  'daily-routine': 'What does a typical day look like? What disrupts it?', hobbies: 'What do they do for interest or enjoyment, when they can?', likes: 'What do they enjoy? Does the mood or company matter?', dislikes: 'What puts them off, and in what circumstances?',
};
async function portraitData(file: File, edge = 512): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10_000_000) throw new Error('Choose a PNG, JPEG, or WebP portrait smaller than 10 MB.');
  const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result); else reject(new Error('Could not read the portrait.')); }; reader.onerror = () => { reject(new Error('Could not read the portrait.')); }; reader.readAsDataURL(file); });
  const image = new Image(); image.src = source; await image.decode();
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const drawing = canvas.getContext('2d'); if (!drawing) throw new Error('Could not prepare the portrait.'); drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/webp', .85); if (result.length > 1_000_000) throw new Error('The portrait is too large. Choose a smaller image.'); return result;
}
export function mountCharacter(host: HTMLElement, context: SurfaceContext): SurfaceHandle {
  const section = document.createElement('section'); section.className = 'application-surface character-surface'; section.dataset.surface = 'character'; section.setAttribute('aria-label', 'Character sheet'); host.append(section);

  const header = document.createElement('div'); header.className = 'character-hero';
  const backdrop = document.createElement('img'); backdrop.className = 'character-birthplace'; backdrop.alt = ''; backdrop.width = 1600; backdrop.height = 900; backdrop.setAttribute('aria-hidden', 'true');
  const heroCopy = document.createElement('div'); heroCopy.className = 'character-hero-copy';
  const heroTitle = document.createElement('h1');
  const referencesHost = document.createElement('div'); referencesHost.className = 'character-references';
  const referenceGrid = document.createElement('div'); referenceGrid.className = 'character-reference-grid';
  const backgroundUpload = document.createElement('input'); backgroundUpload.type = 'file'; backgroundUpload.accept = 'image/png,image/jpeg,image/webp'; backgroundUpload.hidden = true; backgroundUpload.setAttribute('aria-label', 'Birthplace background');
  const referenceUpload = document.createElement('input'); referenceUpload.type = 'file'; referenceUpload.accept = 'image/png,image/jpeg,image/webp'; referenceUpload.multiple = true; referenceUpload.hidden = true; referenceUpload.setAttribute('aria-label', 'Reference images');
  const workspace = document.createElement('div'); workspace.className = 'character-workspace';
  const navigation = document.createElement('nav'); navigation.className = 'character-category-nav'; navigation.setAttribute('aria-label', 'Character categories'); navigation.setAttribute('role', 'tablist');
  const panels = document.createElement('div'); panels.className = 'character-panels';
  const navigationHost = document.createElement('aside'); navigationHost.className = 'character-navigation';
  const sidebarIdentity = document.createElement('div'); sidebarIdentity.className = 'character-sidebar-identity'; navigationHost.append(sidebarIdentity, navigation);
  const board = document.createElement('section'); board.className = 'character-board-panel'; board.setAttribute('role', 'tabpanel'); board.id = `character-board-${crypto.randomUUID()}`;
  const relationships = document.createElement('section'); relationships.className = 'character-relationships';
  const studies = document.createElement('section'); studies.className = 'character-appearance-studies';

  const overview = document.createElement('section'); overview.className = 'character-overview'; overview.setAttribute('role', 'tabpanel');
  const identity = document.createElement('section'); identity.className = 'character-identity'; identity.setAttribute('role', 'tabpanel');
  const panelPrefix = `character-${crypto.randomUUID()}`; overview.id = `${panelPrefix}-overview`; identity.id = `${panelPrefix}-identity`; board.id = `${panelPrefix}-references`;
  const portrait = document.createElement('div'); portrait.className = 'character-portrait';
  const image = document.createElement('img'); image.alt = 'Character portrait'; image.width = 240; image.height = 320;
  const placeholder = document.createElement('span'); placeholder.className = 'portrait-placeholder'; placeholder.append(icon('M11 5a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM2 15v-2a6 6 0 0 1 12 0v2'), 'Portrait');
  const portraitShared = document.createElement('span'); portraitShared.className = 'portrait-shared character-shared'; portraitShared.textContent = 'Shared';
  const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.hidden = true; upload.setAttribute('aria-label', 'Portrait');
  const tags = document.createElement('div'); tags.className = 'character-tags';
  const aliasChips = document.createElement('div'); aliasChips.className = 'character-alias-chips'; aliasChips.setAttribute('aria-label', 'Also known as'); aliasChips.setAttribute('aria-live', 'polite');
  const fieldsHost = document.createElement('div'); fieldsHost.className = 'character-id';
  const categories = document.createElement('div'); categories.className = 'character-categories';
  const status = document.createElement('p'); status.className = 'surface-info'; status.setAttribute('role', 'status');
  const menu = document.createElement('div'); menu.className = 'menu deck-menu character-menu'; menu.popover = 'auto'; menu.setAttribute('aria-label', 'Character actions');
  const dialog = document.createElement('dialog'); dialog.className = 'character-dialog'; section.append(dialog);
  const editors = new Map<string, { input: HTMLInputElement | HTMLTextAreaElement; error: HTMLElement; read: HTMLElement; shared: HTMLElement }>();
  let commitOverview = (): boolean => true;
  let aliasSignature = '', selectedKey = '', structure = '', tagSignature = '', portraitRequest = 0, lastMode = '', sceneRequest = 0, referenceRequest = 0, gallerySignature = '', navSignature = '', overviewSignature = '', menuOwner: HTMLButtonElement | null = null, dialogOwner: HTMLElement | null = null;
  const selected = (): Character | undefined => context.project.read().characters.find(item => item.id === context.state.data.character);
  const editable = (): boolean => context.state.mode === 'edit' && !context.project.read().busy;
  const currentId = (): string => { const character = selected(); return character ? characterInstance(character, typeof context.state.data.instance === 'string' ? context.state.data.instance : undefined).id : ''; };
  const data = (): CharacterValues | undefined => { const character = selected(); return character ? instanceValues(character, currentId()) : undefined; };
  const fail = (error: unknown): void => { status.textContent = error instanceof Error ? error.message : 'Could not update the character.'; };
  const change = (operation: CharacterChange): boolean => {
    const character = selected(); if (!character || !editable()) return false;
    try { context.project.changeCharacter(character.id, operation); status.textContent = ''; return true; } catch (error) { fail(error); return false; }
  };
  const displayValue = (field: string, value: CharacterFieldValue): string => field === 'portrait' || field === 'birthplaceImage' ? value ? 'Image selected' : 'No image' : field === 'references' && Array.isArray(value) ? `${String(value.length)} reference items` : Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : 'caption' in item ? item.caption : item.label).join(', ') : value;
  const inputValue = (field: string, input: HTMLInputElement | HTMLTextAreaElement): CharacterFieldValue => field === 'aliases' ? [...new Set([...(data()?.aliases ?? []), ...input.value.split(',').map(alias => alias.trim()).filter(Boolean)])] : field === 'name' ? input.value.trim() || 'Unnamed' : input.value;
  const commitField = (field: string): boolean => {
    const editor = editors.get(field); if (!editor?.input.dataset.dirty) return true;
    try {
      const value = inputValue(field, editor.input); validateField(field, value);
      if (!change({ type: 'field', instance: currentId(), field, value })) return false;
      delete editor.input.dataset.dirty; editor.error.textContent = ''; editor.input.removeAttribute('aria-invalid'); editor.input.value = field === 'aliases' ? '' : displayValue(field, value); return true;
    } catch (error) { editor.error.textContent = error instanceof Error ? error.message : 'Check this value.'; editor.input.setAttribute('aria-invalid', 'true'); return false; }
  };
  const commit = (): boolean => { for (const field of editors.keys()) if (!commitField(field)) { editors.get(field)?.input.focus(); return false; } return commitOverview() && studio.commit(); };
  const control = (label: string, run: () => void, path?: string): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    if (path) button.append(icon(path)); else button.textContent = label; button.addEventListener('click', run); return button;
  };
  const closeMenu = (): void => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  const positionMenu = (): void => {
    if (!menuOwner) return; const rect = menuOwner.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
    menu.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8)))}px`; menu.style.top = `${String(Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - bounds.height - 8)))}px`;
  };
  const openMenu = (owner: HTMLButtonElement): boolean => { if (!commit()) return false; closeMenu(); menuOwner = owner; menu.replaceChildren(); menu.showPopover(); owner.setAttribute('aria-expanded', 'true'); return true; };
  const menuItems = (owner: HTMLButtonElement, entries: { label: string; run: () => void; disabled?: boolean }[]): void => {
    if (!openMenu(owner)) return;
    for (const entry of entries) { const button = control(entry.label, () => { closeMenu(); entry.run(); }); button.disabled = entry.disabled ?? false; menu.append(button); }
    positionMenu(); menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };
  menu.addEventListener('toggle', () => { if (!menu.matches(':popover-open')) menuOwner?.setAttribute('aria-expanded', 'false'); }, { signal: context.signal });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); menuOwner?.focus(); }
    if (event.target instanceof HTMLInputElement || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.findIndex(button => button === document.activeElement);
    event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }, { signal: context.signal });
  const closeDialog = (): void => { dialog.close(); dialogOwner?.focus({ preventScroll: true }); dialog.replaceChildren(); };
  const openDialog = (title: string, owner: HTMLElement): { form: HTMLFormElement; error: HTMLElement; actions: HTMLElement } | undefined => {
    if (!editable() || !commit()) return; closeMenu(); dialogOwner = owner; dialog.replaceChildren();
    const heading = document.createElement('h2'); heading.id = `character-dialog-${crypto.randomUUID()}`; heading.textContent = title; dialog.setAttribute('aria-labelledby', heading.id);
    const form = document.createElement('form'), error = document.createElement('p'), actions = document.createElement('div'); error.className = 'character-error'; error.setAttribute('role', 'alert'); error.tabIndex = -1; actions.className = 'character-dialog-actions'; actions.append(control('Cancel', closeDialog)); form.append(heading, error); dialog.append(form); dialog.showModal(); return { form, error, actions };
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); }, { signal: context.signal });
  const confirm = (title: string, owner: HTMLElement, text: string, run: () => void): void => {
    const content = openDialog(title, owner); if (!content) return; const description = document.createElement('p'); description.textContent = text;
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = title; content.actions.append(submit); content.form.append(description, content.actions);
    content.form.addEventListener('submit', event => { event.preventDefault(); closeDialog(); run(); }); content.actions.querySelector('button')?.focus();
  };
  const remove = (owner: HTMLButtonElement, written: boolean, label: string, run: () => void): void => { if (!commit()) return; if (written) confirm(label, owner, `${label} and its written content from this instance? Shared values remain available to other instances.`, run); else run(); };
  const makeEditor = (field: string, title: string, multiline: boolean, parent: HTMLElement): void => {
    const input = document.createElement(multiline ? 'textarea' : 'input'); input.setAttribute('aria-label', title); input.name = field; input.autocomplete = 'off'; input.dir = 'auto';
    if (input instanceof HTMLInputElement) { input.type = 'text'; input.maxLength = field === 'aliases' ? 4049 : field === 'roleSummary' ? 160 : 80; } else { input.rows = field === 'roleSummary' ? 1 : 2; input.maxLength = field === 'roleSummary' ? 160 : field === 'quote' ? 1000 : 10_000; }
    const error = document.createElement('span'), read = document.createElement('p'), shared = document.createElement('span'); error.id = `character-error-${crypto.randomUUID()}`; error.className = 'character-error'; error.setAttribute('role', 'alert'); input.setAttribute('aria-describedby', error.id); read.className = 'character-value'; read.dir = 'auto'; shared.className = 'character-shared'; shared.textContent = 'Shared';
    input.addEventListener('input', () => { input.dataset.dirty = 'true'; }); input.addEventListener('blur', () => { commitField(field); });
    input.addEventListener('keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing && (input instanceof HTMLInputElement || field === 'roleSummary')) { event.preventDefault(); if (commitField(field) && field !== 'aliases') input.blur(); } });
    editors.set(field, { input, error, read, shared }); parent.append(shared, input, read, error);
  };
  for (const field of characterFields.filter(field => !field.id.includes('/') && !['portrait', 'tags', 'birthplaceImage', 'references', 'roleSummary', 'quote', 'connections'].includes(field.id))) {
    const label = document.createElement(field.id === 'aliases' ? 'div' : 'label'), title = document.createElement('span'); title.textContent = field.id === 'aliases' ? 'Also known as' : field.title; label.append(title); if (field.id === 'aliases') label.className = 'character-aliases'; makeEditor(field.id, field.title, false, label);
    if (field.id === 'aliases') { const editor = editors.get('aliases'); if (editor) { editor.input.before(aliasChips); editor.input.maxLength = 4049; editor.input.setAttribute('placeholder', 'Add a nickname or another name, then press Enter…'); const help = document.createElement('small'); help.textContent = 'Nicknames, titles, pen names, and names used by different people.'; label.append(help); } }
    if (field.id === 'name' || field.id === 'age') { const heading = document.createElement('h3'); heading.className = 'character-identity-group'; heading.textContent = field.id === 'name' ? 'Names & recognition' : 'This life'; fieldsHost.append(heading); }
    fieldsHost.append(label);
  }
  const ancestryTitle = document.createElement('h3'); ancestryTitle.className = 'character-identity-group'; ancestryTitle.textContent = 'World & ancestry'; fieldsHost.append(ancestryTitle);
  for (const title of ['Species', 'Race']) {
    const label = document.createElement('label'), input = document.createElement('input'), help = document.createElement('small'); label.textContent = title; input.type = 'text'; input.disabled = true; input.value = 'Not available yet'; input.setAttribute('aria-label', title); help.textContent = 'Available when Species Designer is implemented.'; label.append(input, help); fieldsHost.append(label);
  }
  const revealCategory = (): void => {
    if (workspace.dataset.layout === 'vertical') return;
    const button = navigation.querySelector<HTMLElement>('[aria-selected="true"]'); if (!button) return;
    const bounds = navigation.getBoundingClientRect(), target = button.getBoundingClientRect();
    if (target.left < bounds.left) navigation.scrollLeft += target.left - bounds.left;
    else if (target.right > bounds.right) navigation.scrollLeft += target.right - bounds.right;
  };
  const navigationSize = new ResizeObserver(revealCategory); navigationSize.observe(navigation);
  const selectCategory = (id: string, focus = false): void => {
    if (!commit()) return; context.local(local => { local.category = id; }); revealCategory();
    if (focus) navigation.querySelector<HTMLButtonElement>(`[data-category="${id}"]`)?.focus({ preventScroll: true });
  };
  const heroName = control('Edit character name', () => { if (!editable()) return; selectCategory('identity'); editors.get('name')?.input.focus(); }); heroName.className = 'character-name'; heroTitle.append(heroName);
  heroCopy.append(heroTitle);
  const roleLabel = document.createElement('label'); roleLabel.className = 'character-hero-role'; makeEditor('roleSummary', 'Role summary', true, roleLabel); editors.get('roleSummary')?.input.setAttribute('placeholder', 'Add their role or calling…');
  const quoteLabel = document.createElement('label'); quoteLabel.className = 'character-hero-quote'; makeEditor('quote', 'Character quote', true, quoteLabel); editors.get('quote')?.input.setAttribute('placeholder', 'Give them a line of their own…'); heroCopy.append(roleLabel, quoteLabel, tags);
  const identityTitle = document.createElement('h2'); identityTitle.textContent = 'Identity'; const identityHelp = document.createElement('p'); identityHelp.className = 'surface-info'; identityHelp.textContent = 'The details of this life. Values can be local to this instance or shared with the character’s other instances.'; identity.append(identityTitle, identityHelp, fieldsHost);
  const lightbox = document.createElement('dialog'); lightbox.className = 'character-dialog character-media-viewer'; lightbox.setAttribute('aria-label', 'Reference image'); section.append(lightbox);
  let referenceOwner: HTMLElement | null = null;
  const closeLightbox = (): void => { lightbox.close(); lightbox.replaceChildren(); referenceOwner?.focus({ preventScroll: true }); };
  lightbox.addEventListener('cancel', event => { event.preventDefault(); closeLightbox(); }, { signal: context.signal });
  const viewReference = (reference: CharacterReference, owner: HTMLElement): void => {
    if (!commit()) return; referenceOwner = owner; lightbox.replaceChildren(); const image = document.createElement('img'); image.src = reference.image; image.alt = reference.caption || 'Character reference'; const caption = document.createElement('p'); caption.textContent = reference.caption; lightbox.append(control('Close reference', closeLightbox), image, caption); lightbox.showModal(); lightbox.querySelector('button')?.focus();
  };
  const configure = (creating: boolean, owner: HTMLElement): void => {
    const character = selected(); if (!character) return;
    const content = openDialog(creating ? 'New instance' : 'Manage sharing', owner); if (!content) return;
    const characterId = character.id, sourceSelect = document.createElement('select'), labelInput = document.createElement('input'); sourceSelect.setAttribute('aria-label', 'Source instance'); labelInput.setAttribute('aria-label', 'Instance label'); labelInput.maxLength = 80; labelInput.required = true;
    const instances = characterInstances(character); let number = instances.length + 1; while (instances.some(item => item.label === `Instance ${String(number)}`)) number++; labelInput.value = `Instance ${String(number)}`;
    for (const instance of instances) { const option = document.createElement('option'); option.value = instance.id; option.textContent = instance.label; sourceSelect.append(option); } sourceSelect.value = currentId();
    const label = document.createElement('label'); label.textContent = 'Instance label'; label.append(labelInput);
    const sourceLabel = document.createElement('label'); sourceLabel.textContent = 'Source instance'; sourceLabel.append(sourceSelect);
    if (creating) content.form.append(label, sourceLabel);
    const explanation = document.createElement('p'); explanation.textContent = 'Copied values are independent. Shared values stay linked across all instances. Changing scope also affects existing instances.'; content.form.append(explanation);
    const rowsHost = document.createElement('div'); rowsHost.className = 'instance-setup-fields'; content.form.append(rowsHost);
    const choices = new Map<string, { share: HTMLInputElement; copy: HTMLSelectElement; include: HTMLInputElement | undefined }>(), categoryChoices = new Map<string, HTMLInputElement>();
    const preview = document.createElement('div'); preview.className = 'sharing-preview'; preview.setAttribute('role', 'alert');
    const acknowledgment = document.createElement('input'); acknowledgment.type = 'checkbox'; acknowledgment.setAttribute('aria-label', 'Confirm replacement of differing values');
    const confirmLabel = document.createElement('label'); confirmLabel.className = 'character-check'; confirmLabel.append(acknowledgment, 'Replace the differing values listed above'); confirmLabel.hidden = true;
    const build = (): void => {
      const latest = selected(); if (!latest || latest.id !== characterId) { closeDialog(); return; }
      const source = instanceValues(latest, sourceSelect.value); rowsHost.replaceChildren(); choices.clear(); categoryChoices.clear(); acknowledgment.checked = false; preview.replaceChildren(); confirmLabel.hidden = true;
      const previewImage = document.createElement('img'); previewImage.alt = 'Source portrait'; previewImage.width = 72; previewImage.height = 96; previewImage.hidden = !source.portrait; if (source.portrait) previewImage.src = source.portrait; rowsHost.append(previewImage);
      for (const category of [{ id: '', title: 'Identity & portrait', traits: characterFields.filter(field => !field.id.includes('/')).map(field => ({ id: field.id, title: field.title })) }, ...catalogue]) {
        const details = document.createElement('details'), summary = document.createElement('summary'), group = document.createElement('fieldset'); summary.textContent = category.title; details.open = !category.id || source.categories.some(item => item.id === category.id) || Object.keys(latest.sharedValues ?? {}).some(field => field.startsWith(`${category.id}/`)); details.append(summary, group); rowsHost.append(details);
        if (creating && category.id) { const include = document.createElement('input'); include.type = 'checkbox'; include.checked = source.categories.some(item => item.id === category.id); const wrapper = document.createElement('label'); wrapper.className = 'character-check'; wrapper.append(include, `Include ${category.title}`); include.setAttribute('aria-label', `Include ${category.title}`); group.append(wrapper); categoryChoices.set(category.id, include); }
        for (const trait of category.traits) {
          const field = category.id ? `${category.id}/${trait.id}` : trait.id, row = document.createElement('div'), title = document.createElement('strong'), summary = document.createElement('p'); row.className = 'instance-setup-row'; title.textContent = trait.title; summary.textContent = displayValue(field, fieldValue(source, field)) || 'Empty'; summary.dir = 'auto';
          let include: HTMLInputElement | undefined;
          if (creating && category.id) { include = document.createElement('input'); include.type = 'checkbox'; include.checked = source.categories.find(item => item.id === category.id)?.traits.some(item => item.id === trait.id) ?? false; include.setAttribute('aria-label', `Include ${category.title}: ${trait.title}`); const wrapper = document.createElement('label'); wrapper.className = 'character-check'; wrapper.append(include, title); row.append(wrapper); } else row.append(title);
          row.append(summary);
          const share = document.createElement('input'); share.type = 'checkbox'; share.checked = field in (latest.sharedValues ?? {}); share.setAttribute('aria-label', `Share ${category.id ? `${category.title}: ` : ''}${trait.title}`); const scope = document.createElement('label'); scope.className = 'character-check'; scope.append(share, 'Shared across instances'); row.append(scope);
          const copy = document.createElement('select'); copy.setAttribute('aria-label', `Initial value for ${category.id ? `${category.title}: ` : ''}${trait.title}`); for (const [value, text] of [['copy', 'Copy from source'], ['empty', 'Start empty']]) { const option = document.createElement('option'); option.value = value ?? ''; option.textContent = text ?? ''; copy.append(option); } copy.disabled = share.checked; if (creating) row.append(copy);
          share.addEventListener('change', () => { copy.disabled = share.checked; }); choices.set(field, { share, copy, include }); group.append(row);
        }
      }
    };
    build(); sourceSelect.addEventListener('change', build);
    content.form.addEventListener('change', event => { if (event.target === acknowledgment) return; acknowledgment.checked = false; preview.replaceChildren(); confirmLabel.hidden = true; });
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = creating ? 'Create instance' : 'Apply sharing'; content.actions.append(submit); content.form.append(preview, confirmLabel, content.actions);
    content.form.addEventListener('submit', event => {
      event.preventDefault(); const latest = selected(); if (!latest || latest.id !== characterId || !editable()) return;
      const sharedFields = [...choices].filter(([, choice]) => choice.share.checked).map(([field]) => field), conflicts = sharingConflicts(latest, sourceSelect.value, sharedFields);
      if (conflicts.length && !acknowledgment.checked) {
        preview.replaceChildren(); const heading = document.createElement('h3'); heading.textContent = 'Review differing values'; preview.append(heading);
        for (const conflict of conflicts) { const text = document.createElement('p'), source = instanceValues(latest, sourceSelect.value); text.textContent = `${characterFields.find(field => field.id === conflict.field)?.title ?? conflict.field}: use “${displayValue(conflict.field, fieldValue(source, conflict.field)) || 'Empty'}” in ${conflict.instances.join(', ')}.`; preview.append(text); }
        confirmLabel.hidden = false; acknowledgment.focus(); return;
      }
      const selectedCategories: CharacterCategory[] = catalogue.filter(category => categoryChoices.get(category.id)?.checked).map(category => ({ id: category.id, traits: category.traits.filter(trait => choices.get(`${category.id}/${trait.id}`)?.include?.checked).map(trait => ({ id: trait.id, value: '' })) }));
      const operation: CharacterChange = { type: 'configure', source: sourceSelect.value, sharedFields, ...(creating ? { create: { label: labelInput.value, copyFields: [...choices].filter(([, choice]) => choice.copy.value === 'copy').map(([field]) => field), categories: selectedCategories } } : {}) };
      try {
        const updated = context.project.changeCharacter(latest.id, operation), instance = creating ? characterInstances(updated).at(-1) : undefined;
        closeDialog(); if (instance) context.local(local => { local.instance = instance.id; });
      } catch (error) { content.error.textContent = error instanceof Error ? error.message : 'Check the instance settings.'; (error instanceof CharacterError && error.field === 'label' ? labelInput : content.error).focus(); }
    });
    if (creating) labelInput.focus(); else rowsHost.querySelector('input')?.focus();
  };
  const openInstances = (owner: HTMLButtonElement): void => {
    const character = selected(); if (!character) return;
    menuItems(owner, [
      ...(editable() ? [{ label: 'New instance', run: () => { configure(true, owner); } }, { label: 'Manage sharing', run: () => { configure(false, owner); } }] : []),
      ...characterInstances(character).map(instance => ({ label: instance.label, run: () => { context.local(local => { local.instance = instance.id; }); } })),
      { label: 'Rename instance', disabled: !editable(), run: () => {
        const content = openDialog('Rename instance', owner); if (!content) return; const input = document.createElement('input'); input.value = characterInstance(character, currentId()).label; input.maxLength = 80; input.setAttribute('aria-label', 'Instance label');
        const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Rename instance'; content.actions.append(submit); content.form.append(input, content.actions);
        content.form.addEventListener('submit', event => { event.preventDefault(); if (change({ type: 'rename', instance: currentId(), label: input.value })) closeDialog(); else content.error.textContent = status.textContent; }); input.focus(); input.select();
      } },
      { label: 'Delete instance', disabled: !editable() || characterInstances(character).length === 1, run: () => { const instance = characterInstance(character, currentId()); confirm('Delete instance', owner, `Delete “${instance.label}” and its local values? Shared values remain with the character.`, () => { change({ type: 'delete', instance: instance.id }); }); } },
    ]);
  };
  const portraitMenu = control('Portrait options', () => { if (editable()) menuItems(portraitMenu, [{ label: 'Choose portrait', run: () => { upload.click(); } }, { label: 'Remove portrait', run: () => { portraitRequest++; change({ type: 'field', instance: currentId(), field: 'portrait', value: '' }); } }]); }, icons.more); portraitMenu.className = 'portrait-options'; portraitMenu.setAttribute('aria-haspopup', 'true');
  portrait.append(image, placeholder, portraitMenu, portraitShared, upload); header.append(backdrop, portrait, heroCopy, backgroundUpload, referenceUpload);
  const identityMedia = document.createElement('details'), mediaSummary = document.createElement('summary'); identityMedia.className = 'character-identity-media'; mediaSummary.textContent = 'World & visual references'; identityMedia.append(mediaSummary, referencesHost); identity.insertBefore(header, fieldsHost); identity.insertBefore(identityMedia, fieldsHost);
  const addCategory = control('Add category', () => { const values = data(); if (!values || !editable()) return; menuItems(addCategory, catalogue.filter(item => !values.categories.some(category => category.id === item.id)).map(item => ({ label: item.title, run: () => { change({ type: 'categories', instance: currentId(), categories: [...values.categories, { id: item.id, traits: [] }] }); selectCategory(item.id); } }))); }); navigation.append(addCategory); panels.append(overview, identity, board, studies, relationships, categories); workspace.append(panels, navigationHost); section.append(workspace, status, menu);
  const editTag = (owner: HTMLButtonElement, index: number): void => {
    const values = data(); if (!values || !editable() || !openMenu(owner)) return; const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80; input.value = values.tags[index] ?? ''; input.setAttribute('aria-label', 'Tag');
    const commitTag = (): void => { if (!input.value.trim()) { input.setCustomValidity('Enter a tag.'); input.reportValidity(); return; } const tags = [...(data()?.tags ?? [])]; tags[index] = input.value.trim(); if (change({ type: 'field', instance: currentId(), field: 'tags', value: tags })) closeMenu(); };
    input.addEventListener('input', () => { input.setCustomValidity(''); }); input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commitTag(); } }); menu.append(input, control('Save tag', commitTag));
    if (index < values.tags.length) menu.append(control('Remove tag', () => { const tags = [...(data()?.tags ?? [])]; tags.splice(index, 1); if (change({ type: 'field', instance: currentId(), field: 'tags', value: tags })) closeMenu(); })); positionMenu(); input.focus(); input.select();
  };
  const buildCategories = (values: CharacterValues): void => {
    categories.replaceChildren(); for (const field of editors.keys()) if (field.includes('/')) editors.delete(field);
    for (const definition of catalogue) {
      const category = values.categories.find(item => item.id === definition.id); if (!category) continue;
      const group = document.createElement('section'); group.className = 'character-category'; group.dataset.category = definition.id; group.id = `${panelPrefix}-${definition.id}`; group.setAttribute('role', 'tabpanel');
      const top = document.createElement('header'), heading = document.createElement('h2'), description = document.createElement('p'), titles = document.createElement('div');
      const toggle = control(`Collapse ${definition.title}`, () => { context.local(local => { const collapsed = Array.isArray(local.collapsed) ? local.collapsed.filter((item): item is string => typeof item === 'string') : []; local.collapsed = collapsed.includes(definition.id) ? collapsed.filter(id => id !== definition.id) : [...collapsed, definition.id]; }); }); toggle.textContent = definition.title; toggle.className = 'category-toggle'; heading.append(toggle); description.textContent = definition.description; titles.append(heading, description);
      const add = control(`Add trait to ${definition.title}`, () => { if (!editable()) return; const current = data()?.categories.find(item => item.id === definition.id); if (!current) return; menuItems(add, definition.traits.filter(item => !current.traits.some(trait => trait.id === item.id)).map(item => ({ label: item.title, run: () => { const next = data()?.categories; if (!next) return; next.find(category => category.id === definition.id)?.traits.push({ id: item.id, value: '' }); change({ type: 'categories', instance: currentId(), categories: next }); } }))); }); add.textContent = 'Add trait'; add.dataset.editAction = 'true'; add.disabled = category.traits.length === definition.traits.length;
      const actions = control(`Category options: ${definition.title}`, () => { menuItems(actions, [{ label: `Remove ${definition.title}`, disabled: !editable(), run: () => { const latest = data(); if (!latest) return; remove(actions, Boolean(latest.categories.find(item => item.id === definition.id)?.traits.some(trait => trait.value.trim())), `Remove ${definition.title}`, () => { const next = data()?.categories.filter(item => item.id !== definition.id); if (next) change({ type: 'categories', instance: currentId(), categories: next }); }); } }]); }, icons.more); actions.dataset.editAction = 'true'; top.append(icon(definition.icon), titles, add, actions); group.append(top);
      const table = document.createElement('table'); table.setAttribute('aria-label', definition.title);
      for (const part of categorySections[definition.id] ?? []) {
        const traits = part.traits.map(id => definition.traits.find(trait => trait.id === id)).filter((trait): trait is typeof definition.traits[number] => Boolean(trait && category.traits.some(item => item.id === trait.id)));
        if (!traits.length) continue;
        const body = document.createElement('tbody'); body.dataset.kind = part.compact ? 'facts' : definition.id === 'relationships' ? 'connections' : 'writing'; table.append(body);
        const sectionRow = document.createElement('tr'); sectionRow.className = 'character-group-heading'; const cell = document.createElement('th'); cell.colSpan = 3; cell.scope = 'colgroup'; const title = document.createElement('h3'); title.textContent = part.title; const help = document.createElement('p'); help.textContent = part.description; cell.append(title, help); sectionRow.append(cell); body.append(sectionRow);
        for (const trait of traits) {
        const row = document.createElement('tr'), label = document.createElement('th'), value = document.createElement('td'), actions = document.createElement('td'); label.scope = 'row'; label.textContent = trait.title; makeEditor(`${definition.id}/${trait.id}`, `${definition.title}: ${trait.title}`, true, value); editors.get(`${definition.id}/${trait.id}`)?.input.setAttribute('placeholder', writingPrompts[trait.id] ?? `Describe ${trait.title.toLowerCase()}…`);
        const erase = control(`Remove ${trait.title}`, () => { const latest = data(); if (!latest) return; remove(erase, Boolean(latest.categories.find(item => item.id === definition.id)?.traits.find(item => item.id === trait.id)?.value.trim()), `Remove ${trait.title}`, () => { const next = data()?.categories, category = next?.find(item => item.id === definition.id); if (category && next) { category.traits = category.traits.filter(item => item.id !== trait.id); change({ type: 'categories', instance: currentId(), categories: next }); } }); }, 'm4 4 8 8m0-8-8 8'); erase.dataset.editAction = 'true'; actions.append(erase); row.append(label, value, actions); body.append(row);
      }
      }
      if (!category.traits.length) { const empty = document.createElement('p'); empty.className = 'character-category-empty'; empty.textContent = `Start with one detail about ${definition.title.toLowerCase()}. Add only the traits that help you describe this character.`; group.append(empty); }
      group.append(table); categories.append(group);
    }
  };
  upload.addEventListener('change', () => {
    const file = upload.files?.[0], key = selectedKey; upload.value = ''; if (!file || !editable()) return; const request = ++portraitRequest; status.textContent = 'Preparing portrait…';
    portraitData(file).then(result => { if (context.signal.aborted || request !== portraitRequest || selectedKey !== key || !editable()) return; change({ type: 'field', instance: currentId(), field: 'portrait', value: result }); }).catch((error: unknown) => { if (!context.signal.aborted && request === portraitRequest && selectedKey === key && editable()) fail(error); });
  }, { signal: context.signal });
  const manageReferences = (): void => {
    const values = data(); if (!values) return; const content = openDialog('Manage reference images', referencesMenu); if (!content) return;
    const rows: { reference: CharacterReference; caption: HTMLInputElement; remove: HTMLInputElement }[] = [];
    for (const reference of values.references.filter(reference => reference.kind !== 'note')) {
      const row = document.createElement('div'); row.className = 'character-reference-editor'; const image = document.createElement('img'); image.src = reference.image; image.alt = reference.caption || 'Character reference'; image.width = 80; image.height = 80;
      const caption = document.createElement('input'); caption.type = 'text'; caption.maxLength = 200; caption.value = reference.caption; caption.setAttribute('aria-label', `Caption for reference ${String(rows.length + 1)}`);
      const erase = document.createElement('input'); erase.type = 'checkbox'; erase.setAttribute('aria-label', `Remove reference ${String(rows.length + 1)}`); const label = document.createElement('label'); label.className = 'character-check'; label.append(erase, 'Remove'); row.append(image, caption, label); content.form.append(row); rows.push({ reference, caption, remove: erase });
    }
    if (!rows.length) { const empty = document.createElement('p'); empty.textContent = 'No reference images yet. Add sketches, expressions, places, or other images that belong to this character.'; content.form.append(empty); }
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Save references'; content.actions.append(submit); content.form.append(content.actions);
    content.form.addEventListener('submit', event => { event.preventDefault(); if (change({ type: 'field', instance: currentId(), field: 'references', value: pruneReferenceLinks([...(data()?.references.filter(reference => reference.kind === 'note') ?? []), ...rows.filter(row => !row.remove.checked).map(row => ({ ...row.reference, caption: row.caption.value }))]) })) closeDialog(); else content.error.textContent = status.textContent; });
  };
  const referencesMenu = control('Header images', () => { if (!editable()) return; menuItems(referencesMenu, [
    { label: 'Choose birthplace background', run: () => { backgroundUpload.click(); } },
    { label: 'Remove birthplace background', run: () => { sceneRequest++; change({ type: 'field', instance: currentId(), field: 'birthplaceImage', value: '' }); } },
    { label: 'Add reference images', run: () => { referenceUpload.click(); } },
    { label: 'Manage reference images', run: manageReferences },
  ]); }, icons.more);
  const referenceHeading = document.createElement('div'); referenceHeading.className = 'character-reference-heading'; const referenceTitle = document.createElement('span'); referenceTitle.textContent = 'References'; referenceHeading.append(referenceTitle, referencesMenu); referencesHost.append(referenceHeading, referenceGrid);
  backgroundUpload.addEventListener('change', () => {
    const file = backgroundUpload.files?.[0], key = selectedKey; backgroundUpload.value = ''; if (!file || !editable()) return; const request = ++sceneRequest; status.textContent = 'Preparing birthplace background…';
    portraitData(file, 1600).then(result => { if (context.signal.aborted || request !== sceneRequest || selectedKey !== key || !editable()) return; change({ type: 'field', instance: currentId(), field: 'birthplaceImage', value: result }); }).catch((error: unknown) => { if (!context.signal.aborted && request === sceneRequest && selectedKey === key && editable()) fail(error); });
  }, { signal: context.signal });
  referenceUpload.addEventListener('change', () => {
    const files = [...(referenceUpload.files ?? [])], key = selectedKey; referenceUpload.value = ''; if (!files.length || !editable()) return; if (files.length + (data()?.references.filter(reference => reference.kind !== 'note').length ?? 0) > 12) { fail(new Error('Use up to 12 reference images. Remove an image before adding more.')); return; }
    const request = ++referenceRequest; status.textContent = 'Preparing reference images…';
    Promise.all(files.map(async file => ({ id: `reference-${crypto.randomUUID()}`, image: await portraitData(file), caption: file.name.replace(/\.[^.]+$/, '').slice(0, 200) }))).then(images => { if (context.signal.aborted || request !== referenceRequest || selectedKey !== key || !editable()) return; change({ type: 'field', instance: currentId(), field: 'references', value: [...(data()?.references ?? []), ...images] }); }).catch((error: unknown) => { if (!context.signal.aborted && request === referenceRequest && selectedKey === key && editable()) fail(error); });
  }, { signal: context.signal });
  const buildGallery = (values: CharacterValues): void => {
    referenceGrid.replaceChildren();
    for (const [index, reference] of values.references.filter(reference => reference.kind !== 'note').entries()) {
      const button = control(`Open reference ${String(index + 1)}${reference.caption ? `: ${reference.caption}` : ''}`, () => { viewReference(reference, button); }); button.className = 'character-reference';
      const seed = Array.from(reference.id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0); button.style.gridColumn = `span ${String(seed % 3 === 0 ? 3 : 2)}`; button.style.gridRow = `span ${String(seed % 4 === 0 ? 2 : 1)}`;
      const image = document.createElement('img'); image.src = reference.image; image.alt = reference.caption || `Reference ${String(index + 1)}`; image.width = 160; image.height = 100; button.replaceChildren(image); referenceGrid.append(button);
    }
    if (!values.references.some(reference => reference.image)) { const add = control('Add reference images', () => { if (editable()) referenceUpload.click(); }, 'M8 3v10M3 8h10'); add.className = 'character-reference-empty'; const label = document.createElement('span'); label.textContent = editable() ? 'Collect their world' : 'No references yet.'; add.append(label); add.disabled = !editable(); referenceGrid.append(add); }
  };
  const buildNavigation = (values: CharacterValues): void => {
    navigation.replaceChildren();
    const entries = [{ id: 'overview', title: 'Overview', icon: 'M4 1h6l3 3v11H3V1h1M9 1v4h4M5 8h6M5 11h6' }, { id: 'identity', title: 'Identity', icon: 'M11 5a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM2 15v-2a6 6 0 0 1 12 0v2' }, ...catalogue.filter(category => values.categories.some(item => item.id === category.id)), { id: 'references', title: 'References', icon: 'M2 2h12v12H2zM3 12l4-5 3 3 3-4' }];
    const labels: Record<string, string> = { essence: 'Essence', history: 'History', body: 'Body', life: 'Life' };
    const paths: Record<string, string> = { essence: 'M8 1l1.8 5.2L15 8l-5.2 1.8L8 15l-1.8-5.2L1 8l5.2-1.8ZM13 1v3M11.5 2.5h3', appearance: 'M2 2h12v12H2ZM3 12l4-5 3 3 3-4M10 5h.01', personality: 'M14 7a6 6 0 0 1-6 6H5l-4 2 1.5-4A6 6 0 1 1 14 7Z', history: 'M8 3C5 1 2 2 1 3v11c2-1 5-1 7 0 2-1 5-1 7 0V3c-1-1-4-2-7 0Zm0 0v11', body: 'M8 14 2 8C-2 3 4-1 8 4c4-5 10-1 6 4Z', life: 'M2 14C2 5 8 2 14 1c0 7-3 12-9 11M2 14 11 5' };
    for (const entry of entries) { const button = control(`Character ${entry.title}`, () => { selectCategory(entry.id); }); button.replaceChildren(icon(paths[entry.id] ?? entry.icon)); const label = document.createElement('span'); label.textContent = labels[entry.id] ?? entry.title; button.append(label); button.dataset.category = entry.id; button.setAttribute('role', 'tab'); button.id = `${panelPrefix}-tab-${entry.id}`; button.setAttribute('aria-controls', `${panelPrefix}-${entry.id}`); navigation.append(button); }
    addCategory.replaceChildren(icon('M8 2v12M2 8h12')); const addLabel = document.createElement('span'); addLabel.textContent = 'Add category'; addCategory.append(addLabel); navigation.append(addCategory);
  };
  navigation.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLButtonElement) || !event.target.dataset.category) return;
    const buttons = [...navigation.querySelectorAll<HTMLButtonElement>('[role="tab"]')], index = buttons.indexOf(event.target), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); const button = buttons[next]; if (button?.dataset.category) selectCategory(button.dataset.category, true);
  }, { signal: context.signal });
  const overviewCopy = document.createElement('div'); overviewCopy.className = 'character-overview-copy';
  const overviewName = document.createElement('h1'), overviewRole = document.createElement('p'), overviewTitle = document.createElement('h2'), overviewError = document.createElement('p'); overviewError.className = 'character-error'; overviewError.setAttribute('role', 'alert');
  const overviewChoice = document.createElement('select'); overviewChoice.setAttribute('aria-label', 'Overview writing field');
  const overviewInput = document.createElement('textarea'); overviewInput.setAttribute('aria-label', 'Overview notes'); overviewInput.dir = 'auto'; overviewInput.autocomplete = 'off'; overviewInput.rows = 6;
  const overviewContexts = document.createElement('div'); overviewContexts.className = 'character-overview-contexts'; overviewContexts.setAttribute('role', 'group'); overviewContexts.setAttribute('aria-label', 'Social behavior context');
  const overviewRead = document.createElement('p'); overviewRead.className = 'character-overview-prose'; overviewRead.dir = 'auto';
  const overviewStage = document.createElement('div'); overviewStage.className = 'character-overview-stage';
  const overviewWorld = document.createElement('img'); overviewWorld.className = 'character-overview-world'; overviewWorld.alt = ''; overviewWorld.width = 1600; overviewWorld.height = 900;
  const overviewPortrait = document.createElement('img'); overviewPortrait.className = 'character-overview-portrait'; overviewPortrait.alt = 'Character portrait'; overviewPortrait.width = 420; overviewPortrait.height = 640;
  const overviewReferences = document.createElement('div'); overviewReferences.className = 'character-overview-references';
  const overviewUpload = control('Choose Overview portrait', () => { if (editable() && commit()) upload.click(); });
  const overviewCaption = document.createElement('div'); overviewCaption.className = 'character-overview-caption'; const overviewQuote = document.createElement('blockquote'), overviewAliases = document.createElement('div'); overviewAliases.className = 'character-overview-aliases'; overviewCaption.append(overviewName, overviewRole, overviewQuote, overviewAliases); const overviewShared = document.createElement('span'); overviewShared.className = 'character-shared'; overviewShared.textContent = 'Shared';
  overviewCopy.append(overviewChoice, overviewShared, overviewTitle, overviewContexts, overviewInput, overviewRead, overviewError, control('Open Identity', () => { selectCategory('identity'); }));
  overviewStage.append(overviewWorld, overviewPortrait, overviewCaption, overviewUpload, overviewReferences); overview.append(overviewStage, overviewCopy);
  let overviewDraft = '', overviewDirty = false, overviewField = 'roleSummary', overviewOptions = '', overviewConnectionId = '', contextSignature = '', sidebarSignature = '';
  commitOverview = (): boolean => {
    if (!overviewDirty) return true;
    try {
      const field = overviewConnectionId ? 'connections' : overviewField, value = overviewConnectionId ? (data()?.connections ?? []).map(connection => connection.id === overviewConnectionId ? { ...connection, context: overviewInput.value } : connection) : overviewInput.value;
      validateField(field, value); if (!change({ type: 'field', instance: currentId(), field, value })) return false; overviewDirty = false; overviewError.textContent = ''; overviewInput.removeAttribute('aria-invalid'); return true;
    }
    catch (error) { overviewError.textContent = error instanceof Error ? error.message : 'Check this value.'; overviewInput.setAttribute('aria-invalid', 'true'); overviewInput.focus(); return false; }
  };
  overviewInput.addEventListener('input', () => { overviewDirty = true; }); overviewInput.addEventListener('blur', () => { commitOverview(); });
  overviewInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && overviewField === 'roleSummary') { event.preventDefault(); if (commitOverview()) overviewInput.blur(); } });
  overviewChoice.addEventListener('change', () => { const field = overviewChoice.value; if (!commit()) { overviewChoice.value = overviewField; return; } context.local(local => { local.overviewField = field; }); });
  const buildOverview = (values: CharacterValues): void => {
    const available = characterFields.filter(field => ['roleSummary', 'quote'].includes(field.id) || values.categories.some(category => category.traits.some(trait => `${category.id}/${trait.id}` === field.id)));
    const options = available.map(field => field.id).join('|'); if (options !== overviewOptions) { overviewOptions = options; overviewChoice.replaceChildren(...available.map(field => { const option = document.createElement('option'); option.value = field.id; option.textContent = field.title; return option; })); }
    const field = typeof context.state.data.overviewField === 'string' && available.some(field => field.id === context.state.data.overviewField) ? context.state.data.overviewField : 'roleSummary';
    const connection = field === 'personality/social-behavior' ? values.connections.find(connection => connection.id === context.state.data.overviewConnection) : undefined, draftKey = `${selectedKey}/${field}/${connection?.id ?? ''}`;
    if (draftKey !== overviewDraft) { overviewDraft = draftKey; overviewField = field; overviewConnectionId = connection?.id ?? ''; overviewDirty = false; overviewError.textContent = ''; overviewInput.removeAttribute('aria-invalid'); }
    overviewChoice.value = field; overviewInput.maxLength = field === 'roleSummary' ? 160 : field === 'quote' ? 1000 : 10_000;
    const fieldContent = connection ? connection.context : fieldValue(values, field), value = typeof fieldContent === 'string' ? fieldContent : ''; if (!overviewDirty && document.activeElement !== overviewInput) overviewInput.value = value;
    overviewName.textContent = [values.name, values.middleName, values.familyName].filter(Boolean).join(' '); overviewRole.textContent = values.roleSummary; overviewQuote.textContent = values.quote; overviewQuote.hidden = !values.quote; overviewShared.hidden = !((connection ? 'connections' : field) in (selected()?.sharedValues ?? {}));
    overviewContexts.hidden = field !== 'personality/social-behavior' || !values.connections.length;
    const nextContexts = JSON.stringify([selectedKey, field, values.connections.map(connection => [connection.id, context.project.read().characters.find(character => character.id === connection.target)?.name])]);
    if (contextSignature !== nextContexts) {
      contextSignature = nextContexts; overviewContexts.replaceChildren();
      const chooseContext = (id: string): void => { if (commit()) context.local(local => { local.overviewConnection = id; }); };
      const general = control('In general', () => { chooseContext(''); }); general.dataset.connection = ''; overviewContexts.append(general);
      for (const connection of values.connections) { const target = context.project.read().characters.find(character => character.id === connection.target); if (!target) continue; const button = control(`With ${target.name}`, () => { chooseContext(connection.id); }); button.dataset.connection = connection.id; overviewContexts.append(button); }
    }
    for (const button of overviewContexts.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.connection === (connection?.id ?? '')));
    if (overviewAliases.dataset.signature !== JSON.stringify(values.aliases)) { overviewAliases.dataset.signature = JSON.stringify(values.aliases); overviewAliases.replaceChildren(...values.aliases.map(alias => { const chip = document.createElement('span'); chip.textContent = alias; return chip; })); }
    const trait = field.split('/')[1] ?? field; overviewTitle.textContent = field === 'roleSummary' ? 'Who is this person?' : field === 'quote' ? 'A line of their own' : trait === 'social-behavior' ? 'What changes when they trust someone?' : writingPrompts[trait] ?? available.find(item => item.id === field)?.title ?? 'A detail worth exploring';
    overviewInput.placeholder = field === 'roleSummary' ? 'A few words you would use to introduce them…' : 'Write what matters here, including the exceptions…'; overviewInput.hidden = !editable(); overviewRead.hidden = editable(); overviewRead.textContent = value || 'No notes yet.';
    if (overviewPortrait.getAttribute('src') !== values.portrait) { if (values.portrait) overviewPortrait.src = values.portrait; else overviewPortrait.removeAttribute('src'); } overviewPortrait.hidden = !values.portrait;
    if (overviewWorld.getAttribute('src') !== values.birthplaceImage) { if (values.birthplaceImage) overviewWorld.src = values.birthplaceImage; else overviewWorld.removeAttribute('src'); } overviewWorld.hidden = !values.birthplaceImage;
    overviewUpload.hidden = !editable(); overviewUpload.textContent = values.portrait ? 'Replace portrait' : 'Add their portrait';
    const signature = JSON.stringify(values.references.filter(reference => reference.image).slice(0, 3));
    if (overviewSignature !== signature) { overviewSignature = signature; overviewReferences.replaceChildren(); for (const reference of values.references.filter(reference => reference.image).slice(0, 3)) { const button = control(`Open Overview reference: ${reference.caption}`, () => { viewReference(reference, button); }); const image = document.createElement('img'); image.src = reference.image; image.alt = reference.caption || 'Character reference'; image.width = 140; image.height = 90; button.replaceChildren(image); overviewReferences.append(button); } }
  };
  const studio = mountCharacterStudio(board, relationships, studies, { read: () => { const character = selected(), values = data(); return character && values ? { character, values, key: `${character.id}/${currentId()}`, characters: context.project.read().characters, edit: editable(), select: !editable() || !context.state.tool || context.state.tool === 'reference.select', connect: editable() && context.state.tool === 'reference.connect', zoom: typeof context.state.data.referenceZoom === 'number' ? Math.max(.25, Math.min(2, context.state.data.referenceZoom)) : 1.5 } : undefined; }, zoom: value => { context.local(data => { data.referenceZoom = value; }); }, write: (field, value) => change({ type: 'field', instance: currentId(), field, value }), commit, prepareImage: portraitData, report: message => { status.textContent = message; }, addImages: () => { referenceUpload.click(); }, confirm, signal: context.signal });
  const update = (): void => {
    const character = selected(), instance = character ? characterInstance(character, typeof context.state.data.instance === 'string' ? context.state.data.instance : undefined) : undefined, key = `${character?.id ?? ''}/${instance?.id ?? ''}`, changed = key !== selectedKey;
    if (changed || context.state.mode !== lastMode) { selectedKey = key; lastMode = context.state.mode; portraitRequest++; sceneRequest++; referenceRequest++; closeMenu(); if (lightbox.open) closeLightbox(); if (dialog.open) closeDialog(); status.textContent = ''; }
    for (const element of [header, workspace, status]) element.hidden = !character;
    if (!character || !instance) { studio.update(); return; } const values = instanceValues(character, instance.id), edit = context.state.mode === 'edit';
    heroName.textContent = [values.name, values.middleName, values.familyName].filter(Boolean).join(' '); heroName.disabled = !edit; referencesMenu.hidden = !edit; roleLabel.hidden = !edit && !values.roleSummary; quoteLabel.hidden = !edit && !values.quote;
    if (backdrop.getAttribute('src') !== values.birthplaceImage) { if (values.birthplaceImage) backdrop.src = values.birthplaceImage; else backdrop.removeAttribute('src'); } backdrop.hidden = !values.birthplaceImage;
    const nextGallery = JSON.stringify([values.references, edit]); if (changed || gallerySignature !== nextGallery) { gallerySignature = nextGallery; buildGallery(values); }
    const nextNav = JSON.stringify(values.categories.map(category => category.id)); if (changed || navSignature !== nextNav) { navSignature = nextNav; buildNavigation(values); }
    const active = typeof context.state.data.category === 'string' && ['overview', 'identity', 'references', ...values.categories.map(category => category.id)].includes(context.state.data.category) ? context.state.data.category : 'overview';
    workspace.dataset.layout = context.state.data.categoryLayout === 'vertical' ? 'vertical' : 'horizontal'; navigation.setAttribute('aria-orientation', workspace.dataset.layout);
    if (section.dataset.category !== active) studio.collapseDetails();
    section.dataset.category = active; section.dataset.categoryLayout = workspace.dataset.layout;
    header.hidden = active !== 'identity';
    board.hidden = active !== 'references'; studies.hidden = active !== 'appearance'; relationships.hidden = active !== 'relationships';
    board.setAttribute('aria-labelledby', `${panelPrefix}-tab-references`);
    overview.hidden = active !== 'overview'; identity.hidden = active !== 'identity';
    const nextSidebar = JSON.stringify([values.name, values.middleName, values.familyName, values.portrait, values.roleSummary, values.quote]);
    if (sidebarSignature !== nextSidebar) { sidebarSignature = nextSidebar; sidebarIdentity.replaceChildren(); if (values.portrait) { const image = document.createElement('img'); image.src = values.portrait; image.alt = 'Character portrait'; image.width = 220; image.height = 280; sidebarIdentity.append(image); } const name = document.createElement('h2'), role = document.createElement('p'), quote = document.createElement('blockquote'); name.textContent = [values.name, values.middleName, values.familyName].filter(Boolean).join(' '); role.textContent = values.roleSummary; quote.textContent = values.quote; sidebarIdentity.append(name, role, quote); }
 overview.setAttribute('aria-labelledby', `${panelPrefix}-tab-overview`); identity.setAttribute('aria-labelledby', `${panelPrefix}-tab-identity`);
    for (const button of navigation.querySelectorAll<HTMLButtonElement>('[role="tab"]')) { button.setAttribute('aria-selected', String(button.dataset.category === active)); button.tabIndex = button.dataset.category === active ? 0 : -1; }
    buildOverview(values); studio.update(); 
    image.hidden = !values.portrait; placeholder.hidden = Boolean(values.portrait); if (image.getAttribute('src') !== values.portrait) { if (values.portrait) image.src = values.portrait; else image.removeAttribute('src'); } portraitMenu.hidden = !edit; portraitShared.hidden = !('portrait' in (character.sharedValues ?? {}));
    const nextTags = JSON.stringify([values.tags, edit, 'tags' in (character.sharedValues ?? {})]);
    if (changed || nextTags !== tagSignature) {
      tagSignature = nextTags; tags.replaceChildren(); if ('tags' in (character.sharedValues ?? {})) { const shared = document.createElement('span'); shared.className = 'character-shared'; shared.textContent = 'Shared'; tags.append(shared); } tags.setAttribute('aria-label', 'tags' in (character.sharedValues ?? {}) ? 'Shared tags' : 'Tags');
      values.tags.forEach((tag, index) => { const button = control(`Edit tag: ${tag}`, () => { editTag(button, index); }); button.textContent = tag; button.title = tag; if (!edit) { button.setAttribute('aria-label', tag); button.setAttribute('aria-disabled', 'true'); } const tooltip = document.createElement('span'); tooltip.className = 'tag-tooltip'; tooltip.textContent = tag; button.append(tooltip); tags.append(button); });
      if (edit && values.tags.length < 3) { const add = control('Add tag', () => { editTag(add, values.tags.length); }, 'M8 3v10M3 8h10'); tags.append(add); }
    }
    const nextStructure = JSON.stringify(values.categories.map(category => [category.id, category.traits.map(trait => trait.id)])); if (changed || nextStructure !== structure) { structure = nextStructure; buildCategories(values); }
    const nextAliases = JSON.stringify([values.aliases, edit]);
    if (changed || aliasSignature !== nextAliases) {
      aliasSignature = nextAliases; aliasChips.hidden = !edit;
      const previous = [...aliasChips.children] as HTMLElement[], retained = new Set<HTMLElement>();
      values.aliases.forEach((alias, index) => {
        let chip = previous.find(element => element.dataset.alias === alias && !retained.has(element));
        if (!chip) {
          chip = document.createElement('span'); chip.className = 'character-alias-chip'; chip.dataset.alias = alias; const text = document.createElement('span'); text.textContent = alias;
          const erase = control(`Remove alias: ${alias}`, () => { if (!commit()) return; const aliases = [...(data()?.aliases ?? [])], position = aliases.indexOf(alias); if (position < 0) return; aliases.splice(position, 1); if (change({ type: 'field', instance: currentId(), field: 'aliases', value: aliases })) editors.get('aliases')?.input.focus(); }, 'm4 4 8 8m0-8-8 8');
          chip.append(text, erase);
        }
        const erase = chip.querySelector('button'); if (erase) erase.disabled = !editable(); retained.add(chip);
        if (aliasChips.children[index] !== chip) aliasChips.insertBefore(chip, aliasChips.children[index] ?? null);
      });
      for (const chip of previous) if (!retained.has(chip)) chip.remove();
    }
    for (const [field, editor] of editors) {
      const value = displayValue(field, fieldValue(values, field)); if (changed) { delete editor.input.dataset.dirty; editor.error.textContent = ''; editor.input.removeAttribute('aria-invalid'); }
      if ((changed || !editor.input.dataset.dirty && document.activeElement !== editor.input) && editor.input.value !== value && field !== 'aliases') editor.input.value = value;
      if (changed && field === 'aliases') editor.input.value = '';
      editor.input.hidden = !edit; editor.input.disabled = !editable(); editor.read.hidden = edit; editor.read.textContent = value || 'Not set'; editor.shared.hidden = !(field in (character.sharedValues ?? {}));
    }
    for (const group of categories.querySelectorAll<HTMLElement>('[data-category]')) { group.hidden = group.dataset.category !== active; group.setAttribute('aria-labelledby', `${panelPrefix}-tab-${group.dataset.category ?? ''}`); const collapsed = Array.isArray(context.state.data.collapsed) && context.state.data.collapsed.includes(group.dataset.category ?? ''); const table = group.querySelector('table'), toggle = group.querySelector('h2 button'); if (table) table.hidden = collapsed; toggle?.setAttribute('aria-expanded', String(!collapsed)); toggle?.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${catalogue.find(item => item.id === group.dataset.category)?.title ?? ''}`); }
    for (const action of section.querySelectorAll<HTMLElement>('[data-edit-action]')) action.hidden = !edit;
    addCategory.hidden = !edit; addCategory.disabled = !editable() || values.categories.length === catalogue.length;
  };
  document.addEventListener('character-commit', event => { if (!commit()) event.preventDefault(); }, { signal: context.signal });
  window.addEventListener('resize', closeMenu, { signal: context.signal });
  update(); return { command: (command, owner) => { if (command === 'reference.add-image' || command === 'reference.add-note') studio.command(command); else if (command === 'instances') openInstances(owner); else configure(command === 'new-instance', owner); }, commit, update, dispose: () => { navigationSize.disconnect(); studio.dispose(); portraitRequest++; sceneRequest++; referenceRequest++; closeMenu(); if (lightbox.open) lightbox.close(); if (dialog.open) dialog.close(); section.remove(); } };
}
