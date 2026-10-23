// Mathematical arguments over integers, separate from the finite game checker.
// n = |a| and m = |b| are immutable and nonnegative. No reachability premise is
// used in preservation: every state satisfying the invariant and guard counts.
export const SOLUTION_EXPLANATIONS = {
  g01: {
    ko: {
      initial: '초기 x = n, y = 0이다. n ≥ 0이므로 x ≥ 0과 x + y = n이 성립한다.',
      preservation: 'x > 0인 정수에서 x를 1 줄여도 x ≥ 0이다. y는 1 증가하므로 x + y는 변하지 않는다.',
      postcondition: '종료 조건 x ≤ 0과 x ≥ 0을 결합하면 x = 0이다. 합 보존식에 대입하면 y = n이다.',
      note: 'x ≤ n은 필요 없다. 실제 실행에서 참인 모든 성질을 불변식에 넣을 필요는 없다.',
    },
    en: {
      initial: 'Initially x = n and y = 0. Since n ≥ 0, both x ≥ 0 and x + y = n hold.',
      preservation: 'For integer x > 0, decrementing x preserves x ≥ 0. Incrementing y by the same amount preserves the sum.',
      postcondition: 'At exit x ≤ 0. Together with x ≥ 0 this gives x = 0, so the conserved sum gives y = n.',
      note: 'The bound x ≤ n is unnecessary. An invariant need not record every property of the actual execution.',
    },
  },
  g02: {
    ko: {
      initial: '초기 (x,y) = (n,m)이므로 x ≥ 0이고 x + y = n + m이다.',
      preservation: '양수인 x에서 1을 빼고 y에 1을 더한다. x의 비음수성과 두 변수의 합이 유지된다.',
      postcondition: '종료 시 x ≤ 0이며 불변식에서 x ≥ 0이다. 따라서 x = 0이고 y = n + m이다.',
      note: 'x ≤ n과 y ≥ m을 추가하지 않아도 세 검증 의무를 충족한다.',
    },
    en: {
      initial: 'Initially (x,y) = (n,m), so x ≥ 0 and x + y = n + m.',
      preservation: 'Subtract 1 from positive x and add 1 to y. Nonnegativity of x and the sum are preserved.',
      postcondition: 'At exit x ≤ 0; the invariant gives x ≥ 0. Thus x = 0 and y = n + m.',
      note: 'Neither x ≤ n nor y ≥ m is needed for the three proof obligations.',
    },
  },
  g03: {
    ko: {
      initial: '초기 (x,y) = (n,0)이므로 x ≥ 0이고 2x + y = 2n이다.',
      preservation: '2(x − 1) + (y + 2) = 2x + y이다. 반복 조건 x > 0이 x의 비음수성도 보장한다.',
      postcondition: '종료 시 x = 0이다. 보존식 2x + y = 2n에서 y = 2n을 얻는다.',
      note: 'x ≤ n을 삭제해도 가중 합의 보존과 종료 결과에는 영향이 없다.',
    },
    en: {
      initial: 'Initially (x,y) = (n,0), giving x ≥ 0 and 2x + y = 2n.',
      preservation: '2(x − 1) + (y + 2) = 2x + y. The guard x > 0 also preserves nonnegativity of x.',
      postcondition: 'At exit x = 0. Substitution into 2x + y = 2n yields y = 2n.',
      note: 'Removing x ≤ n does not affect preservation or the result at exit.',
    },
  },
  g04: {
    ko: {
      initial: '초기 (x,y) = (n,0)이므로 x ≥ 0이고 mx + y = nm이다. m = 0일 때도 같다.',
      preservation: 'm(x − 1) + (y + m) = mx + y이다. x > 0에서 1을 빼므로 x ≥ 0도 유지된다.',
      postcondition: '종료 시 x = 0이다. mx + y = nm에 대입하면 y = nm이다.',
      note: 'x ≤ n은 필요 없다. 입력 매개변수 m을 가중치로 사용한 보존식과 x의 하한이면 충분하다.',
    },
    en: {
      initial: 'Initially (x,y) = (n,0), so x ≥ 0 and mx + y = nm, including when m = 0.',
      preservation: 'm(x − 1) + (y + m) = mx + y. Decrementing positive integer x also preserves x ≥ 0.',
      postcondition: 'At exit x = 0, and mx + y = nm therefore gives y = nm.',
      note: 'The upper bound x ≤ n is unnecessary. The weighted conservation law and the lower bound on x suffice.',
    },
  },
  g05: {
    ko: {
      initial: '초기 (n,0)에서 x ≥ 0, y ≤ m, x + y = n이 성립한다.',
      preservation: '반복 조건 x > 0, y < m과 정수성으로 x − 1 ≥ 0, y + 1 ≤ m이다. 합은 변하지 않는다.',
      postcondition: '종료 시 x = 0 또는 y = m이다. n ≤ m이면 (x,y) = (0,n), n > m이면 (n − m,m)만 가능하다.',
      note: 'y ≥ 0은 종료 결과에서 따라온다. 반복 중 별도의 조건으로 유지할 필요는 없다.',
    },
    en: {
      initial: 'At (n,0), x ≥ 0, y ≤ m, and x + y = n all hold.',
      preservation: 'The integer guard x > 0 and y < m gives x − 1 ≥ 0 and y + 1 ≤ m. The sum is unchanged.',
      postcondition: 'At exit x = 0 or y = m. If n ≤ m, the result must be (0,n); if n > m, it must be (n − m,m).',
      note: 'The exit result implies y ≥ 0. It does not need a separate invariant clause.',
    },
  },
  g06: {
    ko: {
      initial: '초기 (n,m)은 두 좌표가 비음수이며 x − y = n − m이다.',
      preservation: '양수인 두 정수만 1씩 줄이므로 두 하한이 유지된다. (x − 1) − (y − 1) = x − y이다.',
      postcondition: '종료 시 x = 0 또는 y = 0이다. 보존된 차이의 부호에 따라 (n − m,0) 또는 (0,m − n)을 얻는다.',
      note: '초기값 상한 x ≤ n, y ≤ m은 필요 없다. 두 하한과 차이만 남겨라.',
    },
    en: {
      initial: 'At (n,m), both coordinates are nonnegative and x − y = n − m.',
      preservation: 'Only positive integers are decremented, preserving both lower bounds. (x − 1) − (y − 1) = x − y.',
      postcondition: 'At exit x = 0 or y = 0. The sign of the conserved difference determines (n − m,0) or (0,m − n).',
      note: 'The initial-value upper bounds x ≤ n and y ≤ m are unnecessary. Keep both lower bounds and the difference.',
    },
  },
  g07: {
    ko: {
      initial: 'n ≥ m이면 x = n, y = m ≤ n이다. n < m이면 y = m, x = n ≤ m이다.',
      preservation: '첫 경우에는 x = n이고 y ≤ n이다. x ≠ y이면 y < x이므로 y만 1 증가하고 y ≤ n이 유지된다. 둘째 경우는 대칭이다.',
      postcondition: '종료 시 x = y이다. 첫 경우 두 값은 n, 둘째 경우 두 값은 m이므로 둘 다 max(n,m)이다.',
      note: '움직이는 변수의 초기값 하한은 필요 없다. 고정된 큰 값과 그 값을 넘지 않는 상한만 보존하라.',
    },
    en: {
      initial: 'If n ≥ m, x = n and y = m ≤ n. Otherwise y = m and x = n ≤ m.',
      preservation: 'In the first branch x = n and y ≤ n. When x ≠ y, only y increments, preserving y ≤ n. The second branch is symmetric.',
      postcondition: 'At exit x = y. Both values equal n in the first branch and m in the second, hence max(n,m).',
      note: 'The moving variable needs no lower bound tied to its initial value. The fixed larger value and its upper bound suffice.',
    },
  },
  g08: {
    ko: {
      initial: '초기 x = a, y = m에서 y + |x| = m + |a| = n + m이다.',
      preservation: 'y ≤ n + m과 첫 등식은 x ≥ 0을, 둘째 등식은 x ≤ 0을 뜻한다. 즉 전체 식은 y + |x| = n + m이다. x ≠ 0에서 |x|는 1 줄고 y는 1 늘어난다.',
      postcondition: '종료 조건 x = 0을 보존식에 대입하면 y = n + m이다.',
      note: 'y ≥ m은 필요 없다. 공통 상한 y ≤ n + m을 이용하면 두 가지의 부호 조건도 따로 적지 않아도 된다. x = −1에서 0으로 이동하는 경우도 포함한다.',
    },
    en: {
      initial: 'Initially x = a and y = m, so y + |x| = m + |a| = n + m.',
      preservation: 'Together with y ≤ n + m, the first equality implies x ≥ 0 and the second x ≤ 0. Thus the formula is y + |x| = n + m. Each active step decreases |x| by 1 and increases y by 1.',
      postcondition: 'The exit condition is x = 0, so the conserved relation gives y = n + m.',
      note: 'The bound y ≥ m is unnecessary. The shared upper bound also replaces separate sign guards, including the transition from x = −1 to 0.',
    },
  },
  g09: {
    ko: {
      initial: 'd = m + 1 ≥ 1이라 두자. 초기 (n,0)에서 x ≥ 0이고 x + dy = n이다.',
      preservation: 'x ≥ d일 때만 d를 빼므로 새 x도 비음수이다. (x − d) + d(y + 1) = x + dy이다.',
      postcondition: '종료 시 0 ≤ x < d이다. n ≥ 0과 x + dy = n으로 dy = n − x > −d, 즉 정수 y ≥ 0을 얻는다. 따라서 몫과 나머지 명세가 성립한다.',
      note: 'y ≥ 0은 보존식과 종료 구간에서 도출된다. 불변식에 별도로 넣지 않는다.',
    },
    en: {
      initial: 'Let d = m + 1 ≥ 1. At (n,0), x ≥ 0 and x + dy = n.',
      preservation: 'Subtract d only when x ≥ d, preserving x ≥ 0. (x − d) + d(y + 1) = x + dy.',
      postcondition: 'At exit 0 ≤ x < d. Since n ≥ 0, dy = n − x > −d, so integer y ≥ 0. This establishes the quotient-and-remainder specification.',
      note: 'The conserved relation and the exit interval imply y ≥ 0. It needs no separate invariant clause.',
    },
  },
  g10: {
    ko: {
      initial: '초기 (n,0)에서 x ≥ −m이고 x + (m + 1)y = n이다.',
      preservation: '정수 x > 0이면 x ≥ 1이므로 차감 후 x ≥ 1 − (m + 1) = −m이다. 제수를 빼고 y를 1 늘려 복원식도 유지된다.',
      postcondition: '종료 시 −m ≤ x ≤ 0이다. 이는 −(m + 1) < x ≤ 0과 같고, y = (n − x)/(m + 1) ≥ 0이다. 따라서 y는 올림 몫이다.',
      note: 'y ≥ 0을 삭제하고, 정수에서 동치인 x ≥ −m으로 하한을 줄였다.',
    },
    en: {
      initial: 'At (n,0), x ≥ −m and x + (m + 1)y = n.',
      preservation: 'Integer x > 0 implies x ≥ 1. After subtraction x ≥ 1 − (m + 1) = −m. Increasing y by 1 preserves the dividend relation.',
      postcondition: 'At exit −m ≤ x ≤ 0, equivalently −(m + 1) < x ≤ 0. Also y = (n − x)/(m + 1) ≥ 0. Hence y is the ceiling quotient.',
      note: 'Remove y ≥ 0 and express the strict lower bound as the equivalent integer bound x ≥ −m.',
    },
  },
  g11: {
    ko: {
      initial: '초기 x = y = 0이며 n ≥ 0이다. 두 x 경계와 나머지 관계가 성립한다.',
      preservation: '0 ≤ x < n에서 증가한 x는 여전히 0 ≤ x ≤ n이다. y도 1 늘리고 m + 1에서 0으로 되돌리므로 새 y는 새 x의 나머지이다.',
      postcondition: '종료 조건 x ≥ n과 상한 x ≤ n으로 x = n이다. 나머지 관계에서 y = n % (m + 1)을 얻는다.',
      note: 'y의 두 범위 조건은 x ≥ 0과 나머지식에서 따라온다. x ≥ 0은 남겨야 한다. 이 게임의 %는 JavaScript처럼 음수 피제수에 음수 나머지를 허용하기 때문이다.',
    },
    en: {
      initial: 'Initially x = y = 0 and n ≥ 0, satisfying both x bounds and the remainder relation.',
      preservation: 'Incrementing 0 ≤ x < n preserves 0 ≤ x ≤ n. Incrementing y and wrapping at m + 1 gives the remainder of the new x.',
      postcondition: 'The exit condition x ≥ n and the upper bound x ≤ n give x = n, hence y = n % (m + 1).',
      note: 'Both bounds on y follow from x ≥ 0 and the remainder relation. Keep x ≥ 0: the game uses JavaScript remainder, which can be negative for negative dividends.',
    },
  },
  g12: {
    ko: {
      initial: '초기 (x,y) = (a,b)이므로 x + y = a + b이다. 입력의 부호와 무관하다.',
      preservation: '어느 분기든 한쪽에 더한 1만큼 다른 쪽에서 뺀다. 따라서 x + y는 항상 보존된다.',
      postcondition: '반복 조건의 부정은 x ≤ y ≤ x + 1이다. 합 보존식과 결합하면 고정 ensures 전체가 성립하며, x와 y는 각각 합의 절반을 내림·올림한 값이다.',
      note: '차이의 제곱 상한은 필요 없다. 불변식이 도달 불가능한 상태를 허용해도 초기 성립·유지·종료 후 명세를 모두 충족하면 충분하다.',
    },
    en: {
      initial: 'Initially (x,y) = (a,b), so x + y = a + b regardless of the input signs.',
      preservation: 'Each branch adds 1 to one variable and subtracts 1 from the other. The sum is preserved.',
      postcondition: 'Negating the guard gives x ≤ y ≤ x + 1. Together with the conserved sum this is the entire ensures condition: x and y are the floor and ceiling of half the sum.',
      note: 'The squared-gap bound is unnecessary. An invariant may include unreachable states as long as initiation, preservation, and the exit implication all hold.',
    },
  },
  g13: {
    ko: {
      initial: '초기 (n,0)에서 x ≥ 0이고 2y + x(x + 1) = n(n + 1)이다.',
      preservation: '2(y + x) + (x − 1)x = 2y + x(x + 1)이므로 보존식이 유지된다. 양수 x를 1 줄이므로 하한도 유지된다.',
      postcondition: '종료 시 x = 0이다. 남은 합이 사라져 2y = n(n + 1)을 얻는다.',
      note: 'x ≤ n은 필요 없다. 실제 경로에 없는 x > n, y < 0 상태를 포함해도 같은 대수적 항등식이 성립한다.',
    },
    en: {
      initial: 'At (n,0), x ≥ 0 and 2y + x(x + 1) = n(n + 1).',
      preservation: '2(y + x) + (x − 1)x = 2y + x(x + 1). Decrementing positive x also preserves its lower bound.',
      postcondition: 'At exit x = 0. The remaining-sum term vanishes, giving 2y = n(n + 1).',
      note: 'The bound x ≤ n is unnecessary. The same identity holds even at unreachable states with x > n and y < 0.',
    },
  },
  g14: {
    ko: {
      initial: '초기 (0,0)에서 x ≤ n이고 2y = x(2m + x − 1) = 0이다.',
      preservation: 'F(x) = x(2m + x − 1)이라 두면 F(x + 1) − F(x) = 2(m + x)이다. 누산 갱신과 일치한다. 정수 x < n에서 x + 1 ≤ n이다.',
      postcondition: '종료 시 x ≥ n이고 불변식에서 x ≤ n이므로 x = n이다. 식에 대입하면 전체 등차수열 합을 얻는다.',
      note: 'x ≥ 0은 필요 없다. 접두 합에서 발견한 다항식 항등식은 음수 x에서도 유지되며, 종료에는 상한만 필요하다.',
    },
    en: {
      initial: 'At (0,0), x ≤ n and 2y = x(2m + x − 1) = 0.',
      preservation: 'For F(x) = x(2m + x − 1), F(x + 1) − F(x) = 2(m + x), matching the update to 2y. Integer x < n gives x + 1 ≤ n.',
      postcondition: 'At exit x ≥ n; the invariant gives x ≤ n, so x = n. Substitution yields the full arithmetic-series sum.',
      note: 'The bound x ≥ 0 is unnecessary. The polynomial identity also holds for negative x, and the upper bound suffices at exit.',
    },
  },
  g15: {
    ko: {
      initial: '초기 (0,0)에서 x ≤ n이고 y = x²이다.',
      preservation: 'y + 2x + 1 = x² + 2x + 1 = (x + 1)²이다. x < n에서 1 증가해도 x ≤ n이다.',
      postcondition: '종료 시 x ≥ n과 상한을 결합하면 x = n이다. 따라서 y = n²이다.',
      note: 'x ≥ 0은 필요 없다. 제곱의 차분 항등식은 음수 x에도 성립한다.',
    },
    en: {
      initial: 'At (0,0), x ≤ n and y = x².',
      preservation: 'y + 2x + 1 = x² + 2x + 1 = (x + 1)². Incrementing integer x < n also preserves x ≤ n.',
      postcondition: 'At exit x ≥ n and x ≤ n give x = n, hence y = n².',
      note: 'The bound x ≥ 0 is unnecessary. The square-difference identity also holds for negative x.',
    },
  },
  g16: {
    ko: {
      initial: '초기 (0,0)에서 x ≤ n이고 y = x(x + 1)이다.',
      preservation: 'x(x + 1) + 2x + 2 = (x + 1)(x + 2)이므로 연속곱 관계가 유지된다. 반복 조건은 새 x ≤ n도 보장한다.',
      postcondition: '종료 시 x = n이다. 보존된 관계에 대입하면 y = n(n + 1)이다.',
      note: 'x ≥ 0은 필요 없다. 연속곱의 차분 관계는 모든 정수 x에서 성립한다.',
    },
    en: {
      initial: 'At (0,0), x ≤ n and y = x(x + 1).',
      preservation: 'x(x + 1) + 2x + 2 = (x + 1)(x + 2), preserving the product relation. The guard also keeps the new x ≤ n.',
      postcondition: 'At exit x = n. Substitution yields y = n(n + 1).',
      note: 'The bound x ≥ 0 is unnecessary. The product-difference identity holds for every integer x.',
    },
  },
  g17: {
    ko: {
      initial: 'F(t) = t(t + 1)(2t + 1)이라 두자. 초기 (n,0)에서 x ≥ 0이고 6y + F(x) = F(n)이다.',
      preservation: 'F(x) − F(x − 1) = 6x²이다. y에 x²을 더하고 x를 1 줄이면 6y + F(x)는 일정하다. x의 하한도 유지된다.',
      postcondition: '종료 시 x = 0이며 F(0) = 0이다. 따라서 6y = n(n + 1)(2n + 1)이다.',
      note: 'x ≤ n은 필요 없다. 보존식의 항등식과 비음수 하한만으로 충분하다.',
    },
    en: {
      initial: 'Let F(t) = t(t + 1)(2t + 1). At (n,0), x ≥ 0 and 6y + F(x) = F(n).',
      preservation: 'F(x) − F(x − 1) = 6x². Adding x² to y while decrementing x preserves 6y + F(x) and the lower bound on x.',
      postcondition: 'At exit x = 0 and F(0) = 0, giving 6y = n(n + 1)(2n + 1).',
      note: 'The bound x ≤ n is unnecessary. The conservation identity and nonnegative lower bound suffice.',
    },
  },
  g18: {
    ko: {
      initial: '초기 (n,0)에서 x ≥ 0이고 x + y² = n이다.',
      preservation: '반복 조건으로 x − (2y + 1) ≥ 0이다. 또한 x − (2y + 1) + (y + 1)² = x + y²이므로 보존식이 유지된다.',
      postcondition: '종료 시 0 ≤ x < 2y + 1이다. 정수 y는 따라서 비음수이고, x + y² = n을 결합하면 y² ≤ n < (y + 1)²이다.',
      note: 'y ≥ 0은 종료 부등식에서 도출된다. 음수 y를 불변식에서 미리 배제하지 않아도 유지와 명세 보장이 성립한다.',
    },
    en: {
      initial: 'At (n,0), x ≥ 0 and x + y² = n.',
      preservation: 'The guard gives x − (2y + 1) ≥ 0. Also x − (2y + 1) + (y + 1)² = x + y², preserving the relation.',
      postcondition: 'At exit 0 ≤ x < 2y + 1, which forces integer y ≥ 0. Together with x + y² = n, this gives y² ≤ n < (y + 1)².',
      note: 'The exit inequality implies y ≥ 0. Negative y need not be excluded from the invariant for preservation or the exit proof.',
    },
  },
  g19: {
    ko: {
      initial: '초기 x = y = 0에서 y = x²이다. x = 0인 예외가 n = 0을 포함한 모든 입력의 초기 성립을 보장한다.',
      preservation: '새 y = x² + 2x + 1 = (x + 1)²이다. 새 상태의 y − 2x + 1은 갱신 전 y와 같고, 반복 조건으로 그 값은 n보다 작다.',
      postcondition: '종료 시 y = x² ≥ n이다. x < 0이라면 (x − 1)² > x² ≥ n인데 불변식은 (x − 1)² < n이므로 모순이다. 따라서 x ≥ 0이고 고정 ensures 전체를 얻는다.',
      note: 'x ≥ 0을 삭제했다. y = x²를 이용하면 직전 제곱 (x − 1)²을 y − 2x + 1로 짧게 쓸 수 있다.',
    },
    en: {
      initial: 'Initially x = y = 0, so y = x². The x = 0 exception establishes initiation for every input, including n = 0.',
      preservation: 'The new y is x² + 2x + 1 = (x + 1)². In the new state, y − 2x + 1 equals the old y, which the guard places below n.',
      postcondition: 'At exit y = x² ≥ n. If x < 0, then (x − 1)² > x² ≥ n, contradicting the invariant’s previous-square bound. Thus x ≥ 0 and every ensures clause follows.',
      note: 'Remove x ≥ 0. Under y = x², the previous square (x − 1)² can be written more briefly as y − 2x + 1.',
    },
  },
  g20: {
    ko: {
      initial: '초기 x = 0, y = n + 1에서 x < y이고 0 ≤ n < (n + 1)²이다.',
      preservation: '정수 구간 폭이 2 이상이면 x < mid < y이다. mid² ≤ n이면 x를, 그렇지 않으면 y를 mid로 바꾸므로 순서와 제곱의 두 경계가 유지된다.',
      postcondition: '종료 시 x < y와 y − x ≤ 1로 y = x + 1이다. x < 0이라면 x² ≥ (x + 1)² = y²이므로 x² ≤ n < y²와 모순이다. 따라서 x ≥ 0이고 x는 내림 제곱근이다.',
      note: 'x ≥ 0과 y ≤ n + 1은 모두 필요 없다. 인접한 두 제곱이 n을 사이에 두는 종료 상태에서 비음수성이 도출된다.',
    },
    en: {
      initial: 'Initially x = 0 and y = n + 1, giving x < y and 0 ≤ n < (n + 1)².',
      preservation: 'An integer interval of width at least 2 has x < mid < y. Replace x when mid² ≤ n, otherwise y. The order and both square bounds are preserved.',
      postcondition: 'At exit x < y and y − x ≤ 1 give y = x + 1. If x < 0, then x² ≥ (x + 1)² = y², contradicting x² ≤ n < y². Thus x ≥ 0 and x is the floor square root.',
      note: 'Neither x ≥ 0 nor y ≤ n + 1 is needed. Nonnegativity follows at exit from the two adjacent squares bracketing n.',
    },
  },
};
