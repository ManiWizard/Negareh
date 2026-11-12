// Owns browser-only fixtures injected by the isolated suite preview and Playwright.
export async function mountFixture(run) {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  while (document.querySelector('#boot')?.hidden === false) await frame();
  const controls = document.createElement('div'); controls.dataset.characterFixtures = 'true';
  Object.assign(controls.style, { position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)', zIndex: '9999', background: '#303030', padding: '6px', borderRadius: '4px', display: 'flex', gap: '4px' });
  const set = (label, value) => { const input = document.querySelector(`.character-surface [aria-label="${label}"]`); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('blur')); };
  const button = (label, root = document) => [...root.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
  let busy = false;
  const seed = async kind => {
    if (busy) return; busy = true;
    try {
      await run({ action: 'project.new', decision: 'discard' });
      [...document.querySelectorAll('[role="tab"]')].find(tab => tab.getAttribute('aria-label') === 'Character').click();
      if (kind === 'empty') return;
      button('New character').click();
      set('Name', kind === 'worst' ? 'Aleksandra Wiśniewska-Kowalczyk' : 'Mira'); set('Middle name', kind === 'worst' ? 'نور الهدى عبد الرحمن' : 'Elin'); set('Family name', kind === 'worst' ? 'Montgomery de la Cruz y Fernández' : 'Vale');
      set('Aliases', kind === 'worst' ? Array.from({ length: 50 }, (_, index) => `Alias ${index} 王秀英`).join(', ') : 'The Wanderer'); set('Role summary', 'Protagonist · mapmaker · reluctant homecomer'); set('Character quote', 'Every road leads somewhere. I’m still looking for home.'); set('Age / life stage', '29'); set('Birth time', kind === 'worst' ? 'پیش از سپیده‌دم / Before the first dawn' : 'Before dawn');
      const catalogue = await (await fetch('/src/character-catalogue.json')).json();
      for (const category of kind === 'one' ? catalogue.slice(0, 1) : catalogue) {
        button('Add category').click(); button(category.title, document.querySelector('.character-menu:popover-open')).click();
        for (const trait of kind === 'worst' || kind === 'demo' ? category.traits : category.traits.slice(0, 1)) { button(`Add trait to ${category.title}`).click(); button(trait.title, document.querySelector('.character-menu:popover-open')).click(); set(`${category.title}: ${trait.title}`, kind === 'worst' ? `${'LongUnbrokenCharacterDescription'.repeat(8)}\nنور، 王秀英، 👩🏽‍💻\n${'A promise remembered. '.repeat(20)}` : ({ height: '168 cm', weight: '61 kg', handedness: 'Right-handed', build: 'Lean, with strong shoulders from carrying equipment.', hair: 'Dark brown, usually tied back while working.', eyes: 'Brown', voice: 'Low and measured; faster when she talks about maps.', temperament: 'Quiet with strangers; playful with her brother and old friends.', strengths: 'Patient with unfamiliar places. Less patient when someone she loves is in danger.', 'social-behavior': 'Listens first in a group. With trusted friends, she tells long, winding stories.', 'stress-response': 'Checks and rechecks her route. May stop asking for help when she needs it most.', family: 'Her younger brother, Ilen. Close, though they disagree about why she left home.', friends: 'Sera, a bookseller who lets her sit in silence without demanding an explanation.', occupation: 'Independent mapmaker', education: 'Apprenticed to a surveyor', home: 'A rented room above Sera’s bookshop', 'daily-routine': 'Most mornings begin with walking and sketching. Bad weather or news of her brother can undo the whole day.' }[trait.id] ?? '')); }
      }
      for (const tag of kind === 'worst' ? ['👩🏽‍💻 Writer', 'نور الهدى عبد الرحمن', '旅人'] : ['Scholar']) { button('Add tag').click(); const input = document.querySelector('.character-menu input'); input.value = tag; button('Save tag', document.querySelector('.character-menu')).click(); }
      const load = async (path, label) => { const response = await fetch(path); if (!response.ok) return; const blob = await response.blob(), transfer = new DataTransfer(); transfer.items.add(new File([blob], path.split('/').at(-1), { type: 'image/png' })); const upload = document.querySelector(`.character-surface input[aria-label="${label}"]`); upload.files = transfer.files; upload.dispatchEvent(new Event('change')); };
      await load('/__character-assets/portrait.png', 'Portrait'); await load('/__character-assets/birthplace.png', 'Birthplace background');
      const referenceFiles = new DataTransfer(); for (const file of ['portrait.png', 'birthplace.png']) { const response = await fetch(`/__character-assets/${file}`); if (response.ok) referenceFiles.items.add(new File([await response.blob()], file, { type: 'image/png' })); } const references = document.querySelector('.character-surface input[aria-label="Reference images"]'); references.files = referenceFiles.files; references.dispatchEvent(new Event('change'));
      if (kind !== 'worst') {
        const button = (label, root = document) => [...root.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
        button('Character Essence & identity').click();
        for (const trait of kind === 'demo' ? [] : ['One-line description', 'Want', 'Need', 'Secret', 'Greatest fear', 'Personal stakes', 'Self-image']) { button('Add trait to Essence & identity').click(); button(trait, document.querySelector('.character-menu:popover-open')).click(); }
        set('Essence & identity: Story role', 'Protagonist · mapmaker · reluctant homecomer'); set('Essence & identity: One-line description', 'She can map every road except the one that leads her home.'); set('Essence & identity: Want', 'Find her missing brother before the last road out of the city closes.'); set('Essence & identity: Need', 'To let someone else carry part of the weight. Asking for help is not the same as giving up.'); set('Essence & identity: Secret', 'She was the one who told him to leave.'); set('Essence & identity: Greatest fear', 'Being too late. Not just failing, but arriving after everything she cares about is already gone.'); set('Essence & identity: Personal stakes', 'Her brother’s safety, her own sense of belonging, and the truth about what happened years ago.'); set('Essence & identity: Self-image', 'Independent, capable, and in control. Deep down, she feels out of place — always between places, never truly belonging.');
      }

      if (kind === 'demo') {
        for (let tries = 0; tries < 180 && (!document.querySelector('.character-portrait > img')?.naturalWidth || document.querySelectorAll('.character-reference').length < 2); tries++) await frame();
        button('Character References').click();
        for (const [title, note, right, down] of [['A place to return', 'The bookshop is where she can stop pretending to be fine.', 8, 10], ['When she talks about maps', 'She becomes unexpectedly open with people who are curious about her work.', 15, 16]]) {
          button('Add note').click(); set('Reference title', title); set('Reference note', note); const category = document.querySelector('[aria-label="Linked category"]'); category.value = 'personality'; category.dispatchEvent(new Event('change'));
          for (let index = 0; index < right; index++) button(`Select reference: ${title}`).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
          for (let index = 0; index < down; index++) button(`Select reference: ${title}`).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
        }
        for (const name of ['Ilen', 'Sera']) { button('Characters').click(); button('New character', document.querySelector('.workspace-menu:popover-open')).click(); set('Name', name); }
        button('Characters').click(); button('Mira Elin Vale', document.querySelector('.workspace-menu:popover-open')).click(); button('Character Relationships').click();
        for (const [name, label, bond, tension] of [['Ilen', 'Brother · trust strained', 'They grew up beside the same river. He remembers who she was before she left.', 'She left, and he stayed. Each is still trying to understand the other’s choice.'], ['Sera', 'Friend · a place to return', 'Sera makes room for her without demanding an explanation.', 'Mira worries that accepting help will make her a burden.']]) {
          button('Add relationship').click(); const target = document.querySelector('[aria-label="Related character"]'); target.value = [...target.options].find(option => option.textContent === name).value; const input = document.querySelector('[aria-label="New relationship label"]'); input.value = label; button('Create relationship').click(); set('What connects them', bond); set('Where it hurts', tension); set('What changes with context', 'Quieter in company. More honest when they are alone.');
        }
        button('Character Overview').click(); const choice = document.querySelector('[aria-label="Overview writing field"]'); choice.value = 'essence/one-line-description'; choice.dispatchEvent(new Event('change'));
      }

    } finally { busy = false; controls.dataset.ready = kind; }
  };
  for (const [kind, label] of [['demo', 'Demo data'], ['worst', 'Worst case'], ['empty', 'Empty'], ['one', 'One']]) { const control = document.createElement('button'); control.textContent = label; control.addEventListener('click', () => seed(kind).catch(console.error)); controls.append(control); }
  document.body.append(controls); window.characterFixture = seed;
  await seed(new URLSearchParams(location.search).get('fixture') ?? 'demo');
}
