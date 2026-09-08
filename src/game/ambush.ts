/**
 * The Cragmaw ambush on the Triboar Trail.
 *
 * Four goblins hide in the thickets, two on either side of the road, and
 * spring when someone approaches the looted horses. They fight until one
 * remains, and that survivor breaks for the goblin trail rather than dying in
 * place. All numbers come from the adventure and the Monster Manual; all
 * spoken and written text here is original.
 */
import type { Vec2 } from './encounter';

/** Where the looted horses stand, in world metres. */
export const AMBUSH_CENTRE: Vec2 = { x: 9.7, z: 2.0 };
/** Approaching within this many metres of the horses springs the trap. */
export const AMBUSH_TRIGGER_RADIUS = 4.2;
/** Mouth of the goblin trail; the last goblin runs for it. */
export const GOBLIN_TRAIL_MOUTH: Vec2 = { x: 12.4, z: -6.8 };

export interface AmbusherSpawn {
  id: string;
  monsterId: string;
  /** Hiding position in the thicket, world metres. */
  hide: Vec2;
  /** Where it breaks cover to when the ambush springs. */
  strike: Vec2;
  /** Which side of the road, for the reveal staging. */
  side: 'north' | 'south';
  name: string;
}

/** Two goblins on either side of the road, as written. */
export const AMBUSHERS: AmbusherSpawn[] = [
  { id: 'goblin-north-1', monsterId: 'goblin', name: 'Goblin in the thicket', side: 'north', hide: { x: 7.6, z: -2.6 }, strike: { x: 8.3, z: -0.4 } },
  { id: 'goblin-north-2', monsterId: 'goblinArcher', name: 'Goblin archer', side: 'north', hide: { x: 11.9, z: -3.1 }, strike: { x: 11.2, z: -0.9 } },
  { id: 'goblin-south-1', monsterId: 'goblin', name: 'Goblin in the bracken', side: 'south', hide: { x: 8.1, z: 6.4 }, strike: { x: 8.7, z: 4.3 } },
  { id: 'goblin-south-2', monsterId: 'goblinArcher', name: 'Goblin archer', side: 'south', hide: { x: 12.2, z: 6.1 }, strike: { x: 11.6, z: 4.1 } },
];

/**
 * Scatter left by the goblins ransacking Gundren's bags. Each entry is an
 * inspectable prop; the map case is the one that matters.
 */
export interface ScatterProp {
  id: string;
  kind: 'arrow' | 'fabric' | 'oddment' | 'mapCase' | 'saddlebag';
  position: Vec2;
  rotation: number;
  label: string;
  /** Shown when the player inspects it up close. */
  text: string;
  /** A skill check that reveals more, when one applies. */
  check?: { skill: 'investigation' | 'perception' | 'survival' | 'history'; dc: number; success: string; failure: string };
}

export const SCATTER: ScatterProp[] = [
  {
    id: 'map-case', kind: 'mapCase', position: { x: 10.35, z: 2.55 }, rotation: 0.7,
    label: 'An empty leather map case',
    text: 'A tube of stiffened leather, capped at one end and cut open at the other. Whatever it held is gone. The cut is fresh and impatient — someone opened it in a hurry and did not care about the case.',
    check: { skill: 'investigation', dc: 12, success: 'The stitching bears a dwarven maker\u2019s mark, and the inside is scuffed in a way only a rolled parchment leaves. This carried a map, and it was carried a long way.', failure: 'An empty case. Good leather, badly treated.' },
  },
  {
    id: 'saddlebag-near', kind: 'saddlebag', position: { x: 8.95, z: 1.75 }, rotation: -0.7,
    label: 'A looted saddlebag',
    text: 'The buckles have been cut rather than unfastened. Rations, a whetstone and a spare shirt lie trampled in the dirt beside it — nothing anyone took the trouble to steal.',
    check: { skill: 'perception', dc: 10, success: 'Whoever emptied this was searching, not robbing. They left coin behind and took only paper.', failure: 'Someone has been through it thoroughly.' },
  },
  {
    id: 'saddlebag-far', kind: 'saddlebag', position: { x: 10.6, z: 1.35 }, rotation: 1.15,
    label: 'A second saddlebag, turned out',
    text: 'Emptied and thrown aside. A dwarven travelling kit, by the size of the straps — short, thick, and built to last three winters.',
  },
  {
    id: 'fabric-1', kind: 'fabric', position: { x: 9.3, z: 3.1 }, rotation: 2.1,
    label: 'A torn scrap of fabric',
    text: 'Heavy wool in a deep green, ripped along a seam rather than cut. It has been ground into the mud by something with a small, flat foot.',
  },
  {
    id: 'fabric-2', kind: 'fabric', position: { x: 11.1, z: 2.85 }, rotation: -1.4,
    label: 'A strip of torn cloth',
    text: 'A shirt sleeve, or what remains of one. There is blood on it, dried brown, and not very much of it.',
  },
  {
    id: 'oddment-1', kind: 'oddment', position: { x: 9.05, z: 2.9 }, rotation: 0.4,
    label: 'A scattered oddment',
    text: 'A tin cup, a broken comb, and three iron nails, all flung in the same direction. Someone upended a bag and shook it.',
  },
  {
    id: 'oddment-2', kind: 'oddment', position: { x: 10.9, z: 1.9 }, rotation: -0.2,
    label: 'A dwarven whetstone',
    text: 'A good stone, oiled and squared, worth more than the coin left lying beside it. It was not worth stealing to whoever came through here.',
  },
];

/** Black-fletched arrows littering the site. */
export const SPENT_ARROWS: { position: Vec2; rotation: number; pitch: number }[] = [
  { position: { x: 9.42, z: 1.18 }, rotation: 0.62, pitch: 1.36 },
  { position: { x: 8.71, z: 2.64 }, rotation: -1.13, pitch: 1.48 },
  { position: { x: 10.28, z: 3.12 }, rotation: 2.31, pitch: 1.29 },
  { position: { x: 11.04, z: 1.42 }, rotation: -0.44, pitch: 1.51 },
  { position: { x: 9.86, z: 0.68 }, rotation: 1.72, pitch: 1.41 },
  { position: { x: 8.44, z: 1.02 }, rotation: 0.18, pitch: 1.33 },
  { position: { x: 11.42, z: 2.96 }, rotation: -2.02, pitch: 1.46 },
  { position: { x: 10.12, z: 3.74 }, rotation: 0.94, pitch: 1.38 },
];

/**
 * The horses belong to Gundren Rockseeker and Sildar Hallwinter. Recognising
 * them is automatic for anyone using the Phandalin hook.
 */
export const HORSE_IDENTIFICATION = {
  label: 'Two riderless horses',
  text: 'You know these animals. The chestnut is Gundren Rockseeker\u2019s — he complains about her constantly and refuses to sell her. The grey belongs to Sildar Hallwinter, who rides better than he admits. Neither is hurt. Neither has a rider.',
  detail: 'The saddlebags on both have been looted. An empty leather map case lies in the dirt nearby.',
};

/** The trail behind the northern thickets, found after the fight. */
export const TRAIL_DISCOVERY = {
  label: 'A trail behind the thickets',
  text: 'Behind the thickets on the north side of the road, the undergrowth has been beaten into a path. It runs northwest, away from the trail, and it has been used often.',
  check: {
    skill: 'survival' as const, dc: 10,
    success: 'About a dozen goblins have come and gone along this path, more than once. Two sets of heel-drag marks run the same way — human-sized bodies, hauled rather than carried. They were alive enough to be worth taking.',
    failure: 'Something has been using this path regularly. Small overlapping tracks suggest many goblins, and two broad drag marks run northwest, but you cannot make out an exact count or say whether the human-sized bodies were alive when they were taken.',
  },
  distanceMiles: 5,
};

/** Evidence that this site has been used for ambushes before. */
export const AFTERMATH_NOTE = 'Now that nothing is trying to kill you, the shape of the place is obvious. The thickets on both sides have been hollowed out from behind into shooting blinds. There are old arrow shafts trodden into the leaf litter, a cold fire pit behind the northern bank, and a heap of gnawed bones. This is not where an ambush happened. This is where ambushes happen.';

// ---------------------------------------------------------------------------
// Traps on the goblin trail
// ---------------------------------------------------------------------------

/** World-space pacing for the staged trail scene. A minute is compressed so
 * both module traps fit in the rendered approach while the destination remains
 * marked as five miles away in the fiction. */
export const TRAIL_METRES_PER_MINUTE = 75;

export interface TrailTrap {
  id: string;
  name: string;
  /** How far along the trail, in minutes of travel. */
  atMinutes: number;
  /** Derived world distance used by the physical hazard system. */
  atMetres: number;
  spot: { skill: 'perception'; dc: number };
  save: { ability: 'dex'; dc: number };
  damage: string;
  damageType: 'bludgeoning';
  description: string;
  onTrigger: string;
  onSpot: string;
  onSave: string;
}

export const TRAIL_TRAPS: TrailTrap[] = [
  {
    id: 'snare', name: 'Hidden snare', atMinutes: 10, atMetres: 10 * TRAIL_METRES_PER_MINUTE,
    spot: { skill: 'perception', dc: 15 }, save: { ability: 'dex', dc: 10 },
    damage: '1d6', damageType: 'bludgeoning',
    description: 'A weighted cord buried under the leaf litter, tensioned against a bent sapling.',
    onTrigger: 'The ground snaps. A cord closes around your ankle and the sapling above whips upright, hauling you ten feet into the air upside down. You are restrained until someone cuts the cord.',
    onSpot: 'A loop of cord, barely proud of the leaf litter, and above it a sapling bent into a bow. Step around it.',
    onSave: 'The cord grabs and you kick free of it, and the sapling snaps up through empty air.',
  },
  {
    id: 'pit', name: 'Camouflaged pit', atMinutes: 20, atMetres: 20 * TRAIL_METRES_PER_MINUTE,
    spot: { skill: 'perception', dc: 15 }, save: { ability: 'dex', dc: 10 },
    damage: '1d6', damageType: 'bludgeoning',
    description: 'Six feet across, ten feet deep, roofed with branches and a careful layer of leaves.',
    onTrigger: 'The path gives way underneath you and you drop ten feet onto packed earth. The walls are not steep — you can climb out — but the landing is not kind.',
    onSpot: 'The leaf litter here lies too evenly, and the branches beneath it do not belong to any tree still standing. A pit, and a well-made one.',
    onSave: 'The covering collapses and you throw yourself flat across the far lip, scrambling clear as the branches fall into the dark.',
  },
];

/** The trail's cord can be cut to lower a snared character safely. */
export const SNARE_CORD = { hp: 1, damageType: 'slashing' as const, note: 'One point of slashing damage cuts the cord. A character lowered carelessly takes 1d6 bludgeoning damage from the fall.' };

// ---------------------------------------------------------------------------
// Captured goblins
// ---------------------------------------------------------------------------

/**
 * A goblin dropped to zero by bludgeoning damage is knocked out instead of
 * killed, and can be questioned once it comes round.
 */
export const CAPTURE = {
  note: 'A goblin dropped to zero hit points by bludgeoning damage — a club, a quarterstaff, the flat of a blade, or your fists — is knocked unconscious rather than killed.',
  wakesAfterMinutes: 4,
  persuadeDc: 12,
  intimidateDc: 10,
  knowledge: [
    'The Cragmaws took the dwarf and his man alive and hauled them up the trail northwest.',
    'The hideout is a cave mouth five miles along, behind a stream and a screen of thorns.',
    'There are two traps on the way: a snare first, then a pit. A goblin who wants to keep breathing will walk you round both.',
    'A bugbear called Klarg holds the cave, and he answers to someone the goblins will not name aloud.',
  ],
  guideOffer: 'It will lead you to the hideout and walk you around both traps, if you make staying alive the more attractive option.',
};

/** What happens if the goblins win: unconscious, looted, and the road goes on. */
export const DEFEAT_OUTCOME = {
  text: 'The goblins do not finish you. They go through your pockets, cut the wagon\u2019s lashings, take what they can carry and head up the trail arguing about the split. You wake some time later in the leaf litter, cold, lighter, and still breathing.',
  note: 'You can go on to Phandalin, re-equip at Barthen\u2019s Provisions, come back, and pick up the trail whenever you choose.',
  keepsQuest: true,
};

/**
 * Encounter budget check: four CR 1/4 goblins is 200 XP raw, doubled to 400
 * by the group multiplier. That is deadly for a single first-level character
 * and a hard fight for a small party — which is exactly the intent.
 */
export const AMBUSH_XP_TOTAL = AMBUSHERS.length * 50;
