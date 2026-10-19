# myHeroDuelArena

A browser tactics duel. Two legions of five units each fight over a shared
10 × 4 field. The blue legion is yours; the crimson legion is played by a
deterministic tactical AI that scores every legal action and takes the best
one.

No build step, no dependencies, no network calls — `index.html` is the app.

```
open index.html
```

## v1.2.0 — what is in this release

| Area | Summary |
| --- | --- |
| Terrain | A fixed, mirror-symmetric battlefield with grass, forest, rocky ground, high ground and impassable rock formations. Terrain changes movement cost, adds defense, improves ranged aim and blocks line of sight. |
| Champion abilities | Every champion owns three abilities: **Rally Allies**, **Power Strike** and **Guarding Aura**. Each ability has a different action cost (ability / attack / whole turn) and its own uses per battle. |
| Progression | The champion earns experience from damage, defeats and victories, levels up to 5, gains permanent stat bonuses and ability points, and unlocks abilities by level. The profile is stored in `localStorage`. |
| Tactical AI | The enemy scores attacks, kills, target value, cover, elevation, threat, safety, support value and ability usage. The same battlefield always produces the same plan. |
| Interface | A progression strip, a champion panel, a level-up banner, terrain decoration, quick actions for ready abilities and a confirmation step before resetting a profile. |
| Responsiveness | The layout is checked at 1280, 820, 390 and 320 pixels wide, with a separate rule set for short viewports. |

## Rules

**The field** is 10 columns × 4 rows. Column 0 is the far left, row 0 is the
lowest row on screen. Both armies deploy identically, and the terrain map is
mirrored around the centre line so neither side gets better ground.

**A turn** gives every living unit one move and one attack, in any order.
Ending the turn hands the field to the AI, which plays its whole turn and
returns control.

**Attacks** need an unbroken line of sight. Forest and rock formations block
it, so a unit standing in cover has to be flanked.

**Defeat** is permanent for the battle. A dead unit leaves the field and its
experience is paid out once.

**The champion** is a stronger unit than the rest of the legion. It keeps the
same rules as everyone else, and its three abilities are unlocked by
progression rather than by the battle:

| Ability | Unlocks | Cost | Effect |
| --- | --- | --- | --- |
| Rally Allies | level 1 | ability allowance | Allies within 2 tiles gain +3 ATK and +2 DEF for one round. |
| Power Strike | level 2 | the attack action | A heavy melee blow that deals 8 extra damage. Two uses per battle. |
| Guarding Aura | level 3 | the whole turn | The champion and allies within 2 tiles gain +3 DEF for two rounds. |

**Progression** is kept per browser. Experience is paid for damage dealt
(roughly half the damage), for each defeated unit, and a bonus for winning.
Every level grants one ability point, and levels 2 to 5 grant permanent HP,
ATK and DEF bonuses. The `RESET` control in the progression strip clears the
profile, but asks for a confirmation first.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | The page: battlefield, panels, and the embedded SVG unit symbols. |
| `style.css` | All styling, including the responsive rules. |
| `game.js` | The whole game: rules, terrain, AI, rendering and persistence. |
| `test_harness.js` | The DOM stub and sandbox loader shared by the test suites. |
| `regression.js` | Rule-level suite; drives the real engine through the harness. |
| `smoke_quick.js` | DOM and wiring suite; boots the real page in the stub. |
| `verify_render.js` | Render suite; drives the real page in headless Edge. |

## Tests

All three suites run on Node without any dependency:

```
node regression.js      # rules, terrain, abilities, progression, AI
node smoke_quick.js     # DOM wiring, stylesheet contract, runtime flow
node verify_render.js   # real rendering in headless Edge
```

`regression.js` and `smoke_quick.js` load the shipped `game.js` into a
sandboxed DOM stub (`test_harness.js`) instead of re-implementing the rules,
so a test can never pass while the game disagrees. `verify_render.js` needs
Microsoft Edge and checks the real layout: sprites, geometry, marker
alignment, terrain hit-testing, the interface panels and the responsive
breakpoints.

The suites expose their results as `=== Results: N passed, M failed ===` and
exit with a non-zero status when something fails.
