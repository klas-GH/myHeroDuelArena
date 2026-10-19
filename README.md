# myHeroDuelArena

A browser tactics duel. Two legions fight over a shared 10 × 4 field. The blue
legion is yours; the crimson legion is played by a deterministic tactical AI
that scores every legal action and takes the best one.

No build step, no dependencies, no network calls — `index.html` is the app.

```
open index.html
```

## v1.3.0 — what is in this release

| Area | Summary |
| --- | --- |
| Four battlefields | The ground is chosen before the fight. The Old Frontier, The Forest March, The Broken Pass and The High Ground are all handcrafted, all mirror symmetric, and all hold both armies. Each card shows a picture of its own terrain. |
| Difficulty | Easy, Normal and Hard. The difficulty never touches the rules: it changes how the crimson legion thinks — how eagerly it closes, how much it fears a trade, how hard it hunts your champion and how much it leans on its abilities. The azure legion is never handicapped. |
| Damage-based experience | One point of experience for every five points of damage your legion actually lands. Damage that overshoots a dying target is not rewarded, because the target was already dead before the extra landed. |
| Post-battle report | Every battle ends with a report: rounds, damage dealt and taken, enemies felled, friends lost, and the exact experience that was paid out, broken down. |
| Balance harness | `balance.js` fights battles headlessly, with a seed, and reports what actually happened: win rates, round counts, damage and experience per configuration, as JSON. |
| AI fix | A unit that had walked past its enemy used to keep marching off the field, and the battle could never end. The pull toward the enemy now turns around. |

### The four battlefields

| Map | Ground | What it asks for |
| --- | --- | --- |
| The Old Frontier | Open grass, two high-ground rises in the centre, forest and scattered stone | The even fight. The default. |
| The Forest March | Deep wood on both flanks, high ground down the middle | Cover for whoever holds the flanks. |
| The Broken Pass | A fallen wall across one lane, rock ridges either side | The army has to split and find a way through. |
| The High Ground | A raised plateau across the centre, forest on the outer lanes | Whoever holds the middle shoots for free. |

Every map obeys the same three rules, so the choice is always about tactics
and never about who gets the better ground:

1. **Mirror symmetry.** Every row reads the same from left to right and from
   right to left, so both armies start on identical terrain and meet on
   identical terrain.
2. **Valid ground.** Every deployment slot of both armies sits on passable
   ground, and a fighter with a single movement point can always walk from the
   azure lines to the crimson lines. A map that walls a unit type out of the
   battle is broken, however good it looks.
3. **At least four terrains**, so every map asks for a different plan instead
   of repeating one texture.

### The difficulty profiles

| Setting | What the crimson legion does |
| --- | --- |
| Easy | It hesitates, it under-reads the field, it rarely presses home and its blows land 2 points softer. |
| Normal | It fights the way it always has. Every weight is exactly one, so the default game is unchanged. |
| Hard | It reads the field, it pushes hard, it is less afraid of trading blows, it hunts your champion, it spends its abilities well and its blows land 2 points harder. |

### The balance harness

```
node balance.js --seeds=12
node balance.js --difficulty=hard --maps=high_ground --seeds=20 --out=report.json
node balance.js --deterministic          # the shipped rules, no exploration noise
```

The harness plays whole battles with the real engine, headless and without a
browser. The reference opponent is the azure legion, played by the same
tactical AI that plays the crimson legion — the AI never gets a private rule,
it uses the same movement, targeting, line of sight, damage and ability code
the player uses. The difficulty setting only ever changes the crimson legion,
so a difficulty is always measured against a fixed opponent.

Every run proves two things before it measures anything: the same seed
replays the same battle, and two different seeds play out differently. With
`--deterministic` the seed has no effect at all, because the shipped game has
no randomness.

### Measured results

`node balance.js --seeds=20` (20 seeds per configuration, damage scatter 0.08,
AI noise 2), 240 battles:

| Difficulty | Battlefield | Enemy wins | Win rate | Rounds | Damage | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | Old Frontier | 0 / 20 | 0 % | 12.3 | 490 | 448 |
| Easy | Forest March | 0 / 20 | 0 % | 11.7 | 490 | 448 |
| Easy | Broken Pass | 4 / 20 | 20 % | 21.0 | 459 | 395 |
| Easy | High Ground | 1 / 20 | 5 % | 17.1 | 466 | 418 |
| Normal | Old Frontier | 5 / 20 | 25 % | 11.7 | 443 | 383 |
| Normal | Forest March | 9 / 20 | 45 % | 11.8 | 437 | 352 |
| Normal | Broken Pass | 13 / 20 | 65 % | 18.2 | 408 | 333 |
| Normal | High Ground | 12 / 20 | 60 % | 14.3 | 435 | 339 |
| Hard | Old Frontier | 20 / 20 | 100 % | 7.0 | 236 | 134 |
| Hard | Forest March | 19 / 20 | 95 % | 7.1 | 215 | 132 |
| Hard | Broken Pass | 15 / 20 | 75 % | 14.0 | 382 | 302 |
| Hard | High Ground | 18 / 20 | 90 % | 9.6 | 350 | 224 |

What the numbers say:

- The gradient works. The crimson legion wins 0 % to 20 % of its Easy
  battles, 25 % to 65 % of its Normal ones and 75 % to 100 % of its Hard
  ones. The overall enemy win rate across all 240 battles is 48 %.
- On Normal the enemy is roughly even with the reference opponent (49 % on
  average), which is the point: Normal is meant to be a fair fight for a
  player who is better than the plain AI.
- The Broken Pass is the hardest ground for the azure legion, at every
  difficulty. It splits the army and the fight takes about six rounds longer
  than on open ground.
- The Old Frontier and the Forest March are the gentlest: the enemy needs
  Easy to lose them.
- Experience per battle sits between 130 and 450 depending on how the battle
  went. With the level thresholds at 100 / 250 / 450 / 700, a good battle
  earns a level and a bad one does not. The damage reward is a quarter of
  the total on a long battle and a third of it on a quick one.

### The field: hexagons, octagons, or the old grid?

The question was whether the battlefield should be rebuilt on a different
logical grid. All three options were weighed against the game that actually
exists — a rectangular field, a column axis that both armies advance along,
four lanes, a hand-drawn terrain map and a line-of-sight rule.

**Hexagons (6 neighbours)** are the cleanest movement model in theory: every
direction is equal, there is no diagonal bias, and range and line of sight
have exact answers. They are the wrong shape for this game. A 10 × 4 hex
field is not a rectangle; the rows offset, the four-lane battle line becomes
a zigzag, the mirror symmetry that keeps both armies on equal ground has to
be re-authored, and the terrain map, the positioning code, the AI and the
whole rendering would have to be rebuilt. The visual identity of the game —
two lines facing each other across a field — is exactly what a hex grid
breaks.

**Keeping the old grid (4 neighbours)** is the cheapest option and the safest
one, but it has a real flaw: a unit can never change lane sideways. With four
lanes and a footman that has one movement point, the lane a unit starts in
is the lane it stays in, and the only way across is a two-point detour. The
board becomes four corridors instead of one field, and the terrain rules
(the forest that blocks a shot, the rock that closes a gap) are far less
interesting when nobody can move around anything.

**Octagons (8 neighbours) on the existing square grid** win. The field stays
a rectangle, the column axis stays the axis both armies push along, the
terrain map and the rendering stay as they are, and the lane-lock disappears:
a unit can step into the neighbouring lane, slip around a forest, flank a
melee line or take a diagonal shot — all for one movement point. Distance is
measured one way everywhere, so a shot always reaches as far as a march.

The one rule the octagon model needs is a corner rule: a diagonal step is
refused when both cells it would slip between are blocked, whether by a rock
formation or by another fighter. A line of units therefore holds its ground,
and a gap in a wall is a real gap.

## The rules

**The field** is 10 columns × 4 rows. Column 0 is the far left, row 0 is the
lowest row on screen. Blue holds columns 0-2, red holds columns 7-9, and the
four columns between them are neutral ground.

**The armies** are nine fighters, two of every kind except the champion: two
foot soldiers and two chevaliers in the front rank, two ballista and two
archers in the middle column, the champion alone in the rear. Both sides
deploy identically and face the same kind of fighter in the same lane, and
the terrain map is mirrored around the centre line so neither side gets
better ground.

**A turn** gives every living unit one move and one attack, in any order.
Ending the turn hands the field to the AI, which plays its whole turn and
returns control.

**Distance** is octagonal. The longest axis decides, so a cell one column
and one row away is one step away. Movement, melee reach, weapon range and
ability radii all use that one rule.

**Attacks** need an unbroken line of sight. Forest and rock formations block
it, so a unit standing in cover has to be flanked.

**Defeat** is permanent for the battle. A dead unit leaves the field and its
experience is paid out once.

**The champion** is a stronger unit than the rest of the legion. It keeps the
same rules as everyone else, and it carries two weapons: its own blow (20 ATK
at arm's length) and a bow (16 ATK, three cells) for when it would rather
fight from a distance. Its three abilities are unlocked by progression rather
than by the battle:

| Ability | Unlocks | Cost | Effect |
| --- | --- | --- | --- |
| Rally Allies | level 1 | ability allowance | Adjacent allies gain +3 ATK and +2 DEF for one round. |
| Power Strike | level 2 | the attack action | A heavy melee blow that deals 8 extra damage. Two uses per battle. |
| Guarding Aura | level 3 | the whole turn | The champion and adjacent allies gain +3 DEF for two rounds. |

**Progression** is kept per browser. Experience is paid for the damage your
legion lands (one point for every five points of damage, overkill excluded),
for every defeated unit (15 to 60 depending on the kind, plus 40 more for the
enemy champion) and 50 for winning. Every level grants one ability point, and
levels 2 to 5 grant permanent HP, ATK and DEF bonuses. The `RESET` control in
the progression strip clears the profile, but asks for a confirmation first.

**The report** at the end of a battle shows what the fight was worth: the
rounds it lasted, the damage dealt and taken, the enemies felled, the friends
lost and the experience that was paid out, broken down into the damage, the
kills and the victory. Every reward is paid exactly once, however often the
end of the battle is checked.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | The page: selector, battlefield, panels, and the embedded SVG unit symbols. |
| `style.css` | All styling, including the responsive rules. |
| `game.js` | The whole game: rules, terrain, maps, difficulty, AI, rendering and persistence. |
| `test_harness.js` | The DOM stub and sandbox loader shared by the test suites. |
| `regression.js` | Rule-level suite; drives the real engine through the harness. |
| `smoke_quick.js` | DOM and wiring suite; boots the real page in the stub. |
| `verify_render.js` | Render suite; drives the real page in headless Edge. |
| `balance.js` | Balance harness; plays seeded battles headlessly and reports the results. |

## Tests

All four suites run on Node without any dependency:

```
node regression.js      # rules, terrain, maps, difficulty, progression, AI
node smoke_quick.js     # DOM wiring, stylesheet contract, runtime flow
node verify_render.js   # real rendering and real mouse input in headless Edge
node balance.js         # seeded balance measurement, JSON out
```

`regression.js` and `smoke_quick.js` load the shipped `game.js` into a
sandboxed DOM stub (`test_harness.js`) instead of re-implementing the rules,
so a test can never pass while the game disagrees. `verify_render.js` needs
Microsoft Edge and checks the real layout: sprites, geometry, marker
alignment, terrain hit-testing, the interface panels, the responsive
breakpoints, and a real mouse click on a unit — synthetic DOM events skip
the hit test, and that is exactly how the selection bug of v1.2.0 survived
the earlier suites.

The suites expose their results as `=== Results: N passed, M failed ===` and
exit with a non-zero status when something fails.
