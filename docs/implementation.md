# Implementation

This document describes the current implementation of Art of Artillery: Danger Close. See the [README](../README.md) for running, testing, and playing the game, and the [mission reference](levels.md) for algorithms, example invariants, and specifications.

## Architecture and source map

The application is a static site built from native JavaScript modules, HTML, and CSS. It has no runtime package dependencies, build step, verification server, or remote score service. [server.mjs](../server.mjs) serves `dist/` on the loopback interface, with port 4173 by default and an optional `PORT` environment variable. The files in `dist/` are the editable application source as well as the deployable site.

| File | Responsibility |
| --- | --- |
| [dist/index.html](../dist/index.html), [dist/style.css](../dist/style.css) | Page structure, dialogs, responsive layout, and visual styling. |
| [dist/app.js](../dist/app.js) | Mission selection, editor state, rendering, layers, input events, firing orchestration, and local persistence. |
| [dist/engine.js](../dist/engine.js) | Expression parsing and evaluation, level validation, finite verification, candidate projection, battle transitions, and scoring. |
| [dist/levels.js](../dist/levels.js) | Six chapter definitions and assembly of the active 24-mission campaign. |
| [dist/levels-general.js](../dist/levels-general.js) | Initialized two-variable missions `g01`–`g20`. |
| [dist/levels-spatial.js](../dist/levels-spatial.js) | Initialized three-variable missions `s01`–`s04`. |
| [dist/solution-explanations.js](../dist/solution-explanations.js) | English and Korean proof explanations for the first 20 missions. |
| [dist/dafny-program.js](../dist/dafny-program.js) | Conversion of trusted authored program fragments to the Dafny notation displayed to players. |
| [dist/refinement-risk.js](../dist/refinement-risk.js) | Per-enemy estimates of friendly exposure under a declared interval abstraction. |
| [dist/unit-types.js](../dist/unit-types.js) | Branch points, branch assignment, and shared SVG unit symbols. |
| [dist/firing-sequence.js](../dist/firing-sequence.js) | Verification-stage sequencing, presentation timing, cancellation, and the final commit event. |
| [dist/battle-effects.js](../dist/battle-effects.js) | Decorative shell trajectories, impacts, and radio effects. |
| [dist/artillery-audio.js](../dist/artillery-audio.js) | Recorded mechanical/firing cues, synthesized signals and impacts, and audio lifecycle management. |
| [dist/i18n.js](../dist/i18n.js), [dist/ui-copy.js](../dist/ui-copy.js) | Dynamic and static interface translations and progressive hint rendering. |

`levels-basic.js` and `levels-advanced.js` retain earlier mission definitions. They are not imported into the current campaign by `levels.js`.

## Program and mission data

### External input and initialization

Every active mission has the mathematical external-input contract `(a, b) ∈ ℤ²`. Initialization normally defines `n = |a|` and `m = |b|`, then sets the loop's mutable coordinates. Some algorithms retain signed inputs directly, such as the integer-mean mission. These operations define the algorithm; they do not clamp inputs to the checker window or reduce them to the three displayed examples.

The mutable state is `(x, y)` or `(x, y, z)`. The parameters `a`, `b`, `n`, and `m` are fixed for an execution. The engine preserves the original `a, b` regardless of the initializer's return value. When calling `step`, it supplies a copied state with non-writable parameter properties and retains the original parameters in the successor. Only declared coordinates are taken from the returned state.

Unrestricted external inputs do not imply unrestricted loop-entry coordinates. Initialization can establish a useful relation such as `x + y == n`; the player's invariant must hold after this initialization.

### Level contract

| Field | Meaning |
| --- | --- |
| `id`, `chapter` | Stable mission identity and chapter membership. Saved scores use the ID. |
| `variables` | `['x', 'y']` by default, or explicitly `['x', 'y', 'z']`. |
| `domains` | Inclusive finite `{min, max}` integer interval for each state axis. Unspecified axes use the default `[-32, 32]` interval. |
| `initialize({a, b})` | Returns the declared coordinates plus safe integer constants `n, m`. The initialized coordinates must fit the checker window for tested inputs. |
| `initializationCode` | Trusted authored initialization source, converted for display by the Dafny adapter. |
| `battleInputs` | Exactly three distinct `{a, b}` pairs within the external-input test window, used for the battlefield and example traces. |
| `guardSource` | Boolean loop condition in the expression parser's syntax. |
| `step(state)` | One authored loop transition. Assignment order must agree with the displayed program. |
| `code` | Trusted authored loop source used by the display adapter and semantic consistency tests. |
| `goalSolution` | Fixed mathematical postcondition. It remains independently checked even if another goal expression is passed to the engine. |
| `solution` | Example invariant disclosed with the final hint. |
| `starter` | Former default formula, now displayed only in the first hint item. It is not the editor's initial value. |
| `referenceInvariant` | Coarse invariant used for refinement-risk scoring; normally also the source of `starter`. It is separate from the full solution. |
| `hints`, `explanation`, `en` | Korean content, proof sections, and their English counterparts. Proof fields are `initial`, `preservation`, `postcondition`, and optional `note`. |
| `size`, `commands`, `allies`, `enemies` | Board extent, order budget, and unit coordinates. Active missions use a 9×9 board and six orders. |

The mission factories execute the three battlefield examples to obtain actual terminal coordinates, then deduplicate them into enemy positions. The branch-assignment layer expects one to three unique enemies and exactly three distinct allies, without overlapping coordinates. The factory does not derive enemy positions from arbitrary points satisfying `ensures`.

The engine also supports legacy `initial`, `initialStates`, and `initialCondition` forms. An initialized mission cannot also declare `initialStates` or `initialCondition`. Those older forms are compatibility paths, not the input model of the active campaign.

## Finite verification

### Scope

The game exhaustively checks explicitly bounded cases. It does not invoke Z3, an SMT solver, or the Dafny verifier, and a successful game check is not a proof over all mathematical integers.

| Scope | Current coverage |
| --- | --- |
| External inputs | All 81 pairs with `-4 <= a, b <= 4`. |
| `g01`–`g20` state window | All 4,225 pairs with `-32 <= x, y <= 32`, for each external input. |
| `s01` state window | `x ∈ [0,4]`, `y ∈ [0,20]`, `z ∈ [1,9]`: 945 states per input. |
| `s02`, `s03` state window | `x, y, z ∈ [0,4]`: 125 states per input. |
| `s04` state window | `x ∈ [0,4]`, `y ∈ [0,32]`, `z ∈ [0,16]`: 2,805 states per input. |
| Battlefield projection | Only the three `battleInputs`, restricted to visible x–y board coordinates and all declared z layers. |

`verificationCasesForLevel` returns all tested initialized cases; `battlefieldCasesForLevel` returns only the display examples. Different raw inputs remain distinct verification contexts even when their initialized coordinates or magnitudes coincide.

### Obligations and reports

For a candidate invariant `I`, guard `G`, transition `T`, and postcondition `Q`, the checker evaluates:

1. **Initialization:** `I(initialize(a,b))` for each tested external input.
2. **Preservation:** for every state in that input's state window, `I(s) && G(s)` requires `I(T(s))` and a successor inside the state window.
3. **Guarantee on exit:** every checked state satisfying `I(s) && !G(s)` must satisfy `Q(s)`.

Preservation and exit checks include states that no actual execution reaches. They also include states outside the visible 9×9 map. A successor outside the configured state window fails preservation; it is neither clipped nor silently ignored. An initial state outside the window is invalid level data. These boundary rules are part of the finite checker and can reject a mathematically inductive formula when its admitted transitions leave the configured window.

`analyze` performs the checks independently and returns the first counterexample for each failed obligation while continuing its enumeration unless an error interrupts it. For initialized missions it checks the supplied goal and the immutable `goalSolution` separately. `valid` means initialization and preservation passed. `objectiveVerified` additionally requires the goal and fixed specification to pass.

`orderStages` is the interactive path. Its generator advances through initialization, preservation, and the exit stage, yielding copied cumulative reports. Failure of initialization or preservation prevents later stages from executing. The exit stage checks both the supplied goal and fixed specification. A false exit result is retained as a warning, but enumeration continues so that a later arithmetic error is not hidden and candidate selection is not truncated. `order` is a synchronous wrapper over this same staged process.

Counterexamples retain every coordinate and the input context `a, b, n, m`; preservation failures also include the successor and an `outsideDomain` flag. Errors use stable codes and parameters that the interface translates into English or Korean.

### Traces and projections

Representative traces are illustrations, not evidence for the three obligations. Trace generation reports termination, repeated-state cycles, or departure from the finite window. The checker does not establish program termination; the mission explanations discuss it separately where relevant.

For a battlefield input `c`, the potential target set is:

```text
S(c) = { s in the mission window | I(s,c) && !G(s,c) }
Candidates = union of S(c) over the three battlefield inputs,
             restricted to the x–y board and deduplicated by coordinates
```

The postcondition does not filter this set. This is what allows a weak inductive invariant to damage friendlies or waste shots even when its exit guarantee fails. Off-board exit states still participate in verification but cannot be targeted.

`previewCandidatesForLevel` projects `I && !G`; `projectPredicate` projects a predicate without adding the exit condition. Both are unverified previews. Showing a candidate does not mean initialization or preservation has passed.

## Expression language and Dafny display

Player expressions are tokenized, parsed into a typed syntax tree, and evaluated directly. They are never executed through `eval` or `Function`.

Supported expressions include integer literals; `true`, `false`; coordinates and parameters; arithmetic `+ - * / %`; comparisons `== != < <= > >=`; Boolean `&& || !`; unary signs; and parentheses. Boolean operators short-circuit. The invariant must be Boolean. Function calls, property access, assignments, arbitrary identifiers, statement syntax, and quantifiers are not supported. In a two-variable state, `z` has no value even though the shared parser recognizes its name.

The parser caps source length at 4,096 characters, tokens at 1,024, and nesting depth at 128. Arithmetic values must be JavaScript safe integers; overflow and zero divisors are errors. Division and remainder use exact `BigInt` intermediates, then return checked safe integers with Dafny's Euclidean convention:

```text
a == (a / b) * b + a % b
0 <= a % b < |b|       when b != 0

-5 / 3 == -2
-5 % 3 == 1
 5 / -3 == -1
```

[dafny-program.js](../dist/dafny-program.js) accepts only the small trusted statement subset authored in the campaign. It displays declarations as `var x: int := ...;`, assignments with `:=`, absolute values as `if ... then ... else ...`, and the authored floor divisions as integer `/`. The displayed fragments assume enclosing inputs `a, b: int`; they are not complete generated methods. `n` and `m` appear as local `var` declarations but remain unchanged by the authored loops.

This adapter is not a general JavaScript-to-Dafny compiler, and the expression parser is not the entire Dafny language. Semantic tests compare authored initialization and transitions with the displayed fragments. No Dafny installation is required to run the game or its tests.

## Orders, targets, and scoring

Battle operations create new battle snapshots rather than mutating the caller's state. A valid shot removes the selected live units, records each hit coordinate, spends one order, and recomputes totals. Already hit coordinates are excluded, including locations of destroyed units.

| Result | Damage | Order cost |
| --- | --- | --- |
| Syntax, type, arithmetic, or execution error | None; stop at the error. | 0 |
| Initialization or preservation is false | Dud; stop before later verification stages. | 1 |
| Exit guarantee is false after the first two stages pass | Fire normally with an unproven-exit warning. | 1 if candidates remain |
| All checks pass | Fire normally. | 1 if candidates remain |
| No unhit candidates | No shot. | 0 |

Targets are sorted by neutral cells first, then friendlies, then enemies. Ties use ascending `x`, then `y`, then `z`. A single shot takes the first candidate; a salvo takes all remaining candidates. Both cost one order. The order does not affect unit point values.

```text
baseScore = accumulated enemy points - accumulated friendly losses + remaining orders
score = baseScore * multiplier
multiplier = 2 only when the clearing order passes all verification checks
             1 otherwise
```

Eliminating every enemy immediately completes the mission, even if the clearing shot's exit guarantee fails. Exhausting orders with enemies remaining ends the mission without clearing it. Only the final clearing order determines the verification bonus: an earlier verified shot is insufficient. The multiplier applies to the entire base score, including friendly losses and remaining orders. Finished battles reject further orders, so subsequent checks cannot add or repeat the bonus.

### Branch points and refinement risk

Infantry, armor, and artillery are worth 2, 4, and 6 points respectively, with the same magnitude used for friendly losses. The engine reads these values from the branch catalog; an arbitrary `unit.points` property cannot override them. Legacy untyped test units retain a one-point fallback.

For each of the three battlefield input contexts, `computeRefinementRisks`:

1. Fixes that input's `a, b, n, m` and checks the declared reference invariant over its state window.
2. Collects independent coordinate bounds containing the actual execution path.
3. Expands the rectangle or box until every state satisfying the reference invariant, the box bounds, and the guard has its successor inside the box.
4. Counts friendly coordinates in the resulting exit region: reference invariant, box bounds, and false guard.

When several inputs share one enemy endpoint, the exposed friendly coordinates are merged without duplicates. Zero exposed friendlies gives infantry, one gives armor, and two or more gives artillery. Friendly branches are assigned in stable coordinate order, one of each branch per mission.

This measures friendly leakage under a specific coarse abstraction. It does not measure the shortest possible invariant, intrinsic proof difficulty, distance to an ally, or single-shot priority. It intentionally permits equal values for different enemies. Scoring considers only the three battlefield contexts; it does not replace the verifier's separate 81-input coverage.

Unit SVGs use blue rectangular friendly frames and red diamond enemy frames, with crossed lines for infantry, an ellipse for armor, and a filled dot for artillery. These are the implemented frame/icon conventions, not a claim that the application implements the entire NATO symbology standard.

## Three-dimensional battlefields

`stateKey` distinguishes `(x,y)` from `(x,y,z)` and includes `z` whenever present. Units at the same x–y position on different layers are separate targets, with independent hits and points.

The selected layer affects observation only. Verification visits the entire declared three-dimensional window. Single shots use global candidate priority, and salvos strike unhit candidates on every layer. The interface selects a layer containing a shot when the current layer has no target. It renders shell and impact effects only for the visible layer, while damage, scoring, completion, and salvo audio use the full shot result. Trace lines connect consecutive positions only when both are on the selected layer.

## Presentation and audio

The firing sequencer advances the verifier once per stage. Successful initialization opens the breech; successful preservation loads the shell and closes the breech; a completed exit check leads to firing even when its result is false. A failed earlier obligation stops the sequence in place.

| Phase | Configured delay |
| --- | --- |
| Each verification-stage presentation | 280 ms before advancing the verifier |
| Breech open | 720 ms |
| Shell load | 1,220 ms |
| Breech close | 440 ms |
| Fire | 400 ms before flight delay |
| Flight delay / flight / impact | 220 / 640 / 700 ms |
| Radio / report | 120 / 280 ms |

These are presentation delays; computation and optional audio preparation can add time. After a fired order, the engine outcome is held until the radio-stage commit event. The application then applies damage, records, and score once. Early failures commit without a projectile sequence. Input editing, duplicate fire, mission changes, and layer changes are disabled during the sequence; sound can still be toggled.

The effects module reads current cell geometry instead of assuming fixed pixel dimensions. Its SVG overlay survives grid rerenders and does not modify game state. Reduced-motion preferences replace large movement and flashes with restrained indicators. Abort signals and generation checks prevent stale timers or callbacks from affecting a new mission. Page departure cancels the sequence and clears effects; hiding the document stops active audio.

### Sound assets

| Cue | Current source |
| --- | --- |
| Breech open | `sound1.mp3`, 0–0.68 s |
| Shell load | Entire `sound2.mp3`, approximately 1.176 s |
| Breech close | `sound1.mp3`, 0.68 s to the end, approximately 0.391 s |
| Fire | Entire `sound3.mp3`, approximately 3.370 s |
| Impact, salvo impacts, radio, bugle, failure | Web Audio synthesis |

The three recordings are in [dist/audio](../dist/audio/SOURCE.md). Their MPEG audio frames were preserved without re-encoding; ID3 metadata containing a local source path was removed. Playback retains speed, pitch, stereo channels, and recorded background sound, with constant per-source gain before the common output/compressor. The firing tail continues across normal phase transitions and may overlap flight, impact, and radio. The [audio source record](../dist/audio/SOURCE.md) contains exact intervals, gains, hashes, and the basis for the breech split.

Recording bytes are prefetched without creating an audio context. A user gesture enables or resumes audio and prepares shared decoded buffers; preparation is bounded by a four-second timeout. Missing audio or unsupported browser audio leaves the game and visual sequence usable. Cancellation, mute, and context-generation checks prevent delayed playback after an order has been abandoned. Salvo synthesis limits overlapping blasts to six, and the audio engine caps active sources at 48.

## Interface state, hints, and persistence

`loadLevel` handles initial load, mission changes, and restarts. It resets the invariant editor to `''`, sets the read-only goal to `goalSolution`, resets the hint stage, and clears battle-specific presentation state. An empty editor disables firing. Changing language or switching between map and program views does not reset an in-progress expression.

The first hint item contains the old `starter` formula and its first clue. Later hints accumulate without repeating the formula in additional items. Opening a hint never inserts text into the editor. The final hint reveals `solution` and the initialization, preservation, postcondition, and optional simplification explanations. Dynamic hint content is HTML-escaped. Current campaigns provide English and Korean copy for all of these sections.

Language selection prefers the saved value, then the first supported browser language, and otherwise Korean. Engine errors retain semantic codes and parameters so an existing report can be translated without rerunning the order.

| Local-storage key | Contents |
| --- | --- |
| `danger-close-language-v1` | `ko` or `en`. |
| `danger-close-sound-v1` | Sound preference; enabled unless the saved value is `off`. |
| `danger-close-best-proof-bonus-v1` | Current best completed score by mission ID. |
| `danger-close-best-general-v1` | Earlier proof-rule scores, displayed separately. |
| `danger-close-best-branches-v1`, `danger-close-best-math-v2` | Older records, retained and shown only for matching current IDs. |

Current best scores are written only for cleared missions, including unproven-exit clears scored at ×1. Older score namespaces are not numerically compared with the current scoring rules. Saved records are filtered to known mission IDs and safe integer values. Local-storage errors are caught so blocked or unavailable storage does not prevent play. The application does not save the current draft invariant or a battle for later resumption.

## Tests and extension points

The test command in [package.json](../package.json) uses Node's built-in test runner. Its suites cover the following responsibilities:

| Test group | Coverage |
| --- | --- |
| `engine`, `initialized-engine`, `xyz-engine` | Parser safety, input identity, immutable parameters, state enumeration, counterexamples, dimensional compatibility, and targeting. |
| `dafny-arithmetic`, `dafny-program` | Euclidean integer arithmetic and agreement between displayed programs and authored transitions. |
| `level-semantics`, `campaign`, `invariant-simplification` | Algorithm results, enemy endpoints, example invariant checks, campaign regressions, and counterexamples to weakened solutions. |
| `weighted-scoring`, `refinement-risk` | Branch catalog, friendly exposure, score totals, and separation from shot ordering. |
| `staged-order`, `firing-sequence` | Stage short-circuiting, exit warnings, delayed commits, order costs, cancellation, and final-shot bonuses. |
| `artillery-audio`, `audio-readiness`, `battle-effects` | Recorded cue mapping, loading failures, lifecycle cleanup, scheduling, and visual effects independent of battle state. |
| `i18n`, `layer-view` | Translation consistency, hint gating and escaping, layer controls, and cross-layer presentation. |

Several presentation tests use controlled clocks, audio objects, or DOM fixtures, so they run without a real browser or audio device. They complement browser checks of responsive layout, keyboard access, actual decoding, and visible firing sequences.

When adding or changing a mission:

1. Define a general mathematical computation, its external-input initialization, and a fixed relational `goalSolution`. Keep verification-window bounds separate from the input contract.
2. Supply equivalent `step`, `guardSource`, and authored display source. Extend the restricted Dafny adapter and its semantic tests only if the new program needs additional notation.
3. Choose finite domains that contain all initialized states and successors admitted by the intended invariant for tested inputs. Account for hypothetical invariant states, not just reachable traces.
4. Select three distinct tested battlefield inputs with on-board terminal coordinates. Supply three non-overlapping allies. The mission factory derives and deduplicates enemy endpoints.
5. Provide an inductive `referenceInvariant` for refinement scoring, a first-hint `starter`, a full `solution`, and all English/Korean hints and proof sections. Preserve the editor's empty initial state.
6. Add semantic, verification, and relevant scoring or layer regressions. For a simplified invariant, test why a removed condition is redundant and why each remaining essential condition matters.
7. Preserve existing IDs and score meanings when extending the campaign. If scoring semantics change, use a distinct storage namespace rather than silently comparing incompatible scores.

General algebraic explanations in the mission reference are separate from finite test results. Neither example traces nor a green checker report should be presented as an unbounded proof.
