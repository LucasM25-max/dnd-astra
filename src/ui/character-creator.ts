import {
  ABILITIES, ABILITY_NAMES, availableCantrips, availableSkillChoices, availableSpells,
  BACKGROUNDS, CLASSES, formatModifier, PERSONALITIES, POINT_BUY_COST, PRONOUNS,
  requiredCantripCount, requiredSkillCount, requiredSpellCount, SPECIES, STANDARD_ARRAY,
  validateDraft, withDefaultChoices, type CharacterDraft,
} from '../game/character';
import { ARMOR, WEAPONS } from '../game/equipment';
import { SPELLS } from '../game/spells';
import type { Ability, Skill } from '../game/rules';

/**
 * Character creation.
 *
 * The previous version offered a single "bonus skill" dropdown regardless of
 * how many skills the class actually grants, never re-rendered when the class
 * changed (so the skill list went stale and produced invalid drafts), had no
 * cantrip or spell pickers at all, and let ability scores be typed freely with
 * no point-buy or standard-array enforcement.
 *
 * This version derives every control from the rules data, so the form can only
 * ever produce a legal level-1 character, and it explains its own arithmetic.
 */

const escapeHtml = (text: string) => text
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const titleCase = (text: string) => text.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

/** The exact coin/kit a class starts with, read from the rules rather than hardcoded. */
function startingKit(draft: CharacterDraft) {
  const klass = CLASSES[draft.classId];
  const loadout = klass.startingLoadout;
  const pieces: string[] = [];
  if (loadout.armor) pieces.push(ARMOR[loadout.armor].name);
  if (loadout.shield) pieces.push('Shield');
  for (const id of klass.startingWeapons) pieces.push(WEAPONS[id]?.name ?? id);
  return pieces;
}

export class CharacterCreator {
  draft: CharacterDraft;

  constructor(draft: CharacterDraft) {
    this.draft = withDefaultChoices(draft);
  }

  /** Point-buy spend for the current spread. */
  private pointsSpent() {
    return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[this.draft.abilities[a]] ?? 0), 0);
  }

  /**
   * Applies a change and re-derives every dependent choice, so switching class
   * can never leave an illegal skill or spell selected.
   */
  update(field: string, value: string, checked?: boolean): void {
    const d = this.draft;
    switch (field) {
      case 'name': d.name = value.slice(0, 32); return;      // no re-derive needed
      case 'pronouns': d.pronouns = value; break;
      case 'personality': d.personality = value; break;
      case 'species': d.species = value as CharacterDraft['species']; break;
      case 'class':
        d.classId = value as CharacterDraft['classId'];
        // The array is assigned by class priority, so a new class must
        // re-sort it — a wizard should not be left with Intelligence 12.
        this.resetAbilities();
        break;
      case 'background': d.background = value as CharacterDraft['background']; break;
      case 'method': d.method = value as CharacterDraft['method']; this.resetAbilities(); break;
      // Deliberate picks are never auto-refilled: unchecking a skill must
      // leave it unchecked so the player can choose a different one, even
      // though that briefly makes the draft incomplete.
      case 'skill': this.toggle('skillChoices', value, checked, requiredSkillCount(d)); return;
      case 'cantrip': this.toggle('cantripChoices', value, checked, requiredCantripCount(d)); return;
      case 'spell': this.toggle('spellChoices', value, checked, requiredSpellCount(d)); return;
      default:
        if (field.startsWith('ability-')) {
          const ability = field.slice(8) as Ability;
          d.abilities[ability] = Math.max(3, Math.min(20, Number(value) || 8));
        }
    }
    // Re-derive: class/species/background changes can invalidate earlier picks.
    this.draft = withDefaultChoices(d);
  }

  /** Standard array and point buy start from different legal defaults. */
  private resetAbilities() {
    const d = this.draft;
    if (d.method === 'standardArray') {
      const [a, b, c, e, f, g] = STANDARD_ARRAY;
      const order = CLASSES[d.classId].primary;
      const rest = ABILITIES.filter(x => !order.includes(x));
      const scores = [a, b, c, e, f, g];
      const assigned = {} as Record<Ability, number>;
      [...order, ...rest].forEach((ability, i) => { assigned[ability] = scores[i]; });
      d.abilities = assigned;
    } else {
      d.abilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      // Spend the budget on the class's primary abilities first.
      for (const ability of [...CLASSES[d.classId].primary, 'con' as Ability]) {
        while (d.abilities[ability] < 15 && this.pointsSpentFor(d.abilities) + (POINT_BUY_COST[d.abilities[ability] + 1] - POINT_BUY_COST[d.abilities[ability]]) <= 27) {
          d.abilities[ability]++;
        }
      }
    }
  }

  private pointsSpentFor(abilities: Record<Ability, number>) {
    return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[abilities[a]] ?? 0), 0);
  }

  private toggle(key: 'skillChoices' | 'cantripChoices' | 'spellChoices', value: string, checked: boolean | undefined, limit: number) {
    const list = this.draft[key] as string[];
    const has = list.includes(value);
    if (checked === false || (checked === undefined && has)) {
      this.draft[key] = list.filter(v => v !== value) as never;
    } else if (!has) {
      // Keep the newest pick and drop the oldest once the limit is reached.
      const next = [...list, value];
      this.draft[key] = (next.length > limit ? next.slice(next.length - limit) : next) as never;
    }
  }

  /** Blocking problems, phrased for a player rather than a validator. */
  get problems() { return validateDraft(this.draft); }
  get valid() { return this.problems.length === 0; }

  render(): string {
    const d = this.draft;
    const species = SPECIES[d.species], klass = CLASSES[d.classId], background = BACKGROUNDS[d.background];

    const option = (value: string, label: string, selected: boolean, hint?: string) =>
      `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}${hint ? ` — ${escapeHtml(hint)}` : ''}</option>`;

    const field = (name: string, label: string, options: string, note?: string) => `
      <label class="cc-field">
        <span class="cc-label">${escapeHtml(label)}</span>
        <select data-character="${name}">${options}</select>
        ${note ? `<small class="cc-note">${escapeHtml(note)}</small>` : ''}
      </label>`;

    // --- abilities -------------------------------------------------------
    const spent = this.pointsSpent();
    const budgetLeft = 27 - spent;
    // Humans take +1 to everything via allAbilities rather than a per-ability map.
    const bonusFor = (a: Ability) => (species.abilityBonuses?.[a] ?? 0) + (species.allAbilities ?? 0);

    const abilityRows = ABILITIES.map(a => {
      const score = d.abilities[a];
      const bonus = bonusFor(a);
      const total = score + bonus;
      return `
        <div class="cc-ability ${klass.primary.includes(a) ? 'primary' : ''}">
          <span class="cc-ability-name">${ABILITY_NAMES[a]}${klass.primary.includes(a) ? '<i title="Primary ability for this class">★</i>' : ''}</span>
          <div class="cc-ability-controls">
            <button type="button" data-ability-step="${a}:-1" aria-label="Lower ${ABILITY_NAMES[a]}">−</button>
            <strong>${score}</strong>
            <button type="button" data-ability-step="${a}:1" aria-label="Raise ${ABILITY_NAMES[a]}">+</button>
          </div>
          <span class="cc-ability-total">${bonus ? `<b>+${bonus}</b> → ${total}` : `${total}`} <em>${formatModifier(Math.floor((total - 10) / 2))}</em></span>
        </div>`;
    }).join('');

    // --- choice groups ---------------------------------------------------
    const skillPool = availableSkillChoices(d);
    const skillsNeeded = requiredSkillCount(d);
    const granted = [...new Set([...(background.skills ?? []), ...(species.skills ?? [])])] as Skill[];
    const skillGroup = skillsNeeded ? `
      <div class="cc-group">
        <div class="cc-group-head">
          <strong>Skills</strong>
          <span class="${d.skillChoices.length === skillsNeeded ? 'ok' : 'todo'}">${d.skillChoices.length}/${skillsNeeded} chosen</span>
        </div>
        <div class="cc-chips">
          ${skillPool.map(skill => `
            <label class="cc-chip ${d.skillChoices.includes(skill) ? 'on' : ''}">
              <input type="checkbox" data-character="skill" value="${skill}" ${d.skillChoices.includes(skill) ? 'checked' : ''}>
              <span>${titleCase(skill)}</span>
            </label>`).join('')}
        </div>
        ${granted.length ? `<small class="cc-note">Already yours from ${escapeHtml(background.name)}${species.skills?.length ? ` and ${escapeHtml(species.name)}` : ''}: ${granted.map(titleCase).join(', ')}.</small>` : ''}
      </div>` : '';

    const cantripPool = availableCantrips(d), cantripsNeeded = requiredCantripCount(d);
    const cantripGroup = cantripsNeeded ? `
      <div class="cc-group">
        <div class="cc-group-head">
          <strong>Cantrips</strong>
          <span class="${d.cantripChoices.length === cantripsNeeded ? 'ok' : 'todo'}">${d.cantripChoices.length}/${cantripsNeeded} chosen</span>
        </div>
        <div class="cc-chips">
          ${cantripPool.map(id => `
            <label class="cc-chip ${d.cantripChoices.includes(id) ? 'on' : ''}" title="${escapeHtml(SPELLS[id]?.description ?? '')}">
              <input type="checkbox" data-character="cantrip" value="${id}" ${d.cantripChoices.includes(id) ? 'checked' : ''}>
              <span>${escapeHtml(SPELLS[id]?.name ?? id)}</span>
            </label>`).join('')}
        </div>
      </div>` : '';

    const spellPool = availableSpells(d), spellsNeeded = requiredSpellCount(d);
    const spellGroup = spellsNeeded ? `
      <div class="cc-group">
        <div class="cc-group-head">
          <strong>First-level spells</strong>
          <span class="${d.spellChoices.length === spellsNeeded ? 'ok' : 'todo'}">${d.spellChoices.length}/${spellsNeeded} chosen</span>
        </div>
        <div class="cc-chips">
          ${spellPool.map(id => `
            <label class="cc-chip ${d.spellChoices.includes(id) ? 'on' : ''}" title="${escapeHtml(SPELLS[id]?.description ?? '')}">
              <input type="checkbox" data-character="spell" value="${id}" ${d.spellChoices.includes(id) ? 'checked' : ''}>
              <span>${escapeHtml(SPELLS[id]?.name ?? id)}</span>
            </label>`).join('')}
        </div>
      </div>` : '';

    // --- live derived sheet ----------------------------------------------
    // Derived headline numbers, computed directly so the preview stays live
    // even while the draft is still incomplete and cannot be finalized.
    const preview = (() => {
      const con = d.abilities.con + bonusFor('con');
      const dex = d.abilities.dex + bonusFor('dex');
      const wis = d.abilities.wis + bonusFor('wis');
      const conMod = Math.floor((con - 10) / 2);
      const hp = klass.hitDie + conMod;
      const armor = klass.startingLoadout.armor ? ARMOR[klass.startingLoadout.armor] : undefined;
      const ac = (armor ? (armor.addsDex ? armor.baseAc + Math.min(Math.floor((dex - 10) / 2), armor.dexCap ?? 99) : armor.baseAc) : 10 + Math.floor((dex - 10) / 2))
        + (klass.startingLoadout.shield ? 2 : 0)
        + (d.classId === 'fighter' ? 1 : 0);
      return { hp, ac, initiative: Math.floor((dex - 10) / 2), perception: 10 + Math.floor((wis - 10) / 2) };
    })();

    const problems = this.problems;

    return `
      <div class="cc">
        <header class="cc-header">
          <div class="dialog-eyebrow">A NEW STORY BEGINS WITH YOU</div>
          <h2 id="dialog-title">Make your adventurer.</h2>
          <p class="dialog-description">Every choice here follows the Player's Handbook. The sheet on the right updates as you go.</p>
        </header>

        <div class="cc-body">
          <div class="cc-main">
            <div class="cc-row">
              <label class="cc-field wide">
                <span class="cc-label">Name</span>
                <input data-character="name" maxlength="32" placeholder="Name your adventurer" value="${escapeHtml(d.name)}" autocomplete="off" spellcheck="false">
              </label>
              ${field('pronouns', 'Pronouns', PRONOUNS.map(p => option(p, p, d.pronouns === p)).join(''))}
            </div>

            <div class="cc-row">
              ${field('species', 'Species', Object.values(SPECIES).map(o => option(o.id, o.name, d.species === o.id)).join(''), species.summary)}
              ${field('class', 'Class', Object.values(CLASSES).map(o => option(o.id, o.name, d.classId === o.id)).join(''), klass.summary)}
            </div>

            <div class="cc-row">
              ${field('background', 'Background', Object.values(BACKGROUNDS).map(o => option(o.id, o.name, d.background === o.id)).join(''), background.summary)}
              ${field('personality', 'Temperament', PERSONALITIES.map(o => option(o.id, o.name, d.personality === o.id)).join(''), PERSONALITIES.find(p => p.id === d.personality)?.text)}
            </div>

            <div class="cc-group">
              <div class="cc-group-head">
                <strong>Ability scores</strong>
                <div class="cc-method">
                  <button type="button" data-character="method" data-value="standardArray" class="${d.method === 'standardArray' ? 'on' : ''}">Standard array</button>
                  <button type="button" data-character="method" data-value="pointBuy" class="${d.method === 'pointBuy' ? 'on' : ''}">Point buy</button>
                </div>
              </div>
              <div class="cc-abilities">${abilityRows}</div>
              <small class="cc-note">
                ${d.method === 'standardArray'
                  ? `Assign 15, 14, 13, 12, 10 and 8 — each exactly once. ★ marks this class's key abilities.`
                  : `<b class="${budgetLeft === 0 ? 'ok' : budgetLeft < 0 ? 'bad' : 'todo'}">${budgetLeft}</b> of 27 points left. Scores run 8–15 before species bonuses.`}
              </small>
            </div>

            ${skillGroup}
            ${cantripGroup}
            ${spellGroup}
          </div>

          <aside class="cc-sheet">
            <div class="cc-sheet-name">
              <strong>${escapeHtml(d.name.trim() || 'Unnamed')}</strong>
              <span>${escapeHtml(species.name)} ${escapeHtml(klass.name)} · ${escapeHtml(background.name)}</span>
            </div>
            <div class="cc-stats">
              <div><b>${preview.hp}</b><span>Hit points</span></div>
              <div><b>${preview.ac}</b><span>Armour class</span></div>
              <div><b>${formatModifier(preview.initiative)}</b><span>Initiative</span></div>
              <div><b>${preview.perception}</b><span>Passive perception</span></div>
            </div>
            <div class="cc-sheet-block">
              <h4>Features</h4>
              <ul>${klass.features.filter(f => f.level <= 1).map(f => `<li><b>${escapeHtml(f.name)}</b> ${escapeHtml(f.text)}</li>`).join('')}</ul>
            </div>
            ${species.traits.length ? `<div class="cc-sheet-block">
              <h4>${escapeHtml(species.name)} traits</h4>
              <ul>${species.traits.map(t => `<li><b>${escapeHtml(t.name)}</b> ${escapeHtml(t.text)}</li>`).join('')}</ul>
            </div>` : ''}
            <div class="cc-sheet-block">
              <h4>Starting equipment</h4>
              <ul><li>${startingKit(d).map(escapeHtml).join('</li><li>')}</li></ul>
            </div>
            <div class="cc-sheet-block">
              <h4>${escapeHtml(background.name)} feature</h4>
              <ul><li><b>${escapeHtml(background.feature.name)}</b> ${escapeHtml(background.feature.text)}</li></ul>
            </div>
          </aside>
        </div>

        ${problems.length ? `<div class="cc-problems">${problems.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>` : ''}

        <footer class="cc-footer">
          <button data-action="character-cancel">Not yet</button>
          <button class="primary-action" data-action="character-create" ${this.valid ? '' : 'disabled'}>
            Begin as ${escapeHtml(d.name.trim() || 'your adventurer')}
          </button>
        </footer>
        <div class="dialog-footnote">Creating a character starts a new game and clears the current chapter save.</div>
      </div>`;
  }
}

export { titleCase };
