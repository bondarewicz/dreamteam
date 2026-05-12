---
description: Build an EventStorming board on Miro (AS-IS, TO-BE, or both) using Brandolini's canonical recipe
---

# /eventstorming

Produces an Event Storm following Brandolini's canonical notation, the project's colour overrides, and the build order in §4 below. Outputs a Miro board (via the Miro MCP) and, optionally, a written summary.

## Argument parsing

`$ARGUMENTS` may be:

1. **Empty** — Use `AskUserQuestion` to collect both:
   - Variant: AS-IS, TO-BE, or both
   - Scope: what system / flow to model (free text)
   Then proceed as if those were passed.

2. **First token is `--recipe` or `--help`** — Print **only** §1 (notation table) and §6 (quick recipe) from this file. Do not touch Miro. Do not spawn agents. This serves the "I just want the reference" case.

3. **First token is `as-is`, `to-be`, or `both`** (case-insensitive) — That is the variant. The remainder is the scope.

4. **Anything else** — Treat the whole string as the scope and default the variant to `as-is`. Confirm the assumption back to the user in one sentence before building.

## Execution flow (when building a board)

1. **Check Miro auth first.** Call `mcp__miro__authenticate` (or the relevant Miro MCP tool) before doing any modeling work. If auth is missing, surface the auth step to the user and stop — don't waste tokens building a spec that can't be uploaded.
2. **State the plan in one sentence** ("Building AS-IS event storm for checkout flow on a new Miro board…") so the user can redirect before you commit.
3. **Apply the recipe.** Follow §4 (Recipe for a Miro board) build order strictly. Honour the project overrides:
   - Hot Spot = **red** (`#FF9296`), not purple
   - Policy = **violet** (`#B1A1FF`), not lilac
   - Use the exact hex codes from §1 for shapes; stickies use the named-palette equivalents
4. **For `both`**: place AS-IS and TO-BE in two separate frames as described in §4e (AS-IS at `x = -2400`, TO-BE at `x = 5400`).
5. **After the board is built**, return:
   - The Miro board URL
   - A one-paragraph summary of what was modelled (pivotal events, BCs, key hot spots / fixes)
   - Optionally save the summary to `docs/eventstorms/<slug>-<variant>.md` if the user has the `docs/eventstorms/` directory — Miro URLs rot, a checked-in summary survives.

## Anti-patterns (do not do these)

- Don't dump this entire file at the user as a response — that's the `--recipe` path only.
- Don't spawn Bird / MJ / other agents for this. The recipe is prescriptive enough to execute directly; an agent hop adds latency and risks rewriting the rules.
- Don't invent a domain if the scope is vague. Ask once via `AskUserQuestion`, then proceed.
- Don't skip the Miro auth check.

---

# EventStorming canonical recipe (Brandolini)

Source: *Introducing EventStorming* by Alberto Brandolini (Leanpub, 2018). Chapters cited inline.
**Use the sections below every time you build an Event Storm on Miro for AS-IS, TO-BE, or both.**

---

## 1. Notation (the colour scheme is non-negotiable)

Brandolini quote (Preface, p. ii): *"I'll be strict in being consistent with my own notation. This means that I'll be using a rigid color scheme (orange for Domain Events, purple for Hot Spots, blue for Commands and so on)."*

Canonical sticky table (Ch. 22 + 23 + Ch. 40 ingredients list):

| Sticky | Real-world colour | Meaning | Miro DSL `color=` |
|---|---|---|---|
| **Domain Event** | 🟧 orange square | Something **already happened** in the domain, past tense (e.g. `Order Placed`) | `orange` |
| **Command** | 🟦 blue square | An action/decision that triggers state change (e.g. `Place Order`) | `light_blue` (or `blue`) |
| **Aggregate** | 🟨 large yellow square | The DDD unit of consistency. Groups its commands+events. Brandolini's "what happens between a command and an event" | `yellow` |
| **Policy** | 🟪 violet (purple) square | "Whenever X then Y" reactive logic. **Sits between an orange event and a blue command.** Ch. 23: *"there must be a lilac between an orange and the blue."* | `violet` ⚠ **project override** — Brandolini's canonical is lilac (`light_pink`); this project uses `violet` instead |
| **Read Model** | 🟢 green square | Information used to make a decision (drives a command). UI / projection. | `light_green` |
| **External System** | 💗 large pink rectangle (`#F0C6EB`) | "Whatever we can put the blame on" (Ch. 4). 3rd-party APIs, upstream services, other depts. | `pink` (sticky) / `fill=#F0C6EB` (shape) |
| **Actor / Person** | 🟡 small pale-yellow rectangle | The user/role who issues a command | `light_yellow` |
| **Hot Spot** | 🟥 **red** square | Disagreement, unknown, problem, friction. ⚠ **project override** — Brandolini's canonical is purple (Ch. 36: *"Mark hot spots with purple sticky notes. Purple is the closest you can get to signal warning or danger"*). This project uses `red` for stronger visual warning, and reserves violet for Policy. | `red` ⚠ **project override** |
| **Pivotal Event** | 🟧 orange + label tape | A key event that splits the timeline into business phases (e.g. `Order Placed`, `Payment Received`). 4–5 per workshop. Marked with horizontal coloured tape running below it. | Same `orange` sticky + a thin orange `SHAPE rectangle` running vertically through the timeline |

**Project-specific palette (Willow / Poplar / Sycamore):**

This project pins exact hex values (from the reference reviewed 2026-05-12) so all boards look identical:

| Legend tile name (board) | Brandolini term | Miro sticky `color=` | **Exact hex (shapes & legend tiles)** | Description |
|---|---|---|---|---|
| **Events** | Domain Event | `orange` | **`#FFB36D`** | Soft Orange / Apricot |
| **Commands** | Command | `light_blue` | **`#99E1F9`** | Light Sky Blue |
| **Aggregate** | Aggregate | `yellow` | **`#FFEB64`** | Bright Yellow |
| **Policies** | Policy | `violet` | **`#B1A1FF`** | Lavender / Light Purple ⚠ project override |
| **Projection \ data** | Read Model | `light_green` | **`#B1F272`** | Lime Green |
| **System (abstraction)** | External System | `pink` | **`#FFD2ED`** | Soft Pink |
| **User** | Actor / Person | `light_yellow` | **`#FFF79A`** | Pale Yellow |
| **Hotspot** | Hot Spot | `red` | **`#FF9296`** | Salmon / Coral Red ⚠ project override |
| Pivotal marker | Pivotal Event | n/a | `#FFCC80` fill + `#FF6F00` border | (structural — not in canonical palette) |

**Legend tile naming convention:** boards use the **bold** short names (Events, Commands, Policies, Projection \ data, System (abstraction), User, Hotspot) to match the project reference swatch. Brandolini's canonical terms (Domain Event, Command, Policy, Read Model, External System, Actor) are the authoritative DDD vocabulary and still appear in this document's prose and in body sticky labels.

**STICKY constraint:** Miro sticky notes are locked to Miro's named-colour palette (the `color=` column above). Only SHAPES accept raw hex. Use SHAPEs for legend tiles, external-system tiles, and actor tiles so the canonical hex codes are visible; body stickies render in Miro's stock named hues which approximate the exact hex codes closely but not pixel-identically.

Two deliberate divergences from Brandolini's book:
- 🟥 **Hot Spot = `red`** (book says purple, but red gives a stronger warning signal here)
- 🟪 **Policy = `violet`** (book says lilac, but we use violet since red has taken over the "warning" colour slot)

All other colours follow Brandolini's canonical notation. Always include this override in the visible legend on every board, and use the hex codes above for shapes (sticky notes are locked to Miro's named palette, so the legend tile encodes the displayed colour exactly).

**Common mistakes to avoid:**
- ❌ Using `violet` for hot spots in this project (violet is Policy here)
- ❌ Using `light_pink` for policies in this project (we use `violet`)
- ❌ Using `pink` for policy (pink is for **external systems**)
- ❌ Using yellow square for actors (large yellow = aggregate; small light_yellow rectangle = actor)
- ❌ Treating swimlanes as service-architecture bands (see §3 below)

---

## 2. The Layout — single horizontal timeline

Brandolini's original 2013 article (cited inline in the book): *"Place all of them on your modeling surface according to a timeline."*

### Hard rules

1. **Time runs left → right.** Period. The dominant axis is horizontal. Horizontal space is unlimited (Ch. 4: *"50 metres paper roll"* for Big Picture). Vertical space is limited.
2. **Bounded Contexts are NOT swimlanes.** They are **conceptual boundaries that emerge from the model**, drawn as dashed boxes around natural clusters AFTER the timeline is in place. Ch. 29 calls BCs *"multiple collaborating models"*, never *"horizontal bands"*.
3. **Pivotal Events are the spine.** Choose 4–5 key events; everything else clusters between them.
4. **Aggregates appear multiple times along the timeline.** Same yellow aggregate sticky can repeat at t1, t3, t7 — one per command. Ch. 22.
5. **Policy goes between event and next command.** Sequence: `[Cmd] → [Aggregate] → [Event] → [Policy] → [next Cmd] → [Aggregate] → [Event] → ...` Ch. 23.
6. **External systems sit next to the events/commands they participate in**, not in a top lane.
7. **Actors (small yellow) attach directly to the command** they issue.
8. **Hot spots (red) attach where the friction is** — on or next to the sticky that's problematic. They are not a separate row at the bottom. ⚠ project override (book uses purple)

### Soft guidelines

- **Visible Legend (Pattern, Ch. 36):** every board must have a visible legend showing each colour with a real sample sticky. Place at top-left.
- **Time axis arrow** at the bottom, labelled `Time →`.
- **Chapter sorting (Ch. 4):** if there are too many events, group them into 15–25 named chapters first on a separate surface, then apply structure.

### When swimlanes *are* permitted (Ch. 4)

> *"swimlanes play very well for a single process, or for a few distinct processes that tend to happen in parallel to the main business flow. ... it's often more efficient to apply swimlanes **after** a temporal structure has been established."*

So: horizontal swimlanes = **parallel narratives in time** (e.g. customer flow vs system flow, admin flow vs main flow). **Never** for stacking services / bounded contexts.

---

## 3. Design-Level EventStorming grammar (Ch. 23 schema)

The canonical chain Brandolini draws:

```
[Actor]                 [External System]              [Read Model]
   │ invokes                 │ generates                  │ informs
   ▼                         ▼                            ▼
[COMMAND] ──invoked on──► [AGGREGATE] ──generates──► [DOMAIN EVENT] ──translated into──► [READ MODEL] ──renders──► [UI]
                                                            │
                                                            │ triggers
                                                            ▼
                                                        [POLICY]
                                                            │ invokes
                                                            ▼
                                                       [next COMMAND] (continues the chain)
```

Each story = **3 core stickies stacked tightly**: yellow aggregate on top, blue command + orange event below.

---

## 4. Recipe for a Miro board (AS-IS, TO-BE, or both)

### 4a. Frame setup

- **Frame width**: ≥ 7000 px (mirror "unlimited horizontal surface"). Height ~3000.
- **Title** in frame header. **Subtitle** centred at y=80 explaining the variant ("AS IS", "TO BE", scope).
- **Legend** in top-left corner (x≈250, y≈200–1100), one row per sticky type with a real coloured rectangle + label + one-line description.

### 4b. Build order

Follow Brandolini's workshop phases (Ch. 4):

1. **Identify pivotal events.** List the 4–5 phase-splitters for the system being modelled. Place them on the timeline first as vertical dashed orange bars with the event name above.
2. **Place external actors at the top** (~y=170) directly above the time slot where they participate.
3. **For each pivotal phase, lay out the stories** along the timeline (left→right):
   - For each story write a `[Yellow Agg][Blue Cmd][Orange Event]` cluster at the time slot
   - Add `Policy (violet)` between consecutive stories where one triggers the next ⚠ project override
   - Add `Read Model (light_green)` where decisions are informed by data
   - Add `External System (pink, fill=#F0C6EB)` where the chain reaches outside
4. **Draw Bounded Contexts as dashed `round_rectangle` shapes** *around* the natural clusters. Non-contiguous BCs (e.g. Willow appears at t1 + t8) get **multiple boxes with the same colour**. BC colour code for this project:
   - **Willow** (core, blue): `border_color=#1976D2`
   - **Poplar** (carrier, green): `border_color=#2E7D32`
   - **Sycamore** (clock/scheduling, purple): `border_color=#6A1B9A`
5. **Mark hot spots with red stickies** (`STICKY color=red shape=rectangle`) placed *next to* the problematic story (not in a separate panel). ⚠ project override (book uses purple)
6. **Add a parallel-narratives lane** below the main timeline (y≈1750–2100) for independent triggers (admin commands, async user actions, time ticks).
7. **Add a loop indicator** (dashed rectangle) when a cycle exists (e.g. polling loop).
8. **Add the time axis** at the bottom as a `right_arrow` shape labelled `Time →`.

### 4c. Sticky sizing rules

| Sticky type | Miro DSL |
|---|---|
| Domain Event | `STICKY w=80 color=orange` |
| Command | `STICKY w=80 color=light_blue` |
| Aggregate | `STICKY w=80 color=yellow` (or `w=100` if name is long) |
| Policy | `STICKY w=80 color=violet` ⚠ project override |
| Read Model | `STICKY w=80 color=light_green` |
| External System | `SHAPE w=140 h=60 type=rectangle fill=#FFD2ED` (rectangular, larger) ⚠ exact hex |
| Actor | `SHAPE w=120 h=50 type=rectangle fill=#FFF79A` (small) ⚠ exact hex |
| Hot Spot | `STICKY w=100 color=red shape=rectangle` ⚠ project override |
| Pivotal event marker | `SHAPE w=20 h=900 type=rectangle fill=#FFCC80 fill_opacity=0.4 border_color=#FF6F00 border_style=dashed border_width=2` + text label above |
| BC box | `SHAPE type=round_rectangle fill_opacity=0.0 border_style=dashed border_width=3` (transparent fill, dashed coloured border) |
| Time axis | `SHAPE w=6800 h=30 type=right_arrow fill=#1A1A1A color=#FFFFFF "Time →"` |

### 4d. TO-BE additions (when the user asks for a TO-BE diagram)

- ⊕ **ACL tiles** (`SHAPE` light_green with `⊕` symbol, `border_color=#1B5E20 border_width=2`) sit on the *boundary* between two adjacent BCs.
- ✅ **Fix markers** on aggregates / stories that resolve an AS-IS hot spot.
- 📦 **NuGet Contracts package** markers (`SHAPE` light_green) on event flows that become Published Language.
- **Green "Fixes Applied" panel** replacing the AS-IS hot spot column, mapping each HS-N to its fix.
- Hot spots **removed** (they're resolved, not present).

### 4e. AS-IS + TO-BE together

When the user asks for both, place them in two separate frames:
- AS-IS frame at `x = -2400, y = (top of available space)`
- TO-BE frame at `x = 5400, y = (same)`
- Same internal layout grammar in both, so the reader can compare cluster-by-cluster.

---

## 5. Anti-patterns from the book (Ch. 37) — never do these

| Anti-pattern | What it looks like | Why it's wrong |
|---|---|---|
| **Precise Notation** | Strict UML/BPMN/C4 grammar | "Use UML or BPMN out of habit" — kills inclusive conversation. EventStorming is intentionally fuzzy. |
| **Big Table at center** | Stickies arranged around a central table | Wastes vertical real estate; people can't see the whole thing. |
| **Divide and Conquer** | Breaking the story into sub-teams modelling pieces | Loses the cross-cutting view that's the whole point. |
| **Service-architecture swimlanes** *(my addition — implicit anti-pattern)* | Stacking Willow / Poplar / Sycamore as 3 horizontal bands | Inverts the grammar. Time is the axis, not service ownership. |
| **Pink for policies** *(my addition)* | Saturated pink for Whenever→Then | Pink is **external systems**. In this project policies are **violet** (project override). |

---

## 6. Quick recipe (every time the user asks for a Miro board)

1. Create the frame ≥ 7000 wide.
2. Add subtitle + legend (top-left, all sticky types with one-line descriptions).
3. List the 4–5 pivotal events for the system; place them as dashed orange vertical bars along the timeline.
4. Above the main timeline, place the external actors.
5. For each phase (between pivotal events), lay out the canonical 3-tile stories left→right.
6. Add policies (violet ⚠ project override) between consecutive stories where one event triggers the next.
7. Add read models (light_green) where decisions consume data.
8. Add external systems (large pink rectangles, `fill=#F0C6EB`) at the time slots they appear.
9. Draw BC dashed boxes around natural clusters (transparent fill, dashed coloured border).
10. Mark hot spots (red ⚠ project override) next to problematic stories — book uses purple, this project uses red.
11. Below the main timeline, add the parallel narratives lane for independent triggers.
12. If the cycle loops back, add a dashed loop indicator.
13. Add the `Time →` arrow at the bottom.
14. If TO-BE: add ⊕ ACLs at boundaries, ✅ on fixed aggregates, 📦 on Published Language flows, and a green Fixes panel replacing the hot spot column.

---

## 7. References

All citations from *Introducing EventStorming*, A. Brandolini (LeanPub, 2018 version):
- **Notation rules**: Preface (p. ii), Ch. 22 Building Blocks, Ch. 23 Color Modeling Patterns
- **Layout / timeline**: Ch. 4 Phase: Enforcing the Timeline
- **Pivotal events**: Ch. 4 Provide Structure → Pivotal Events sub-section
- **Swimlanes**: Ch. 4 Provide Structure → Swimlanes sub-section
- **Hot spots**: Ch. 36 Mark hot spots pattern
- **Visible Legend**: Ch. 36 Visible Legend pattern
- **Design-Level grammar**: Ch. 18 Running a Design-Level EventStorming, Ch. 19 The picture that explains everything, Ch. 23 Color Modeling Patterns
- **Bounded Contexts**: Ch. 29 Modeling in the large
- **Specific formats (sticky counts)**: Ch. 39 Big Picture, Ch. 40 Design-Level
- **External anchors**: Brandolini's original 2013 article on his blog; mrpicky.dev design-level examples; Boldare's step-by-step guide
