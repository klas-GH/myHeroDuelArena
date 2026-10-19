# myHeroDuelArena

A browser tactics duel. Two legions fight over a shared 10 × 4 field. The blue
legion is yours; the crimson legion is played by a deterministic tactical AI
that scores every legal action and takes the best one.

No build step, no dependencies, no network calls — `index.html` is the app.

```
open index.html
```

## v1.2.1 — what is in this release

| Area | Summary |
| --- | --- |
| Selection fix | The blue legion could not be selected with the mouse. The two unit layers overlap completely, and the layer on top swallowed every click. The containers now ignore pointer events and only the units accept them. |
| Octagonal field | Movement, reach, weapon range and ability radii all measure the octagonal way: the longest axis decides. A diagonal step costs the same as a straight one, and melee reaches the eight cells around a unit. |
| Tighter formation | Nine fighters per side instead of eleven: two of every kind except the champion. The two foot soldiers and the two chevaliers hold the front rank, the two ballista and the two archers hold the middle column, and the champion guards the rear. The whole army gives up one column, so the no man's land between the lines widens to four columns. |
| Balance | Ranged numbers follow the new distance rule: archer 3, ballista 4, support radii 1. The abilities describe their new reach. |
| The champion's bow | The champion fights with its own blow (20 ATK, arm's length) and can also loose an arrow (16 ATK, three cells) when it wants to fight from a distance. The arrow hits softer, so the champion stays the strongest fighter without becoming a better archer than the archers. |
| Interface | A click on the field before the battle starts now says what to do next and pulses the start control. |

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
node verify_render.js   # real rendering and real mouse input in headless Edge
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
