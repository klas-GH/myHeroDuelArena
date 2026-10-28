# Changelog

Newest first. Versions 1.12.3 – 1.12.9 are summarised from the commit log; the
older notes are kept as they were written.

## v1.12.13 — Troop mode no longer freezes

- **Fixed: the game froze in Troop mode** ("this fighter has already acted"
  and nothing could be moved or attacked). In Troop mode the fighter that acts
  is found through the selection, but a blow and a defence stand clear the
  selection *before* the turn is handed over, so the fighter was never marked
  as having acted. It stayed "ready" although it had already struck or braced,
  was offered again, refused every order, and the round could never close.
  The acting fighter is now named explicitly by the move, the blow, the
  defence stand and the ability, so it is always marked.
- A fighter that has moved, struck or braced now counts as spent in Troop mode
  even if the round flag was somehow missed, so the same freeze cannot come
  back by another road.
- An ability now spends the activation in Troop mode (it never handed the turn
  over before).
- A crimson fighter with nothing to do, or whose order was refused, now passes
  its activation instead of being asked again for ever.
- END TURN pressed by hand in Troop mode means "I am done": when the crimson
  legion has nothing left to do, the fighters that did not act hold their
  ground and the round closes. A fighter with no legal action (boxed in, with
  nothing in reach) can no longer hold the round open.
- The turn banner no longer stays on "ENEMY TURN" while it is your turn.
- Measured: before the fix a random-clicking player got stuck in round 1 on
  every seed tried. After the fix six whole duels in Troop mode (two or three
  matches each, up to 30 rounds) and two in Party mode ran to the end with no
  stall and no error.
- Tests: new section 99. 926 rule assertions.

## v1.12.12 — the field is columns 2–7 for both armies

- **Fixed: fighters could walk behind the enemy's back rank.** Each army was
  only stopped from retreating behind its *own* starting edge, so blue could
  roam columns 2–9 and red columns 0–7, which made the field wider for whoever
  went past. The two outermost starting columns (2 and 7) are now the edges of
  the field for both armies. The check covers the whole picture, so the
  two-column champion cannot stick out past an edge either (blue champion may
  stand on columns 2–6, red champion on 3–7).
- Measured before the fix: in 48 AI battles over every map and difficulty, units
  were found outside the field 1,288 times; after the fix, none in 1,976 turns.
- Balance is essentially unchanged (enemy win rate on Normal 70% → 65%, no
  stalemates or timeouts).
- Tests: new section 98. 

## v1.12.11 — animations also with "reduce motion" on

- **Fixed: no combat animations when the operating system asks for reduced
  motion** (Windows "animation effects" off, macOS "reduce motion", many remote
  desktops). The reduced-motion block switched off every animation of the acting
  legion with `!important`, plus the slide transition, so marches jumped,
  nothing swung and nothing was drawn or released. It now removes only the
  decorative and looping effects (entrance, idle breathing, glows, thinking
  pulse, selection pulse, hit-shake) and keeps the short, small movements that
  tell the player what happened: the march slide, wind-up, lunge, bow draw and
  release.
- Arrows and bolts are about twice as big, with a trail and a stronger glow, so
  a shot can be seen against the large troop pictures.
- Tests: new section 97 (the reduced-motion rule). 891 rule assertions.

## v1.12.10 — bug-fix release

- **Fixed: the acting legion's animations were invisible.** The "thinking"
  pulse and the action animations (march hop, wind-up, lunge, bow draw, release)
  both set `animation` on the same element, and the pulse came later in the
  stylesheet, so it replaced all of them. This hid every march, strike and shot
  in AI vs AI and every move of the crimson legion in Hum vs AI. The pulse now
  steps aside while a fighter is mid-action. Only the target's hit-shake was
  ever visible before.
- **Fixed: chevalier and champion charged through walls.** A charge only checked
  that a free cell existed next to the target, then placed the unit there with no
  route. A charge now has to be walkable: passable ground, no fighter in the way
  and the usual corner rule for diagonal steps. The distance is still unlimited
  (`CHARGE_MAX_STEPS`, which can be set to a number). The fallback that could put
  the charger *behind* its target (a blade never cuts backwards) is gone.
- Fixed: `index.html` linked a `favicon.ico` that does not exist (a 404 on any host).
- Fixed: `startSrvLocal.bat` had a hard-coded `D:/` path; it now serves its own folder.
- Removed the empty, unlinked `manifest.json`.
- Added the GitHub Pages workflow (tests first, then deploy), a `.gitignore`,
  a README screenshot, and this changelog (split out of the README).
- Tests: new sections 95 (charge needs a route) and 96 (animation rule), and the
  full-battle test accepts a round-limit decision as a legal ending. 883 rule
  assertions, 159 DOM assertions.

## v1.12.9 — thorough audit + expanded regression (sections 87–94)

One action per activation in every mode: a fighter moves **or** attacks **or**
braces, never move-then-attack.

## v1.12.8 — one action only: no move-then-attack

## v1.12.7 — cannot move after attacking (all modes)

## v1.12.6 — chevalier/champion charge: approach then melee

The chevalier and the champion may close from any distance to a free cell
beside the target and strike.

## v1.12.5 — troop mode: one action per unit per combat round

## v1.12.4 — ranged draw → release + arrow flight

## v1.12.3 — melee 1.2 s wind-up/strike, once-per-round riposte −25%

## v1.12.2 — melee adjacency, AI shoot juice, move markers

- **Melee is adjacent-only**: blades (footman, chevalier, champion) only strike a neighbouring cell; they must march up to the target first.
- **AI ranged animation**: crimson archers/ballistae use the same shoot shake + flying projectile as the player.
- **Move markers**: blue circles show every available space at the start of the player turn; selecting a unit turns *its* moves green; attacks stay red.
- Deployment boundary unchanged (blue cannot enter cols 0–1, red cannot enter 8–9).
- Smoke + regression updated and green.

## v1.11.0 — footer layout cleanup (no overlaps)

- Removed the large champion panel from the footer (abilities still available as compact chips next to the unit).
- Footer is five clear columns: turn · selection+icons · log · progression · actions.
- Selection shows unit info on the left and Shield/Sword/Bow icons on the right — nothing stacks on top of the icons.
- Progression strip has its own column and no longer covers the action icons.
- Responsive grid updated (no empty “abilities” row).

## v1.10.0 — combat animation & action icons

- **Attack animations (~1.5–1.6 s)**: melee units lunge toward the target; archers and ballistae fire a visible arrow/bolt that flies across the field before damage is applied.
- **Action icon bar**: when a blue fighter is selected, compact icons appear — Shield (defence stand), Sword (melee), Bow (ranged). Champion gets all three; pure melee/ranged units get Shield + their weapon.
- **Slower movement**: unit moves ease over ~1.2 s so the march is readable.
- **Footer**: selection panel hosts the new icon row; legacy text “DEFENCE STAND” button is hidden.
- Smoke + regression suites still fully green.

## v1.9.0 — polish pass (visual, Troop mode, atmosphere)

- **Tighter ranks**: troop and champion art sizes reduced so front-line fighters no longer swallow the rank behind them; ranks stay readable on both desktop and phone.
- **Stronger presence**: deeper contact shadows, slight contrast/saturation on the PNG art, and a soft ground blob under every fighter so the army sits on the grass instead of floating.
- **Terrain readability**: subtle cell tints for forest, rock, high ground and boulder so the map reads at a glance even when the decorative sprites are small.
- **Hit juice**: stronger red aura and shake on impact; champion aura sized correctly.
- **Troop mode UX**: when the azure legion’s turn begins in Troop mode the first ready fighter is auto-selected (front rank, left-to-right). Status text and log make the “one fighter at a time” rule clear. AI still answers with a single action, keeping the classic alternating single-unit feel.
- Version bump and all existing smoke / regression suites still green (805 + 159).

## v1.8.8 — the duel opens on the player's turn

- Starting a duel no longer immediately ends the player's opening turn. The
  start/end control now handles starting and ending through one click path.
- The rule and DOM checks use the current `end-turn-button` control and cover
  the opening player phase.
- On compact screens, the footer uses full-width rows for turn status,
  evenly spaced controls, and progression/combat log; hidden panels no longer
  leave empty rows.

## v1.8.5 — footer fixes and the troop turn mode

- The start button now reads "Enter Arena" (the JS no longer overwrites it back).
- The spectator button now reads "AI vs AI" everywhere it is set.
- The footer controls are arranged with tighter gaps and aligned labels.
- Turn mode "Troop" auto-ends the turn after one unit move or one blow, so each
  fighter acts alone until END TURN.

## v1.8.4 — the turn mode stacks next to difficulty

- A `turn:` label with a cycle button (`Party → Troop → Party`) now sits on
  the footer to the left of the `Difficulty:` control. `Party` moves all
  blue fighters at once; `Troop` hands out one move per fighter per round
  (a Heroes of Might &amp; Magic style, to be filled out later). Default is
  Party.

## v1.8.3 — the difficulty cycle stacks on the footer

- The `Difficulty:` label now sits on top of the `Easy → Normal → Hard` cycle
  button in the footer, so the pair reads as a single control in one column.

## v1.8.2 — the difficulty cycle and a tighter header

- The `setup-panel` is gone. A small `Difficulty:` label with a cycle button
  (`Easy → Normal → Hard → Easy`) now sits in the footer next to `ENTER THE
  ARENA`, so the player can set the AI strength without a screen overlay.
- The header is slimmer, and the two footer buttons are smaller with wrapped
  two-row labels so they fit on narrow screens.
- `setDifficulty` is locked while a battle runs, so the enemy cannot switch
  difficulty mid-fight.

## v1.8.1 — the pre-battle chooser leaves the field

The `setup-panel` and its `BATTLEFIELDS` button are gone: the battlefield and difficulty are now set through the engine (`setDifficulty`, `selectMap`, `setActiveMap`) instead of a screen overlay, so the whole top of the screen belongs to the field.

## v1.8.0 — the duel series, armour, the defence stand and the side strongholds

| Area | Summary |
| --- | --- |
| The duel | A battle is no longer a single fight: it is the first match of a duel. The legion that takes two of three matches wins the duel, and the series stops as soon as one side has two. The azure legion opens the first match, the crimson legion opens the second, and the decider is opened by whichever side the dice pick. A match inside a duel is not a battle of its own: the victory bonus, the experience and the win-loss record belong to the duel, not to the match that just ended. |
| The BATTLEFIELDS button | The battlefield and difficulty chooser moved from the top of the screen to the footer. It opens through the BATTLEFIELDS button in the last row, so the whole top of the screen belongs to the battlefield. |
| The strongholds | The stronghold that used to stand in the middle of the back line is gone. One stronghold stands at each margin, left and right, behind its own legion, running top to bottom and facing the field. |
| Bigger pictures | Every troop picture grew by a quarter again, and a picture in the first or the last column is nudged back inside the field so the army never hangs over the edge. |
| Hit feedback | Every hit paints the receiver with a red glow and a one-second shudder, and the device vibrates for a second when it can. |
| Armour | Every troop carries its own armour: a share of every incoming blow that turns away before the fighter feels it. Armour makes a fighter harder to bring down, but never a wall — an armoured champion still falls in a handful of blows. |
| The defence stand | A fighter that has not acted may give up its move and its blow to brace behind a shield. While it stands, its armour rises by twenty points, and the stance lasts until it acts again. |
| The riposte | A fighter struck by a blade answers with a blade of its own, at once, without waiting for its turn. The answer spends the fighter's blow for the round, and a shooter is answered with steel, not with an arrow. |

### The measured balance

`node balance.js --seeds=40` (40 seeds per configuration, damage scatter 0.08,
AI noise 2), 480 battles, engine v1.8.0:

| Difficulty | Battlefield | Enemy wins | Win rate | Rounds | Damage | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | Old Frontier | 0 / 40 | 0 % | 10.2 | 390 | 363 |
| Easy | Forest March | 1 / 40 | 3 % | 10.9 | 390 | 361 |
| Easy | Broken Pass | 0 / 40 | 0 % | 9.6 | 390 | 363 |
| Easy | High Ground | 0 / 40 | 0 % | 10.1 | 390 | 363 |
| Normal | Old Frontier | 22 / 40 | 55 % | 12.9 | 368 | 280 |
| Normal | Forest March | 29 / 40 | 73 % | 12.0 | 327 | 235 |
| Normal | Broken Pass | 26 / 40 | 65 % | 12.6 | 360 | 264 |
| Normal | High Ground | 7 / 40 | 18 % | 11.4 | 383 | 335 |
| Hard | Old Frontier | 40 / 40 | 100 % | 9.0 | 278 | 159 |
| Hard | Forest March | 39 / 40 | 98 % | 9.0 | 280 | 173 |
| Hard | Broken Pass | 40 / 40 | 100 % | 8.8 | 275 | 154 |
| Hard | High Ground | 31 / 40 | 78 % | 10.8 | 323 | 217 |

| Difficulty | v1.7.1 enemy wins | v1.8.0 enemy wins | Change |
| --- | --- | --- | --- |
| Easy | 6.3 % | 3 % | −3.3 points |
| Normal | 60.6 % | 53 % | −7.6 points |
| Hard | 80.6 % | 94 % | +13.4 points |
| All | 49.2 % | 49 % | −0.2 points |

What the numbers say:

- Easy is still a walkover, Normal is a real fight at about half, and Hard is a hard fight — the ladder is where it belongs.
- The overall rate lands on 49 %, the same figure v1.6.0 and v1.7.1 measured, so armour, the defence stand and the riposte changed the feel of the fight without tilting it.
- The defence stand and the riposte cost the fighter its action, so the AI only uses them when it is really under the weather, and they do not tip the ladder.

## v1.7.1 — the battlefield, the reach of the weapons and the lead

| Area | Summary |
| --- | --- |
| The castle | The header is a shallow panorama now: a wide castle banner, up to 760 pixels across and 48 pixels tall, with the two towers, the wall and the gate, painted over a sky that fades into the landscape below. |
| The command bar | The strip along the bottom of the screen was rebuilt. The turn, the actions, the selection, the abilities, the champion and the log each sit in their own cell, and on a narrow screen the cells fold into short rows instead of squeezing the buttons. |
| The pictures are bigger | Every troop is drawn about three times as large as in v1.6.0, measured against the battlefield rather than against the screen, so the army keeps its proportions on a phone. The champion is drawn a fifth larger than the rank. |
| The champion | The champion is a fantasy knight now: a sword in his hand, a bow on his back, a tabard over the armour and a heraldic cloak behind him. The azure knight and the crimson knight are two different pictures, not one picture in two colours. |
| The atmosphere | The field is a landscape now. The ground fades from a warm horizon to a dark foreground, and the ground behind the castle carries the same light. |
| A bow covers the field | A bow no longer asks how far away the enemy is, what stands in the way, or which rank the enemy is in. It lands on any living enemy on the field. |
| A blade cuts forward | A blade still only cuts forward and never backwards, but the rank in front only turns a blow aside when it closes every lane. One open lane is a way in. |
| The lead alternates | The azure legion opens the first round, the crimson legion opens the second, and so on. A bow that covers the whole field would otherwise hand the side that acts first a free round of shooting, and the order of play would decide the battle instead of the armies. |
| The lines meet sooner | Both armies now stand one column closer to each other, so the fight starts before the armies have finished marching. |

### The panorama and the command bar

The castle is no longer a picture in the corner of a header: it is a shallow
panorama that stretches across the top of the page, with the sky fading down
into the battlefield. The ground of the battlefield is a landscape of its own
now — a warm horizon at the back, a dark foreground at the front — and the
two pictures are lit from the same side, so the page reads as one scene.

The command bar was rebuilt for the same reason. The old strip squeezed the
turn, the buttons, the selection, the abilities and the log into one line, and
on a phone the buttons became unreadable. Every part of it now has its own
cell, the cells wrap into short rows on a narrow screen, and the buttons keep
their full size at every width.

### The bow and the blade

The two weapons were kept apart in v1.7.0, and in v1.7.1 the gap between them
grew:

- **A bow** covers the whole field. It does not ask how far away the enemy is,
  it does not ask what stands in the way, and it does not ask which rank the
  enemy is in. Every living enemy on the field is a legal target, and the
  front rank of the other army protects nothing from an arrow.
- **A blade** only cuts forward, two cells, and never backwards. The rank in
  front of the target turns the blow aside only when it closes every lane
  between the attacker and the target. One open lane is a way in, so a gap in
  a line is a real opening — and a line that stays closed is a real wall.

Both armies obey the same two rules, and the AI plays by them too.

### The lead alternates

A bow that covers the whole field changes one thing that the game cannot
afford to leave alone: the side that acts first in a round gets a free round of
shooting, and with seven fighters on each side that is enough to decide the
battle before the other army has moved. Measured against the shipped rules,
the side that opened a round won 90 % of the battles and the side that
answered won 10 % — a fight decided by the order of play rather than by the
armies.

So the lead alternates. The azure legion opens the first round, the crimson
legion opens the second, the azure legion opens the third, and so on to the
last round. A round is closed when the legion that answered has finished its
turn, so every round is one move for each side, whoever opened it. The
spectator show follows the same rule, so the show is as even as the fight.

### The measured balance

`node balance.js --seeds=40` (40 seeds per configuration, damage scatter 0.08,
AI noise 2), 480 battles, engine v1.7.1:

| Difficulty | Battlefield | Enemy wins | Win rate | Rounds | Damage | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | Old Frontier | 1 / 40 | 3 % | 10.6 | 389 | 359 |
| Easy | Forest March | 1 / 40 | 3 % | 11.0 | 387 | 358 |
| Easy | Broken Pass | 6 / 40 | 15 % | 10.8 | 384 | 339 |
| Easy | High Ground | 2 / 40 | 5 % | 9.2 | 388 | 355 |
| Normal | Old Frontier | 22 / 40 | 55 % | 12.3 | 359 | 272 |
| Normal | Forest March | 32 / 40 | 80 % | 11.9 | 338 | 227 |
| Normal | Broken Pass | 21 / 40 | 53 % | 11.5 | 363 | 280 |
| Normal | High Ground | 22 / 40 | 55 % | 10.9 | 354 | 269 |
| Hard | Old Frontier | 40 / 40 | 100 % | 9.5 | 283 | 172 |
| Hard | Forest March | 38 / 40 | 95 % | 9.3 | 275 | 173 |
| Hard | Broken Pass | 22 / 40 | 55 % | 9.4 | 348 | 264 |
| Hard | High Ground | 29 / 40 | 73 % | 10.0 | 338 | 235 |

The same seeds, the same maps and the same harness against the two releases
before it:

| Difficulty | v1.6.0 enemy wins | v1.7.0 enemy wins | v1.7.1 enemy wins | Change |
| --- | --- | --- | --- | --- |
| Easy | 6.3 % | 16.3 % | 6.3 % | −10.0 points |
| Normal | 51.3 % | 62.3 % | 60.6 % | −1.7 points |
| Hard | 90.0 % | 98.3 % | 80.6 % | −17.7 points |
| All | 49.2 % | 59.0 % | 49.2 % | −9.8 points |

What the numbers say:

- The ladder is back where it belongs. Normal is a real fight at 61 % enemy
  wins, Easy is a walkover at 6 % and Hard is a hard fight at 81 % — and Hard
  is no longer a wall, which is what v1.7.0's 98 % had become.
- The rules of v1.7.1 are the reason. A bow that covers the whole field is
  worth a great deal to the side that moves first, and the alternating lead
  takes that bonus back. The overall rate lands on 49.2 %, the same figure
  v1.6.0 measured.
- The AI had to learn the new rules as well. With a bow that answers from
  anywhere, the old trade-off turned every archer into a statue: the answer
  to a shot was worth more than the shot, so the archers stood still and let
  the fight be decided by the blades. A blow is now weighed against the two
  strongest answers it would earn, which is what a fighter actually faces.
- The Broken Pass is still the hardest ground for the azure legion, and on
  Hard it is the only field the enemy does not take every time.
- The deterministic run (`node balance.js --deterministic --seeds=20`, 240
  battles) gives the crimson legion 50 % of the battles, and the average
  battle lasts 10.9 rounds.

## v1.7.0 — the seven troops and the front line

| Area | Summary |
| --- | --- |
| The troops are painted | Every fighter on the field is now a large picture instead of a small inline symbol: a foot soldier, an archer with a bow, a ballista with its bolt, a chevalier on horseback and the champion in his own colours, in azure and in crimson. Ten original pictures, drawn for this game, live in `assets/troops/`. The inline symbol stays in the markup as a fallback, so a picture that cannot be loaded never leaves a hole in the line. |
| Seven fighters a side | The legion is now seven fighters: one ballista, one chevalier, two archers, two foot soldiers and the champion. Fourteen fighters stand on the field from the first bell, under fourteen unique ids. |
| The formation | The champion stands in its own column with the shooters behind it, and the front rank — two foot soldiers and the chevalier — stands one column closer to the enemy. The champion is drawn across two columns, but its anchor stays on the cell it occupies, so the rules of the field do not move with the picture. |
| Two kinds of weapon | A bow and a blade obey different laws now. The archer, the ballista and the champion's bow strike any enemy inside their range, and the front rank never shields them. The foot soldier, the chevalier and the champion's blade only cut forward, two cells, and a defender standing directly or diagonally in front of the target turns the blow aside. |
| The champion keeps two weapons | The champion fights with its own blow (20 ATK, two cells) and with its bow (16 ATK, three cells). It reaches for the blade at arm's length and for the bow at a distance, and it never strikes backwards. |
| High ground belongs to the shot | The aim bonus of the high ground is paid to arrows and bolts only. A blow at arm's length gets nothing from it, for either army. |

### The army of seven

Each side now fields seven fighters instead of nine, and the shape of the
legion changed with it:

| | Column | Lanes |
| --- | --- | --- |
| Front rank | one column closer to the enemy | two foot soldiers, one chevalier |
| Champion's column | the champion's own column | two archers, one ballista, the champion |

The champion is drawn across two columns, half in its own column and half in
the column of the front rank, which is what makes it the centrepiece of the
army. Its logical cell never changes: the collision rules, the movement and
the line of sight all use the cell it stands on.

### Blades and bows

The battlefield used to ask one question of every weapon: is the target close
enough? It now asks two, and the answer depends on what is in the way.

- **A bow** reaches as far as its range says and lands on any enemy inside
  it, as long as nothing that blocks sight stands in the way. The front rank
  of the other army does not protect the troops behind it from an arrow.
- **A blade** only cuts forward. It reaches two cells, never backwards, and
  it cannot cut through the rank in front: a defender standing directly or
  diagonally in front of the target turns the blow aside, exactly like a
  shield wall does.

Both armies obey the same two rules, and the AI plays by them too.

### The troop pictures

The pictures are drawn to a common standard: the same ground line, the same
light from the left, the same silhouette language as the old inline symbols.
They are ordinary PNG files in `assets/troops/`, one per troop and colour, and
they are generated by `generate_troop_art.py`, which draws them from scratch
with Pillow — nothing is downloaded and no third-party art is used.

The picture is sized against the battlefield, not against the screen, so the
army keeps its proportions on a phone as well as on a desktop. Every picture
stands on the ground line of its own cell and stays inside that cell, so a
troop is never cut off by the edge of the field and never hides the troop
that stands behind it. The champion's picture is the largest of them and it
fills its cell from the ground line to the top of it.

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

The current measurement is the v1.7.1 one, in the v1.7.1 section above. The
numbers below are the v1.7.0 measurement, kept as the history of the ladder.

`node balance.js --seeds=40` (40 seeds per configuration, damage scatter 0.08,
AI noise 2), 480 battles, engine v1.7.0:

| Difficulty | Battlefield | Enemy wins | Win rate | Rounds | Damage | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | Old Frontier | 0 / 40 | 0 % | 11.2 | 390 | 363 |
| Easy | Forest March | 0 / 40 | 0 % | 11.9 | 390 | 363 |
| Easy | Broken Pass | 20 / 40 | 50 % | 20.2 | 297 | 238 |
| Easy | High Ground | 6 / 40 | 15 % | 16.8 | 374 | 335 |
| Normal | Old Frontier | 29 / 40 | 73 % | 12.0 | 301 | 208 |
| Normal | Forest March | 24 / 40 | 60 % | 11.7 | 304 | 234 |
| Normal | Broken Pass | 15 / 40 | 38 % | 18.0 | 340 | 288 |
| Normal | High Ground | 31 / 40 | 78 % | 12.7 | 295 | 211 |
| Hard | Old Frontier | 40 / 40 | 100 % | 6.3 | 147 | 81 |
| Hard | Forest March | 40 / 40 | 100 % | 7.2 | 176 | 96 |
| Hard | Broken Pass | 37 / 40 | 93 % | 11.6 | 242 | 149 |
| Hard | High Ground | 40 / 40 | 100 % | 7.3 | 193 | 96 |

What the numbers say:

- The ladder still works and is steeper than it was. The crimson legion wins
  16 % of its Easy battles, 62 % of its Normal ones and 98 % of its Hard
  ones. The overall enemy win rate across all 480 battles is 59 %.
- The seven fighter legion is a sharper fight than the nine fighter one. The
  front rank of a smaller army holds the line better, the blade has to work
  through it, and the enemy AI reads the new rules faster than a new player
  does. The same measurement gave 49 % for v1.6.0.
- The Broken Pass is still the hardest ground for the azure legion at Easy
  and Normal. On Hard it is the only field the enemy does not take every
  time.
- Experience per battle sits between 80 and 365 depending on how the battle
  went. With the level thresholds at 100 / 250 / 450 / 700, a good battle
  earns a level and a bad one does not.

#### The same measurement against v1.6.0

The identical seeds, the identical maps, the identical harness, 480 battles a
side:

| Difficulty | v1.6.0 enemy wins | v1.7.0 enemy wins | Change |
| --- | --- | --- | --- |
| Easy | 6.3 % | 16.3 % | +10.0 points |
| Normal | 51.3 % | 62.3 % | +11.0 points |
| Hard | 90.0 % | 98.3 % | +8.3 points |
| All | 49.2 % | 59.0 % | +9.8 points |

The average battle is 12.22 rounds in v1.7.0 and 12.74 in v1.6.0, one battle
out of 480 was settled by the round limit, and both versions replayed the same
seed exactly in 12 configurations out of 12 and changed with a different seed
in 12 out of 12.

The shift comes from the rules of v1.7.0, not from a change in the AI: the
legion is smaller, the front rank shields the troops behind it from a blade
but not from an arrow, and the five tactical weights were measured on the
nine fighter army. The ladder is still in the right order, but Normal is
harder than it was and the weights want a fresh measurement against the
seven fighter legion before they are trusted again.

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
every Easy battle and every Normal battle but the High Ground: 67 % of all
battles in v1.7.0 against 75 % in v1.6.0, the difference being the High
Ground and the three Hard battlefields the crimson legion takes. The
exploration settings above are the ones that measure the game; the
deterministic run measures the one exact fight a player gets on each ground.

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
