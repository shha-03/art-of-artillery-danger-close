# Implementation

This document describes the current implementation of Art of Artillery: Danger Close. See the [README](../README.md) for running, testing, and playing the game, and the [mission reference](levels.md) for algorithms, example invariants, and specifications.

## Architecture and source map

The application is a static site built from native JavaScript modules, HTML, and CSS, with the official Z3 WebAssembly solver running locally in the browser. It has no verification server or remote score service. [server.mjs](../server.mjs) serves `dist/` on the loopback interface, with port 4173 by default and an optional `PORT` environment variable. The application modules and committed solver assets in `dist/` form the deployable site; local play does not require a build.

| File | Responsibility |
| --- | --- |
| [dist/index.html](../dist/index.html), [dist/style.css](../dist/style.css) | Page structure, dialogs, responsive layout, and visual styling. |
| [dist/app.js](../dist/app.js) | Mission selection, editor state, rendering, layers, input events, firing orchestration, and local persistence. |
| [dist/engine.js](../dist/engine.js) | Concrete traces, level validation, battle transitions, scoring, and retained bounded reference/test helpers. It does not decide live proof results. |
| [dist/smt-program.js](../dist/smt-program.js) | Exact typed expression parsing, symbolic execution of authored initialization and loop bodies, and generation of SMT proof obligations. |
| [dist/smt-engine.js](../dist/smt-engine.js) | Asynchronous staged verification, exact counterexample reports, BigInt battlefield projection, and battle resolution. |
| [dist/z3-checker.js](../dist/z3-checker.js), [dist/z3-runtime.js](../dist/z3-runtime.js) | Serialized Z3 transactions, exact models, timeouts, cancellation, and lazy WebAssembly initialization. |
| [dist/bootstrap.js](../dist/bootstrap.js), [dist/isolation-worker.js](../dist/isolation-worker.js) | Browser isolation startup and a same-origin response-header fallback for static hosts. |
| [scripts/build-z3.mjs](../scripts/build-z3.mjs), [dist/vendor](../dist/vendor/z3-manifest.json) | Reproducible packaging of the official solver and its license, hashes, and asset sizes. |
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

Every active mission has the external-input contract `(a, b) ∈ ℤ²`, and Z3 verifies that full domain. Initialization normally defines `n = |a|` and `m = |b|`, then sets the loop's mutable coordinates. Some algorithms retain signed inputs directly, such as the integer-mean mission. These operations define the algorithm; they do not clamp inputs to a display window or reduce them to the three displayed examples.

The mutable state is `(x, y)` or `(x, y, z)`. The parameters `a`, `b`, `n`, and `m` are fixed for an execution. The symbolic compiler derives the parameter expressions from initialization and rejects assignments to immutable inputs or parameters in the loop. For concrete trace and scoring helpers, the engine supplies `step` with a copied state containing non-writable parameter properties and retains the original parameters in the successor. Only declared coordinates are taken from the returned state.

Unrestricted external inputs do not imply unrestricted loop-entry coordinates. Initialization can establish a useful relation such as `x + y == n`; the player's invariant must hold after this initialization.

### Level contract

| Field | Meaning |
| --- | --- |
| `id`, `chapter` | Stable mission identity and chapter membership. Saved scores use the ID. |
| `variables` | `['x', 'y']` by default, or explicitly `['x', 'y', 'z']`. |
| `domains` | Finite display/trace/scoring intervals; the z interval also selects available battlefield layers. Unspecified axes use `[-32, 32]`. These values never constrain Z3 proof queries. |
| `initialize({a, b})` | Concrete reference initializer for representative traces, layout, and compatibility tests. Its safe-number and display-domain checks are not the symbolic input contract. |
| `initializationCode` | Trusted authored initialization source, symbolically compiled for proof and converted for display by the Dafny adapter. |
| `battleInputs` | Exactly three distinct `{a, b}` display examples. Existing layout helpers require safe, small values within `[-4, 4]`; this is not a proof precondition. |
| `guardSource` | Boolean loop condition in the expression parser's syntax. |
| `step(state)` | Concrete reference transition for trace/scoring helpers. It must agree with the authored program but is never invoked to construct symbolic proof results. |
| `code` | Trusted authored loop source used for symbolic execution, Dafny display, and semantic consistency tests. |
| `goalSolution` | Fixed mathematical postcondition. It remains independently checked even if another goal expression is passed to the engine. |
| `solution` | Example invariant disclosed with the final hint. |
| `starter` | Former default formula, now displayed only in the first hint item. It is not the editor's initial value. |
| `referenceInvariant` | Coarse invariant used for refinement-risk scoring; normally also the source of `starter`. It is separate from the full solution. |
| `hints`, `explanation`, `en` | Korean content, proof sections, and their English counterparts. Proof fields are `initial`, `preservation`, `postcondition`, and optional `note`. |
| `size`, `commands`, `allies`, `enemies` | Board extent, order budget, and unit coordinates. Active missions use a 9×9 board and six orders. |

The mission factories execute the three battlefield examples to obtain actual terminal coordinates, then deduplicate them into enemy positions. The branch-assignment layer expects one to three unique enemies and exactly three distinct allies, without overlapping coordinates. The factory does not derive enemy positions from arbitrary points satisfying `ensures`.

The concrete reference engine retains legacy `initial`, `initialStates`, and `initialCondition` forms for tests. The live SMT path requires an authored initialization and loop. It rejects unsupported callback-only programs instead of guessing their semantics or falling back to bounded checking.

## Unbounded SMT verification

### Scope

The live firing path uses Z3 integer arithmetic with no input or coordinate-window bounds. It verifies the authored program's partial correctness; it does not run the Dafny verifier or prove loop termination. The visible map, sampled execution traces, and scoring approximation remain finite, but their limits never become assumptions in a proof query.

`smt-program.js` parses the trusted authored initialization and one loop, then executes declarations, sequential assignments, and nested `if/else` branches symbolically. Branches become conditional SMT expressions. It checks that the loop header agrees with `guardSource`. Supported authored arithmetic includes `Math.abs` and the campaign's floor division by positive literal divisors. Unsupported syntax fails explicitly. Arbitrary JavaScript callbacks are not evaluated by the compiler.

The initialization expressions bind `n` and `m` to the external inputs, preserving relationships such as `n = |a|`. Preservation and exit queries keep these parameter relationships but do not assume that an arbitrary loop-head state was reached by a concrete execution.

### Obligations and reports

For a candidate invariant `I`, guard `G`, transition `T`, and postcondition `Q`, the compiler asks Z3 whether a counterexample to each obligation exists:

1. **Initialization:** some integer input pair makes `I(initialize(a,b))` false.
2. **Preservation:** some integer state satisfies `I(s) && G(s)` but not `I(T(s))`.
3. **Guarantee on exit:** some integer state satisfies `I(s) && !G(s)` but not `Q(s)`.

`unsat` means no such counterexample exists, so the obligation passes. `sat` refutes it and supplies a model. `unknown`, timeout, unsupported input, or runtime failure never counts as a proof. There is no bounded fallback. States outside the map and unreachable states participate in the same integer proof; a successor leaving a display window does not by itself fail preservation.

The asynchronous `orderStagesSmt` generator is the live interactive path. It advances through initialization, preservation, and the exit stage, yielding copied cumulative reports. Failed initialization or preservation stops before later obligations. The exit stage checks both the supplied goal and immutable `goalSolution`, so changing an engine argument cannot replace the operation's fixed specification. `valid` means initialization and preservation passed; `objectiveVerified` additionally requires both exit checks to pass.

For a successful order in the current campaign, three visible stages contain four logical checks: initiation, preservation, the supplied goal, and the fixed specification. Each has its own definedness query, making eight solver queries in total. The read-only UI supplies the same expression for the two exit checks, but the engine still checks them independently. A failed earlier stage or an inconclusive query ends the sequence before the remaining queries run.

Before every logical query, a separate definedness query checks for division or remainder by zero. The invariant must be defined for the relevant parameter contexts and arbitrary states; guard evaluation is required where the invariant holds, body evaluation where both invariant and guard hold, and postcondition evaluation at invariant-admitted exits. Boolean `&&` and `||` respect short-circuiting, so `y != 0 && x / y > 0` does not evaluate its division at `y == 0`. A definedness counterexample is an error and costs no order. This separate check prevents a logical counterexample from hiding an undefined expression elsewhere.

Counterexamples retain coordinates and `a, b, n, m`; preservation reports also include successor coordinates. All model integers are serialized as exact signed decimal strings, including values outside JavaScript's safe-number range. Only representable, visible coordinates can be highlighted on the map; the text report retains the full model. Errors use stable codes and parameters for English/Korean reporting.

The old `analyze`, `orderStages`, `order`, and finite case-enumeration helpers in `engine.js` remain available to reference tests and legacy code. The browser firing path imports `orderStagesSmt`; it never uses those bounded helpers as proof evidence or recovery behavior.

### Solver runtime, deadlines, and cancellation

`z3-checker.js` exposes `checkSmt(script, bindings, {signal, timeoutMs})`. Internally generated SMT-LIB scripts declare integer symbols and assert the counterexample query; raw player text never goes directly to Z3's parser. Model bindings may contain integer terms, so the checker introduces fresh aliases and evaluates their exact values after a satisfiable result.

Context creation, parsing, asynchronous solving, model reads, and cleanup share one serialized transaction queue. This is necessary because the official runtime's asynchronous-check mutex does not make concurrent synchronous Z3 calls safe. Each query has a default five-second solver deadline. Definedness and logical queries have separate deadlines; a stage can contain several queries. An extra one-second watchdog terminates a stalled worker and resets the module. Cancellation does the same, and a later request initializes a clean solver. Initial WebAssembly loading has a separate 45-second limit. These are time limits, not integer-domain restrictions.

Unknown or unavailable results stop firing and leave orders, damage, and score unchanged. Nonlinear integer arithmetic is not decidable in general, so a correct expression can still return unknown or time out. Only `unsat` is accepted as proof.

### Traces and projections

Representative traces are illustrations, not evidence for the obligations. Concrete trace generation retains finite display limits and reports termination, repeated-state cycles, or departure from that display window. The symbolic checker does not establish program termination; the mission explanations discuss it separately where relevant.

For a battlefield input `c`, the potential target set is:

```text
S(c) = { s on the visible board and declared z layers | I(s,c) && !G(s,c) }
Candidates = union of S(c) over the three battlefield inputs,
             deduplicated by full coordinates
```

The postcondition does not filter this set. This is what allows a weak inductive invariant to damage friendlies or waste shots even when its exit guarantee fails. Off-board exit states still participate in verification but cannot be targeted.

`previewCandidatesSmt` projects `I && !G` using BigInt arithmetic. `projectPredicate` is a retained concrete helper for other display predicates. These are unverified previews: showing a candidate does not mean initialization or preservation has passed. The proof does not enumerate this map or its sample inputs.

## Expression language and Dafny display

Player expressions are tokenized and parsed into a typed syntax tree. The proof compiler translates that tree into SMT terms, and the map preview evaluates it with BigInt arithmetic. Expressions are never executed through `eval` or `Function`.

Supported expressions include integer literals; `true`, `false`; coordinates and parameters; arithmetic `+ - * / %`; comparisons `== != < <= > >=`; Boolean `&& || !`; unary signs; and parentheses. Boolean operators short-circuit. The invariant must be Boolean. Function calls, property access, assignments, arbitrary identifiers, statement syntax, and quantifiers are not supported in player expressions. The SMT parser rejects `z` for two-variable operations.

The SMT expression parser caps source length at 4,096 characters, tokens at 1,024, and nesting depth at 128. Integer literals stay as decimal strings instead of passing through JavaScript `Number`; arithmetic is unbounded in Z3 and uses BigInt for map projection. Concrete reference traces and layout helpers still use safe numbers for their small displayed examples. Division and remainder follow Dafny's Euclidean convention:

```text
a == (a / b) * b + a % b
0 <= a % b < |b|       when b != 0

-5 / 3 == -2
-5 % 3 == 1
 5 / -3 == -1
```

[dafny-program.js](../dist/dafny-program.js) accepts only the small trusted statement subset authored in the campaign. It displays declarations as `var x: int := ...;`, assignments with `:=`, absolute values as `if ... then ... else ...`, and the authored floor divisions as integer `/`. The displayed fragments assume enclosing inputs `a, b: int`; they are not complete generated methods. `n` and `m` appear as local `var` declarations but remain unchanged by the authored loops.

This adapter is not a general JavaScript-to-Dafny compiler, and the expression parser is not the entire Dafny language. Semantic tests compare authored initialization and transitions with the displayed fragments. No Dafny installation is required to run the game or its tests.

## Browser packaging and hosting

The pinned dependencies are `z3-solver@5.3.1` and development build tool `esbuild@0.28.2`. Node.js 20 or later is required for development. Install with `npm ci`; `npm run build` runs [scripts/build-z3.mjs](../scripts/build-z3.mjs) to regenerate committed assets. Tests require the installed Node package even though a checkout can serve the already-built browser files without installation.

The build bundles the official browser API as `z3-api.js`, copies `z3-built.js` unchanged, and stores the WASM binary as `z3-built.wasm.gz`. The runtime decompresses gzip locally and passes the binary to official `init`. The compressed asset is about 7.9 MB, compared with about 34.6 MB uncompressed. `z3-manifest.json` records exact sizes, hashes, and the package version; the MIT license is included. The Emscripten script remains separate because it is also the entry point for Z3's pthread workers. No runtime CDN download or remote verification request is needed.

The [official Z3 JavaScript bindings](https://github.com/Z3Prover/z3/blob/master/src/api/js/PUBLISHED_README.md) require WebAssembly threads and `SharedArrayBuffer`. Browser play therefore requires HTTPS or localhost, a compatible modern browser, and cross-origin isolation:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The local server sends these headers. The committed `_headers` file supplies a declaration for compatible static hosts. On a host that does not apply them, `bootstrap.js` can install the same-origin `isolation-worker.js` before importing gameplay. It waits up to eight seconds for control, then reloads at most once per tab session to activate isolation. It does not reload a game already in progress.

The service worker adds headers only to known same-origin game assets and the recognized game document. It preserves the original request and ignores redirects, error responses, cross-origin requests, and sign-in pages. It stores no response cache. Existing unrelated service workers are left alone. If isolation or the runtime is unavailable, verification reports an inconclusive result and never switches to finite checks. Some embedded browsers may restrict isolation even when a normal browser supports it.

The current public deployment was checked on October 24, 2026: direct HTTP responses did not include the isolation headers, and the service-worker path successfully enabled real Z3 verification in the browser. Merely uploading `_headers` is therefore not sufficient evidence that a host applies it. When changing hosts, test a firing order after startup as well as checking the HTTP responses.

If verification cannot start, distinguish runtime setup failures from undecided proof queries:

| Symptom | What to check |
| --- | --- |
| First order waits for solver loading | The same-origin `vendor/z3-api.js`, `vendor/z3-built.js`, and `vendor/z3-built.wasm.gz` assets must be accessible. Initialization has a 45-second deadline. |
| `Z3_ISOLATION_REQUIRED` | Serve over HTTPS or localhost; confirm `crossOriginIsolated` is true after startup. Configure the headers or permit the application's service-worker fallback. |
| `Z3_UNSUPPORTED` | The browser must support WebAssembly, shared memory, and `DecompressionStream`. Try a compatible standalone browser if an embedded browser restricts them. |
| An undecided proof query or a proof-query timeout | If runtime setup succeeded, the solver could not establish the obligation. Inspect or simplify the expression; no proof, damage, or order charge is recorded. |

These cases are distinct from `sat`, which supplies a counterexample to a logical obligation or an expression's definedness. No setup failure or undecided query is converted into a successful finite check.

## Orders, targets, and scoring

Battle operations create new battle snapshots rather than mutating the caller's state. A valid shot removes the selected live units, records each hit coordinate, spends one order, and recomputes totals. Already hit coordinates are excluded, including locations of destroyed units.

| Result | Damage | Order cost |
| --- | --- | --- |
| Syntax, type, arithmetic, or execution error | None; stop at the error. | 0 |
| Z3 unavailable, timeout, unknown, or cancelled verification | None; stop without claiming a proof. | 0 |
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

This measures friendly leakage under a specific coarse abstraction. It does not measure the shortest possible invariant, intrinsic proof difficulty, distance to an ally, or single-shot priority. It intentionally permits equal values for different enemies. Scoring considers only the three battlefield contexts and finite abstraction windows; it does not replace or constrain the unbounded SMT proof.

Unit SVGs use blue rectangular friendly frames and red diamond enemy frames, with crossed lines for infantry, an ellipse for armor, and a filled dot for artillery. These are the implemented frame/icon conventions, not a claim that the application implements the entire NATO symbology standard.

## Three-dimensional battlefields

`stateKey` distinguishes `(x,y)` from `(x,y,z)` and includes `z` whenever present. Units at the same x–y position on different layers are separate targets, with independent hits and points.

The selected layer affects observation only. Z3 verifies arbitrary integer values of all three coordinates. Single shots use global candidate priority, and salvos strike unhit candidates on every available battlefield layer. The interface selects a layer containing a shot when the current layer has no target. It renders shell and impact effects only for the visible layer, while damage, scoring, completion, and salvo audio use the full shot result. Trace lines connect consecutive positions only when both are on the selected layer.

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
| `danger-close-best-smt-proof-v1` | Current best completed score under the Z3 rules, by mission ID. |
| `danger-close-best-proof-bonus-v1`, `danger-close-best-general-v1` | Earlier bounded-verification scores, preserved and displayed separately. |
| `danger-close-best-branches-v1`, `danger-close-best-math-v2` | Older records, retained and shown only for matching current IDs. |

Current best scores are written only for cleared missions, including unproven-exit clears scored at ×1. Older score namespaces are not numerically compared with the current scoring rules. Saved records are filtered to known mission IDs and safe integer values. Local-storage errors are caught so blocked or unavailable storage does not prevent play. The application does not save the current draft invariant or a battle for later resumption.

## Tests and extension points

The test command in [package.json](../package.json) uses Node's built-in test runner. Its suites cover the following responsibilities:

| Test group | Coverage |
| --- | --- |
| `smt-program`, `smt-engine`, `z3-checker`, `smt-campaign`, `smt-order-z3`, `smt-firing-sequence` | Symbolic semantics, unbounded proof obligations, all 24 example solutions in real Z3, counterexamples beyond the old input/state bounds, exact models, definedness, timeout/cancellation, unknown handling, and asynchronous firing behavior. |
| `engine`, `initialized-engine`, `xyz-engine` | Concrete/reference parser safety, input identity, immutable parameters, retained bounded helpers, dimensional compatibility, and targeting. |
| `dafny-arithmetic`, `dafny-program` | Euclidean integer arithmetic and agreement between displayed programs and authored transitions. |
| `level-semantics`, `campaign`, `invariant-simplification` | Algorithm results, enemy endpoints, example invariant checks, campaign regressions, and counterexamples to weakened solutions. |
| `weighted-scoring`, `refinement-risk` | Branch catalog, friendly exposure, score totals, and separation from shot ordering. |
| `staged-order`, `firing-sequence` | Stage short-circuiting, exit warnings, delayed commits, order costs, cancellation, and final-shot bonuses. |
| `artillery-audio`, `audio-readiness`, `battle-effects` | Recorded cue mapping, loading failures, lifecycle cleanup, scheduling, and visual effects independent of battle state. |
| `i18n`, `layer-view` | Translation consistency, hint gating and escaping, layer controls, and cross-layer presentation. |

Several presentation tests use controlled clocks, audio objects, or DOM fixtures, so they run without a real browser or audio device. They complement browser checks of responsive layout, keyboard access, actual decoding, and visible firing sequences.

After `npm ci`, run the real-solver campaign and order regressions directly with:

```sh
node --test smt-campaign.test.mjs smt-order-z3.test.mjs
```

The campaign suite requires all eight queries for every authored solution to return `unsat`: 192 queries across 24 operations. The order regressions exercise actual counterexamples beyond the retired bounds, exact integers beyond JavaScript's safe range, division-by-zero rejection, and firing without a proved exit guarantee. These tests use the live SMT modules, not the retained finite reference verifier.

When adding or changing a mission:

1. Define a general mathematical computation, its external-input initialization, and a fixed relational `goalSolution`. Keep display limits separate from the unrestricted proof domain.
2. Supply equivalent `step`, `guardSource`, and authored source. Extend both the restricted symbolic compiler and Dafny adapter, with semantic tests, if the new program needs additional notation. Never substitute concrete samples for unsupported symbolic semantics.
3. Choose finite display/trace/scoring domains and z layers appropriate for representative examples. These values cannot repair an invalid unbounded invariant; establish its correctness independently with Z3.
4. Select three distinct supported battlefield inputs with on-board terminal coordinates. Supply three non-overlapping allies. The mission factory derives and deduplicates enemy endpoints.
5. Provide an inductive `referenceInvariant` for refinement scoring, a first-hint `starter`, a full `solution`, and all English/Korean hints and proof sections. Preserve the editor's empty initial state.
6. Add semantic, verification, and relevant scoring or layer regressions. For a simplified invariant, test why a removed condition is redundant and why each remaining essential condition matters.
7. Preserve existing IDs and score meanings when extending the campaign. If scoring semantics change, use a distinct storage namespace rather than silently comparing incompatible scores.

The mission reference provides human-readable algebraic explanations. A passing live check represents an unbounded Z3 proof of the corresponding modeled obligation; sample traces and finite reference tests do not. Proving all obligations establishes partial correctness, not termination or support for arbitrary Dafny programs.
