# Operations and Example Invariants

**Spoilers:** this document includes an example solution and its reasoning for every operation. Use the in-game staged hints if you want to discover the invariants yourself.

For controls and rules, see the [README](../README.md). For the checker, state representation, and battlefield generation, see [implementation details](implementation.md).

## Shared conventions

The campaign contains 24 operations in six chapters: `g01`–`g20` use state `(x, y)`, and `s01`–`s04` use `(x, y, z)`. All operations accept arbitrary external integer inputs `a` and `b`. Their common initialization is:

```dafny
var n: int := if a < 0 then -a else a;
var m: int := if b < 0 then -b else b;
```

Thus `n = |a|` and `m = |b|` are nonnegative. The loop never changes `a`, `b`, `n`, or `m`. Each program below continues after these two declarations. Most operations start from the magnitudes; `g08` starts `x` at signed input `a`, and `g12` starts `(x, y)` at the original signed pair `(a, b)`. Some operations do not need both inputs.

Programs use the same Dafny method-body notation shown in the game. They are fragments with `a, b: int` supplied externally, not complete verified Dafny methods. Assignments execute in the order shown. Integer `/` and `%` use Dafny Euclidean division: for nonzero `d`, `v == (v / d) * d + v % d` and `0 <= v % d < |d|`. In particular, `%` is nonnegative even for negative dividends.

Each **Example invariant** is the current authored solution, not a unique answer. Enter the Boolean expression alone in the game, without an `invariant` keyword or semicolon. **Ensures** is the fixed postcondition. The invariant input starts blank; the first hint offers a weaker reference formula, and the final hint reveals the example solution and proof explanation.

The three obligations discussed below are:

1. **Initiation:** initialization establishes the invariant.
2. **Preservation:** whenever the invariant and loop guard hold, one complete iteration establishes the invariant again.
3. **On exit:** the invariant together with the negated guard implies the fixed `ensures`.

An invariant may include unreachable states. Extra bounds are deliberately omitted when they are unnecessary for these obligations. The explanations give algebraic arguments over mathematical integers. The game uses Z3 to check the corresponding symbolic obligations over that same unbounded integer domain; an obligation passes only when its negation is unsatisfiable. These obligations address partial correctness, not a termination proof.

## Input and verification scope

Both the input contract and the Z3 verification domain cover all mathematical integer pairs `(a, b) ∈ ℤ²`. The solver derives `n = |a|` and `m = |b|` from the authored initialization, then checks initiation, preservation, and the fixed postcondition without coordinate or input-window bounds. Preservation includes hypothetical unreachable states satisfying the invariant and guard. Leaving the visible map or a display window does not by itself fail preservation.

Before each logical obligation, the game checks that relevant expressions are defined. Division or remainder by zero is rejected, respecting Boolean short-circuiting. A solver result of `unsat` proves the obligation; `sat` supplies an exact integer counterexample. A timeout or `unknown` result is inconclusive and stops the order without damage or an order charge. There is no finite-checking fallback. Nonlinear arithmetic may be inconclusive even for a correct invariant. The game does not prove loop termination.

Each battlefield uses three representative external inputs. Enemy positions are their actual loop endpoints, with duplicate coordinates merged. These samples illustrate the algorithm and never restrict the proof domain. Candidate targets come from the invariant and negated guard for those samples, restricted to the visible board. A correct invariant can still include neutral cells.

The finite dimensions below are retained for visualization, example traces, and the existing scoring approximation. They are not assumptions supplied to Z3.

| Operations | Visible x–y board | Available z layers |
| --- | --- | --- |
| `g01`–`g20` | `0 <= x, y <= 8` | Two-dimensional board. |
| `s01` | `0 <= x, y <= 8` | `1 <= z <= 9` |
| `s02`, `s03` | `0 <= x, y <= 8` | `0 <= z <= 4` |
| `s04` | `0 <= x, y <= 8` | `0 <= z <= 16` |

In three-variable operations, the selected `z` layer changes the view only. Salvos cover every available battlefield layer; the proof itself covers all integer values of `z`.

## Campaign index

| Chapter | Operations | Focus |
| --- | --- | --- |
| 1. Inputs & Conservation | `g01`, `g02`, `g03`, `g04` | Remember arbitrary integer inputs in fixed parameters. Relate completed and remaining work through sums and weighted sums. |
| 2. Branches & Bounds | `g05`, `g06`, `g07`, `g08` | Analyze alternative exits and sign branches. Preserve the relations that depend on input order. |
| 3. Division & Balance | `g09`, `g10`, `g11`, `g12` | Compute quotients, remainders, ceilings, and cycles. Extend the reasoning to the mean of signed inputs. |
| 4. Sums & Polynomials | `g13`, `g14`, `g15`, `g16` | Use finite differences and remaining sums. Connect iterative accumulation to general polynomial specifications. |
| 5. Squares & Search | `g17`, `g18`, `g19`, `g20` | Combine higher-degree conservation with two-sided bounds. Verify square roots by subtraction, accumulation, and binary search. |
| 6. Three Variables & Layers | `s01`, `s02`, `s03`, `s04` | Establish relations among three state variables. Inspect the battlefield on each z layer and eliminate enemies across every layer. |

## Chapter 1: Inputs & Conservation

### 01. Countdown Transfer (g01)

Transfer n, the magnitude of any integer a, into y. x tracks the work remaining. Remember the input in n to use one invariant for every input.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  x := x - 1;
  y := y + 1;
}
```

**Example invariant**

```text
x >= 0 && x + y == n
```

**Ensures**

```text
x == 0 && y == n
```

- **Initiation:** Initially x = n and y = 0. Since n ≥ 0, both x ≥ 0 and x + y = n hold.
- **Preservation:** For integer x > 0, decrementing x preserves x ≥ 0. Incrementing y by the same amount preserves the sum.
- **On exit:** At exit x ≤ 0. Together with x ≥ 0 this gives x = 0, so the conserved sum gives y = n.

**Sufficiency:** The bound x ≤ n is unnecessary. An invariant need not record every property of the actual execution.

### 02. Addition (g02)

Add the magnitudes n and m of two integers. Transfer one unit at a time from x into y to obtain n + m.

**Program**

```dafny
var x: int := n;
var y: int := m;
while x > 0 {
  x := x - 1;
  y := y + 1;
}
```

**Example invariant**

```text
x >= 0 && x + y == n + m
```

**Ensures**

```text
x == 0 && y == n + m
```

- **Initiation:** Initially (x,y) = (n,m), so x ≥ 0 and x + y = n + m.
- **Preservation:** Subtract 1 from positive x and add 1 to y. Nonnegativity of x and the sum are preserved.
- **On exit:** At exit x ≤ 0; the invariant gives x ≥ 0. Thus x = 0 and y = n + m.

**Sufficiency:** Neither x ≤ n nor y ≥ m is needed for the three proof obligations.

### 03. Doubling (g03)

Accumulate 2 for n iterations. Balance each one-unit decrease in x against the two-unit increase in y.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  y := y + 2;
  x := x - 1;
}
```

**Example invariant**

```text
x >= 0 && 2 * x + y == 2 * n
```

**Ensures**

```text
x == 0 && y == 2 * n
```

- **Initiation:** Initially (x,y) = (n,0), giving x ≥ 0 and 2x + y = 2n.
- **Preservation:** 2(x − 1) + (y + 2) = 2x + y. The guard x > 0 also preserves nonnegativity of x.
- **On exit:** At exit x = 0. Substitution into 2x + y = 2n yields y = 2n.

**Sufficiency:** Removing x ≤ n does not affect preservation or the result at exit.

### 04. Repeated-Addition Product (g04)

Add m exactly n times to compute n * m. The same loop and specification also handle m == 0.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  y := y + m;
  x := x - 1;
}
```

**Example invariant**

```text
x >= 0 && m * x + y == n * m
```

**Ensures**

```text
x == 0 && y == n * m
```

- **Initiation:** Initially (x,y) = (n,0), so x ≥ 0 and mx + y = nm, including when m = 0.
- **Preservation:** m(x − 1) + (y + m) = mx + y. Decrementing positive integer x also preserves x ≥ 0.
- **On exit:** At exit x = 0, and mx + y = nm therefore gives y = nm.

**Sufficiency:** The upper bound x ≤ n is unnecessary. The weighted conservation law and the lower bound on x suffice.

## Chapter 2: Branches & Bounds

### 05. Minimum by Filling (g05)

Fill capacity m from a supply of n to compute y = min(n,m). Account for both exits: exhausted supply and full capacity.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 && y < m {
  x := x - 1;
  y := y + 1;
}
```

**Example invariant**

```text
x >= 0 && y <= m && x + y == n
```

**Ensures**

```text
(n <= m && x == 0 && y == n) || (n > m && x == n - m && y == m)
```

- **Initiation:** At (n,0), x ≥ 0, y ≤ m, and x + y = n all hold.
- **Preservation:** The integer guard x > 0 and y < m gives x − 1 ≥ 0 and y + 1 ≤ m. The sum is unchanged.
- **On exit:** At exit x = 0 or y = m. If n ≤ m, the result must be (0,n); if n > m, it must be (n − m,m).

**Sufficiency:** The exit result implies y ≥ 0. It does not need a separate invariant clause.

### 06. Cancellation (g06)

Subtract equal amounts from both magnitudes. The smaller side reaches zero first; the other retains their difference.

**Program**

```dafny
var x: int := n;
var y: int := m;
while x > 0 && y > 0 {
  x := x - 1;
  y := y - 1;
}
```

**Example invariant**

```text
x >= 0 && y >= 0 && x - y == n - m
```

**Ensures**

```text
(n >= m && x == n - m && y == 0) || (n < m && x == 0 && y == m - n)
```

- **Initiation:** At (n,m), both coordinates are nonnegative and x − y = n − m.
- **Preservation:** Only positive integers are decremented, preserving both lower bounds. (x − 1) − (y − 1) = x − y.
- **On exit:** At exit x = 0 or y = 0. The sign of the conserved difference determines (n − m,0) or (0,m − n).

**Sufficiency:** The initial-value upper bounds x ≤ n and y ≤ m are unnecessary. Keep both lower bounds and the difference.

### 07. Maximum by Equalization (g07)

Increase only the smaller value until both coordinates equal max(n,m). The initially larger side stays fixed.

**Program**

```dafny
var x: int := n;
var y: int := m;
while x != y {
  if x < y {
    x := x + 1;
  } else {
    y := y + 1;
  }
}
```

**Example invariant**

```text
(n >= m && x == n && y <= n) || (n < m && y == m && x <= m)
```

**Ensures**

```text
x == y && x >= n && x >= m && (x == n || x == m)
```

- **Initiation:** If n ≥ m, x = n and y = m ≤ n. Otherwise y = m and x = n ≤ m.
- **Preservation:** In the first branch x = n and y ≤ n. When x ≠ y, only y increments, preserving y ≤ n. The second branch is symmetric.
- **On exit:** At exit x = y. Both values equal n in the first branch and m in the second, hence max(n,m).

**Sufficiency:** The moving variable needs no lower bound tied to its initial value. The fixed larger value and its upper bound suffice.

### 08. Manhattan Distance (g08)

Move signed coordinate a to zero while adding the distance to |b|. The final y is |a| + |b|.

**Program**

```dafny
var x: int := a;
var y: int := m;
while x != 0 {
  if x > 0 {
    x := x - 1;
  } else {
    x := x + 1;
  }
  y := y + 1;
}
```

**Example invariant**

```text
y <= n + m && (x + y == n + m || y - x == n + m)
```

**Ensures**

```text
x == 0 && y == n + m
```

- **Initiation:** Initially x = a and y = m, so y + |x| = m + |a| = n + m.
- **Preservation:** Together with y ≤ n + m, the first equality implies x ≥ 0 and the second x ≤ 0. Thus the formula is y + |x| = n + m. Each active step decreases |x| by 1 and increases y by 1.
- **On exit:** The exit condition is x = 0, so the conserved relation gives y = n + m.

**Sufficiency:** The bound y ≥ m is unnecessary. The shared upper bound also replaces separate sign guards, including the transition from x = −1 to 0.

## Chapter 3: Division & Balance

### 09. Quotient and Remainder (g09)

Divide n by the positive divisor m + 1. x becomes the remainder and y the quotient. The divisor is nonzero for every integer b.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x >= m + 1 {
  x := x - (m + 1);
  y := y + 1;
}
```

**Example invariant**

```text
x >= 0 && x + (m + 1) * y == n
```

**Ensures**

```text
x >= 0 && x < m + 1 && y >= 0 && x + (m + 1) * y == n
```

- **Initiation:** Let d = m + 1 ≥ 1. At (n,0), x ≥ 0 and x + dy = n.
- **Preservation:** Subtract d only when x ≥ d, preserving x ≥ 0. (x − d) + d(y + 1) = x + dy.
- **On exit:** At exit 0 ≤ x < d. Since n ≥ 0, dy = n − x > −d, so integer y ≥ 0. This establishes the quotient-and-remainder specification.

**Sufficiency:** The conserved relation and the exit interval imply y ≥ 0. It needs no separate invariant clause.

### 10. Ceiling Division (g10)

Subtract capacity m + 1 while work remains. y counts the minimum number of batches; x is the nonpositive residual.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  x := x - (m + 1);
  y := y + 1;
}
```

**Example invariant**

```text
x >= -m && x + (m + 1) * y == n
```

**Ensures**

```text
x <= 0 && x > -(m + 1) && y >= 0 && x + (m + 1) * y == n
```

- **Initiation:** At (n,0), x ≥ −m and x + (m + 1)y = n.
- **Preservation:** Integer x > 0 implies x ≥ 1. After subtraction x ≥ 1 − (m + 1) = −m. Increasing y by 1 preserves the dividend relation.
- **On exit:** At exit −m ≤ x ≤ 0, equivalently −(m + 1) < x ≤ 0. Also y = (n − x)/(m + 1) ≥ 0. Hence y is the ceiling quotient.

**Sufficiency:** Remove y ≥ 0 and express the strict lower bound as the equivalent integer bound x ≥ −m.

### 11. Cyclic Counter (g11)

Count n iterations in x while cycling y from 0 through m. Compute the remainder through the loop without reducing the external input first.

**Program**

```dafny
var x: int := 0;
var y: int := 0;
while x < n {
  x := x + 1;
  y := y + 1;
  if y == m + 1 {
    y := 0;
  }
}
```

**Example invariant**

```text
x <= n && y == x % (m + 1)
```

**Ensures**

```text
x == n && y == n % (m + 1)
```

- **Initiation:** Initially x = y = 0 and n ≥ 0, satisfying x ≤ n and the modulus relation.
- **Preservation:** For integer x < n, incrementing x preserves x ≤ n. Dafny modulus gives 0 ≤ y ≤ m regardless of the sign of x. Increment y when y < m, or wrap to zero when y = m; both branches yield the modulus of the new x.
- **On exit:** The exit condition x ≥ n and the upper bound x ≤ n give x = n, hence y = n % (m + 1).

**Sufficiency:** Dafny Euclidean modulus is nonnegative, so the modulus relation supplies the bounds on y. The cyclic relation is preserved even at hypothetical negative x, making x ≥ 0 unnecessary. Actual execution starts at x = 0 and increments to n.

### 12. Balanced Integer Mean (g12)

Balance the original signed integers a and b without changing their sum. x reaches the floor of their mean, and y its ceiling.

**Program**

```dafny
var x: int := a;
var y: int := b;
while x > y || y > x + 1 {
  if x > y {
    x := x - 1;
    y := y + 1;
  } else {
    x := x + 1;
    y := y - 1;
  }
}
```

**Example invariant**

```text
x + y == a + b
```

**Ensures**

```text
x + y == a + b && x <= y && y <= x + 1
```

- **Initiation:** Initially (x,y) = (a,b), so x + y = a + b regardless of the input signs.
- **Preservation:** Each branch adds 1 to one variable and subtracts 1 from the other. The sum is preserved.
- **On exit:** Negating the guard gives x ≤ y ≤ x + 1. Together with the conserved sum this is the entire ensures condition: x and y are the floor and ceiling of half the sum.

**Sufficiency:** The squared-gap bound is unnecessary. An invariant may include unreachable states as long as initiation, preservation, and the exit implication all hold.

## Chapter 4: Sums & Polynomials

### 13. Triangular Sum (g13)

Add n down through 1. Combine the amount already in y with the remaining triangular sum through x.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  y := y + x;
  x := x - 1;
}
```

**Example invariant**

```text
x >= 0 && 2 * y + x * (x + 1) == n * (n + 1)
```

**Ensures**

```text
x == 0 && 2 * y == n * (n + 1)
```

- **Initiation:** At (n,0), x ≥ 0 and 2y + x(x + 1) = n(n + 1).
- **Preservation:** 2(y + x) + (x − 1)x = 2y + x(x + 1). Decrementing positive x also preserves its lower bound.
- **On exit:** At exit x = 0. The remaining-sum term vanishes, giving 2y = n(n + 1).

**Sufficiency:** The bound x ≤ n is unnecessary. The same identity holds even at unreachable states with x > n and y < 0.

### 14. Arithmetic Progression (g14)

Add n consecutive integers starting at m. x counts processed terms and y stores their prefix sum.

**Program**

```dafny
var x: int := 0;
var y: int := 0;
while x < n {
  y := y + m + x;
  x := x + 1;
}
```

**Example invariant**

```text
x <= n && 2 * y == x * (2 * m + x - 1)
```

**Ensures**

```text
x == n && 2 * y == n * (2 * m + n - 1)
```

- **Initiation:** At (0,0), x ≤ n and 2y = x(2m + x − 1) = 0.
- **Preservation:** For F(x) = x(2m + x − 1), F(x + 1) − F(x) = 2(m + x), matching the update to 2y. Integer x < n gives x + 1 ≤ n.
- **On exit:** At exit x ≥ n; the invariant gives x ≤ n, so x = n. Substitution yields the full arithmetic-series sum.

**Sufficiency:** The bound x ≥ 0 is unnecessary. The polynomial identity also holds for negative x, and the upper bound suffices at exit.

### 15. Square by Odd Sums (g15)

Add n odd numbers, 1, 3, 5, ... to compute n squared. x counts how many have been added.

**Program**

```dafny
var x: int := 0;
var y: int := 0;
while x < n {
  y := y + 2 * x + 1;
  x := x + 1;
}
```

**Example invariant**

```text
x <= n && y == x * x
```

**Ensures**

```text
x == n && y == n * n
```

- **Initiation:** At (0,0), x ≤ n and y = x².
- **Preservation:** y + 2x + 1 = x² + 2x + 1 = (x + 1)². Incrementing integer x < n also preserves x ≤ n.
- **On exit:** At exit x ≥ n and x ≤ n give x = n, hence y = n².

**Sufficiency:** The bound x ≥ 0 is unnecessary. The square-difference identity also holds for negative x.

### 16. Pronic Number (g16)

Add n even numbers, 2, 4, 6, ... . Express the total as the product of n and n + 1.

**Program**

```dafny
var x: int := 0;
var y: int := 0;
while x < n {
  y := y + 2 * x + 2;
  x := x + 1;
}
```

**Example invariant**

```text
x <= n && y == x * (x + 1)
```

**Ensures**

```text
x == n && y == n * (n + 1)
```

- **Initiation:** At (0,0), x ≤ n and y = x(x + 1).
- **Preservation:** x(x + 1) + 2x + 2 = (x + 1)(x + 2), preserving the product relation. The guard also keeps the new x ≤ n.
- **On exit:** At exit x = n. Substitution yields y = n(n + 1).

**Sufficiency:** The bound x ≥ 0 is unnecessary. The product-difference identity holds for every integer x.

## Chapter 5: Squares & Search

### 17. Sum of Squares (g17)

Sum the squares from n down through 1. Combine the accumulated square sum and the remaining square sum into one conserved quantity.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x > 0 {
  y := y + x * x;
  x := x - 1;
}
```

**Example invariant**

```text
x >= 0 && 6 * y + x * (x + 1) * (2 * x + 1) == n * (n + 1) * (2 * n + 1)
```

**Ensures**

```text
x == 0 && 6 * y == n * (n + 1) * (2 * n + 1)
```

- **Initiation:** Let F(t) = t(t + 1)(2t + 1). At (n,0), x ≥ 0 and 6y + F(x) = F(n).
- **Preservation:** F(x) − F(x − 1) = 6x². Adding x² to y while decrementing x preserves 6y + F(x) and the lower bound on x.
- **On exit:** At exit x = 0 and F(0) = 0, giving 6y = n(n + 1)(2n + 1).

**Sufficiency:** The bound x ≤ n is unnecessary. The conservation identity and nonnegative lower bound suffice.

### 18. Integer Square Root (g18)

Subtract successive odd numbers to find the floor of the square root of n. y tracks the root and x is the residual.

**Program**

```dafny
var x: int := n;
var y: int := 0;
while x >= 2 * y + 1 {
  x := x - (2 * y + 1);
  y := y + 1;
}
```

**Example invariant**

```text
x >= 0 && x + y * y == n
```

**Ensures**

```text
x >= 0 && x < 2 * y + 1 && y >= 0 && x + y * y == n
```

- **Initiation:** At (n,0), x ≥ 0 and x + y² = n.
- **Preservation:** The guard gives x − (2y + 1) ≥ 0. Also x − (2y + 1) + (y + 1)² = x + y², preserving the relation.
- **On exit:** At exit 0 ≤ x < 2y + 1, which forces integer y ≥ 0. Together with x + y² = n, this gives y² ≤ n < (y + 1)².

**Sufficiency:** The exit inequality implies y ≥ 0. Negative y need not be excluded from the invariant for preservation or the exit proof.

### 19. Ceiling Square Root (g19)

Generate successive squares until the first one reaches n. Preserve both the exact current square and the fact that the previous one was too small.

**Program**

```dafny
var x: int := 0;
var y: int := 0;
while y < n {
  y := y + 2 * x + 1;
  x := x + 1;
}
```

**Example invariant**

```text
y == x * x && (x == 0 || y - 2 * x + 1 < n)
```

**Ensures**

```text
y >= n && x >= 0 && y == x * x && (x == 0 || (x - 1) * (x - 1) < n)
```

- **Initiation:** Initially x = y = 0, so y = x². The x = 0 exception establishes initiation for every input, including n = 0.
- **Preservation:** The new y is x² + 2x + 1 = (x + 1)². In the new state, y − 2x + 1 equals the old y, which the guard places below n.
- **On exit:** At exit y = x² ≥ n. If x < 0, then (x − 1)² > x² ≥ n, contradicting the invariant’s previous-square bound. Thus x ≥ 0 and every ensures clause follows.

**Sufficiency:** Remove x ≥ 0. Under y = x², the previous square (x − 1)² can be written more briefly as y − 2x + 1.

### 20. Binary Square-Root Search (g20)

Halve an interval satisfying x² <= n < y². Once the endpoints are adjacent, x is the floor square root. mid is recomputed locally each iteration.

**Program**

```dafny
var x: int := 0;
var y: int := n + 1;
while y - x > 1 {
  var mid: int := (x + y) / 2;
  if mid * mid <= n {
    x := mid;
  } else {
    y := mid;
  }
}
```

**Example invariant**

```text
x < y && x * x <= n && n < y * y
```

**Ensures**

```text
x >= 0 && y == x + 1 && x * x <= n && n < y * y
```

- **Initiation:** Initially x = 0 and y = n + 1, giving x < y and 0 ≤ n < (n + 1)².
- **Preservation:** An integer interval of width at least 2 has x < mid < y. Replace x when mid² ≤ n, otherwise y. The order and both square bounds are preserved.
- **On exit:** At exit x < y and y − x ≤ 1 give y = x + 1. If x < 0, then x² ≥ (x + 1)² = y², contradicting x² ≤ n < y². Thus x ≥ 0 and x is the floor square root.

**Sufficiency:** Neither x ≥ 0 nor y ≤ n + 1 is needed. Nonnegativity follows at exit from the two adjacent squares bracketing n.

## Chapter 6: Three Variables & Layers

### 21. Load the Next Odd Difference (s01)

Compute n²+m without multiplication in the loop. x counts completed steps, y accumulates the result, and z stores the next odd addend. Inspect their relation across z layers.

**Program**

```dafny
var x: int := 0;
var y: int := m;
var z: int := 1;
while x < n {
  y := y + z;
  z := z + 2;
  x := x + 1;
}
```

**Example invariant**

```text
x <= n && y == x * x + m && z == 2 * x + 1
```

**Ensures**

```text
x == n && y == n * n + m && z == 2 * n + 1
```

- **Initiation:** Initially x=0, y=m, z=1, so y=x²+m, z=2x+1, and x≤n all hold.
- **Preservation:** y′=y+z=x²+m+2x+1=(x+1)²+m and z′=z+2=2(x+1)+1. Integer x<n implies x′=x+1≤n.
- **On exit:** Exit gives x≥n; the invariant gives x≤n. Thus x=n, and substitution yields y=n²+m and z=2n+1.

The next-addend variable `z` makes the finite-difference relation explicit. No lower bound on `x` is needed for these obligations.

### 22. Pairing and the Minimum (s02)

Build as many pairs as possible from two stockpiles. x and y are leftovers; z counts completed pairs. Equal map coordinates on different z layers identify different units.

**Program**

```dafny
var x: int := n;
var y: int := m;
var z: int := 0;
while x > 0 && y > 0 {
  x := x - 1;
  y := y - 1;
  z := z + 1;
}
```

**Example invariant**

```text
x >= 0 && y >= 0 && x + z == n && y + z == m
```

**Ensures**

```text
x >= 0 && y >= 0 && (x == 0 || y == 0) && x + z == n && y + z == m
```

- **Initiation:** The initial leftovers are n,m and the completed count is 0. Hence x+z=n, y+z=m, and x,y≥0.
- **Preservation:** Both leftovers decrease by 1 while z increases by 1, preserving both sums. The guard makes both leftovers positive, so neither becomes negative.
- **On exit:** Exit gives x≤0 or y≤0. Nonnegativity makes at least one zero. The conserved sums therefore give z=min(n,m), x=n−z, and y=m−z.

A separate invariant clause `z >= 0` is unnecessary: on exit, `z` equals either `n` or `m`, both nonnegative.

### 23. Unit Distribution Counter (s03)

Divide n items into batches of m+1. x counts pending items, y full batches, and z the current partial batch. Preserve the total across the rollover branch.

**Program**

```dafny
var x: int := n;
var y: int := 0;
var z: int := 0;
while x > 0 {
  x := x - 1;
  z := z + 1;
  if z == m + 1 {
    z := 0;
    y := y + 1;
  }
}
```

**Example invariant**

```text
x >= 0 && z >= 0 && z <= m && x + (m + 1) * y + z == n
```

**Ensures**

```text
x == 0 && z >= 0 && z <= m && (m + 1) * y + z == n
```

- **Initiation:** With x=n and y=z=0, the total x+(m+1)y+z equals n; x≥0 and 0≤z≤m hold.
- **Preservation:** Decrementing x and incrementing z first preserves the total. If z=m+1, resetting z and incrementing y preserves it again. Otherwise integrality gives z≤m. Both branches restore 0≤z≤m.
- **On exit:** Nonnegative x and exit condition x≤0 force x=0. Thus n=(m+1)y+z and 0≤z<m+1 identify quotient y and remainder z.

The divisor `m + 1` is always positive. On exit, the dividend relation and the remainder interval also imply `y >= 0`, without a separate invariant clause.

### 24. Halve and Double Multiplication (s04)

Compute n×m by halving one factor and doubling the other. Add y to z only when x is odd. The result is z; the specification does not constrain the final y.

**Program**

```dafny
var x: int := n;
var y: int := m;
var z: int := 0;
while x > 0 {
  if x % 2 == 1 {
    z := z + y;
  }
  x := x / 2;
  y := 2 * y;
}
```

**Example invariant**

```text
x >= 0 && x * y + z == n * m
```

**Ensures**

```text
x == 0 && z == n * m
```

- **Initiation:** Initially x=n, y=m, z=0, so x≥0 and xy+z=nm.
- **Preservation:** For even x=2k, x′y′+z′=k·2y+z=xy+z. For odd x=2k+1, z′=z+y gives k·2y+z+y=xy+z. Both branches keep x′≥0.
- **On exit:** Exit gives x≤0, and the invariant gives x≥0, so x=0. The remaining product vanishes and z=nm. Final y is unrestricted, so a correct invariant can still leave neutral candidates.

The postcondition intentionally does not constrain final `y`. Consequently, neutral candidates can remain even when every verification stage passes. The invariant also allows hypothetical negative `y` and `z`; its algebraic conservation law remains valid there.
