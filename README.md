# myHeroDuelArena

A browser tactics duel. Two legions fight over a shared 10 × 4 field. The blue
legion is yours; the crimson legion is played by a deterministic tactical AI
that scores every legal action and takes the best one, and that weighs five
extra tactical questions harder the further you turn up the difficulty. You can
also hand both legions to the AI and watch the fight.

No build step, no dependencies, no network calls — `index.html` is the app.

```
open index.html
```

## v1.6.0 — what is in this release

| Area | Summary |
| --- | --- |
| The tactical depth | The crimson legion now asks five extra questions before it moves: does this blow end the unit, does the target threaten the army, would the trade kill me, was this step a waste, and does the next cell set up a kill. A difficulty decides how loudly the legion listens to each answer, so the rules of a fight never change — only the decisions do. |
| Damage numbers | Every blow writes its number over the unit it hit, so a fight can be read without following the log. The number is decoration: it never touches a rule, the ledger or the rewards. |
| A report that reads the ledger | The report now also names how many units were left standing, how much health was left, what settled the fight and whether it was a player battle or a watched one. Every number is read from the ledger of actions that really happened. |
| Spectator mode | The `SPECTATE — AI vs AI` control puts both legions on the field and hands them to the same tactical AI that plays the crimson legion. The player only watches: no experience, no rewards, no level, no change to the saved profile and nothing written to storage. |
| The round limit | No battle is ever fought for longer than 30 rounds. The counter stops there, and the battle is settled. |
| Sudden death | The 30th round is fought in sudden death: every blow counts for 1.5× more, for both armies alike, so a fight that reached the limit still ends in a decision. |
| How a battle at the limit is settled | Elimination comes first: a wiped out army loses, whatever the health says. If both armies are still standing, the one with more health left wins, and an even field is a draw. |
| Four battlefields | The ground is chosen before the fight. The Old Frontier, The Forest March, The Broken Pass and The High Ground are all handcrafted, all mirror symmetric, and all hold both armies. Each card shows a picture of its own terrain. |
| Difficulty | Easy, Normal and Hard. The difficulty never touches the rules: it changes how the crimson legion thinks — how eagerly it closes, how much it fears a trade, how hard it hunts your champion, how much it leans on its abilities, and how sharply it weighs the five tactical questions above. The azure legion is never handicapped. |
| Damage-based experience | One point of experience for every five points of damage your legion actually lands. Damage that overshoots a dying target is not rewarded, because the target was already dead before the extra landed. |
| Post-battle report | Every battle ends with a report: rounds, damage dealt and taken, enemies felled, friends lost, and the exact experience that was paid out, broken down. |
| Balance harness | `balance.js` fights battles headlessly, with a seed, and reports what actually happened: win rates, round counts, damage and experience per configuration, as JSON. |
| AI fix | A unit that had walked past its enemy used to keep marching off the field, and the battle could never end. The pull toward the enemy now turns around. |

### The round limit and sudden death

A battle is never fought for longer than **30 rounds**. The rule is enforced by
the engine, not by the caller: the round counter is checked every time a round
closes, and the battle cannot reach a 31st round.

The last round is fought in **sudden death**. Every blow in that round counts
for 1.5× more, for both armies alike, so a stalemate breaks instead of grinding
on. The banner says `ROUND 30 — SUDDEN DEATH` while it lasts.

When the limit is reached the field is settled in this order:

1. **Elimination first.** If one army has been wiped out, the other one won —
   the health comparison never runs. A battle that ends this way is a normal
   victory or defeat, and it pays its rewards like any other.
2. **Then the health left.** If both armies are still standing, the one with
   more total health wins.
3. **An even field is a draw.** The same health on both sides ends the battle
   as a draw: the result banner reads `DRAW — BOTH LEGIONS STAND`, the report
   names the outcome `DRAW`, and the battle pays the damage reward but no
   victory bonus.

The limit applies to the player, to the AI and to the spectator show alike,
and it is checked from the same code path, so there is no way around it.

### The spectator mode

`SPECTATE — AI vs AI` starts a battle in which the player has no legion at
all: the azure legion is played by the same tactical AI that plays the crimson
one, on the same rules, on the same map. The turn banner names the legion that
is thinking, the end turn control is gone and the progression strip dims.

A spectator battle pays **nothing**:

| What a player battle does | What a spectator battle does |
| --- | --- |
| Pays experience for damage, kills and victory | Pays nothing |
| Counts the battle and the win in the profile | Counts nothing |
| Raises the level and grants ability points | Raises nothing |
| Writes the profile to storage | Writes nothing |
| Adds the champion's permanent level bonuses to the fight | Fights both sides at base strength |

The isolation is enforced in one place — the reward gate — so there is no path
through the show that can touch the profile. The difficulty setting does not
apply to a spectator battle either: both armies fight by the normal rules, so
the show is always an even fight.

The show runs on its own quicker clock, and the round limit ends it exactly
like any other battle.

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
| Easy | It hesitates, it under-reads the field, it rarely presses home, its blows land 2 points softer and it listens to none of the five tactical questions. |
| Normal | It fights the way it always has, with every weight at one, and it listens to the five tactical questions with a light hand. |
| Hard | It reads the field, it pushes hard, it is less afraid of trading blows, it hunts your champion, it spends its abilities well, its blows land 2 points harder and it listens to the five tactical questions with a heavy hand. |

### The tactical depth

The AI scores every legal action and takes the best one. In v1.6.0 the score
asks five extra questions, and a difficulty decides how loudly the legion
listens to each answer:

| Question | What it adds |
| --- | --- |
| `elimination` | A blow that ends a unit is worth more than a blow that only wounds one. |
| `danger` | A unit that can reach your soft units is worth more than a unit that cannot reach anything. |
| `survival` | A trade the attacker cannot survive is a bad trade. |
| `waste` | Walking when a blow was already available is a wasted step. |
| `position` | A cell from which the next blow would end a unit is worth more than a cell that only looks closer. |

The weights are measured, not guessed. Every one of them was chosen with the
balance harness, fighting the same reference opponent over four battlefields
and forty seeds a map:

| Difficulty | `elimination` | `danger` | `survival` | `waste` | `position` | Enemy wins |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | 0 | 0 | 0 | 0 | 0 | 6 % |
| Normal | 0.35 | 0.2 | 0.35 | 0.35 | 0.2 | 51 % |
| Hard | 0.45 | 0.4 | 0.4 | 0.45 | 0.35 | 90 % |

The weights change decisions and nothing else. The damage of a blow, the
movement, the line of sight and the abilities are the same at every
difficulty — only the legion's mind is different. The azure legion always
plays by the normal weights, so the difficulty never handicaps the player,
and a spectator show gives both armies the same weights, so the show stays an
even fight.

The numbers in the last column are the enemy win rate against the reference
opponent over 480 battles. The same weights at full strength won 60 % of
Normal and 98 % of Hard battles: a stronger legion is a better legion, but a
legion that wins every battle is not a difficulty, it is a wall.

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

`node balance.js --seeds=40` (40 seeds per configuration, damage scatter 0.08,
AI noise 2), 480 battles, engine v1.6.0:

| Difficulty | Battlefield | Enemy wins | Win rate | Rounds | Damage | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | Old Frontier | 0 / 40 | 0 % | 11.7 | 490 | 448 |
| Easy | Forest March | 0 / 40 | 0 % | 11.5 | 490 | 448 |
| Easy | Broken Pass | 7 / 40 | 18 % | 19.2 | 471 | 421 |
| Easy | High Ground | 3 / 40 | 8 % | 15.4 | 473 | 426 |
| Normal | Old Frontier | 9 / 40 | 23 % | 13.1 | 468 | 410 |
| Normal | Forest March | 23 / 40 | 58 % | 11.5 | 421 | 329 |
| Normal | Broken Pass | 23 / 40 | 58 % | 19.4 | 437 | 368 |
| Normal | High Ground | 27 / 40 | 68 % | 13.2 | 395 | 293 |
| Hard | Old Frontier | 40 / 40 | 100 % | 7.3 | 222 | 131 |
| Hard | Forest March | 40 / 40 | 100 % | 6.8 | 188 | 112 |
| Hard | Broken Pass | 31 / 40 | 78 % | 14.1 | 374 | 299 |
| Hard | High Ground | 33 / 40 | 83 % | 9.8 | 358 | 242 |

What the numbers say:

- The gradient works. The crimson legion wins 6 % of its Easy battles, 51 %
  of its Normal ones and 90 % of its Hard ones. The overall enemy win rate
  across all 480 battles is 49 %, and the reference opponent wins 51 %.
- On Normal the enemy is an even opponent, which is the point: Normal is
  meant to be a fair fight for a player who is better than the plain AI.
- The Broken Pass is the hardest ground for the azure legion, at every
  difficulty. It splits the army and the fight takes about six rounds longer
  than on open ground.
- The Old Frontier and the Forest March are the gentlest: the enemy needs
  Easy to lose them.
- Experience per battle sits between 110 and 450 depending on how the battle
  went. With the level thresholds at 100 / 250 / 450 / 700, a good battle
  earns a level and a bad one does not.

#### The same measurement against v1.5.0

The identical seeds, the identical maps, the identical harness, 480 battles a
side:

| Difficulty | v1.5.0 enemy wins | v1.6.0 enemy wins | Change |
| --- | --- | --- | --- |
| Easy | 6.9 % | 6.3 % | −0.6 points |
| Normal | 46.9 % | 51.3 % | +4.4 points |
| Hard | 86.9 % | 90.0 % | +3.1 points |
| All | 46.9 % | 49.2 % | +2.3 points |

The average battle is 12.74 rounds in v1.6.0 and 12.90 in v1.5.0, no
configuration reached the round limit, and both versions replayed the same
seed exactly in 12 configurations out of 12 and changed with a different seed
in 12 out of 12.

So the tactical depth makes the crimson legion a little sharper — four points
on Normal, three on Hard — without turning Normal into a wall or Hard into
an impossibility. The same measurement with the weights at full strength
gives 60 % on Normal and 98 % on Hard, which is why the shipped weights are
the measured ones and not the first ones that were written down.

`node balance.js --deterministic --seeds=20` plays the same 240 battles with
the shipped rules — no scatter, no AI noise. There the seed changes nothing
(0 of 12 configurations changed with the seed, in both versions), every
battle is decided by elimination before the limit, and the azure legion wins
every Easy and every Normal battle: 75 % of all battles in v1.6.0 against
67 % in v1.5.0, the difference being the two Hard battlefields the crimson
legion now takes. The exploration settings above are the ones that measure
the game; the deterministic run measures the one exact fight a player gets
on each ground.

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

**The round limit** is 30. No battle runs longer than that. The last round is
fought in sudden death, where every blow counts for 1.5× more, and a battle
that reaches the limit without an elimination is settled on the health each
army has left: the stronger army wins, an even field is a draw.

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
kills and the victory. Since v1.6.0 it also says how many units were left
standing, how much health was left on the field, what settled the fight
(`ELIMINATION`, `ROUND LIMIT` or `EVEN ARMIES`) and whether it was a player
battle or a watched one. Every reward is paid exactly once, however often the
end of the battle is checked.

**Spectating** puts both legions under AI control and takes the player out of
the fight. A watched battle is a display, not a battle the player took part
in, so it pays nothing at all: no experience, no rewards, no level and no
change to the saved profile.

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
node regression.js      # rules, terrain, maps, difficulty, progression, AI, round limit, spectator, tactical depth
node smoke_quick.js     # DOM wiring, stylesheet contract, runtime flow, damage numbers
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
exit with a non-zero status when something fails. The current counts are 617
rule assertions, 167 DOM assertions and 145 render assertions.
