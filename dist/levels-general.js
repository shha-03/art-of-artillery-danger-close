import { evaluate, parseExpression } from './engine.js';
import { SOLUTION_EXPLANATIONS } from './solution-explanations.js';

// a and b are arbitrary external integers. n and m are their immutable
// magnitudes; the three battle inputs select examples, never the input contract.
// Mathematical justification (unbounded integers; distinct from the finite
// checker, which tests 81 raw inputs and 4,225 states for each input):
// g01-g04: one decrease in x cancels the corresponding weighted increase in y.
//   The nonnegative countdown x proves termination, including zero weights.
// g05: x+y is constant and y never exceeds capacity m. Each active step lowers
//   nonnegative x; the two exits identify min(n,m) and the unfilled remainder.
// g06: simultaneous subtraction preserves x-y. Both values remain nonnegative;
//   their sum strictly decreases until one is zero, giving the signed difference.
// g07: the initially larger coordinate remains fixed. The smaller coordinate
//   approaches it, so the nonnegative gap strictly decreases to zero.
// g08: |x|+y is constant and |x| decreases to zero for either sign of a.
// g09-g10: x+(m+1)*y is constant. The positive divisor m+1 strictly decreases x
//   while the guard holds; the respective exit bounds specify floor/ceiling.
// g11: increasing both counters and wrapping y preserves y == x mod (m+1).
//   The loop runs n times. Modulo is the algorithm's result, not input clipping.
// g12: transferring one unit preserves x+y. The exit guard itself supplies
//   x<=y<=x+1, specifying the floor/ceiling mean. A squared-gap bound is redundant.
// g13: x(x+1) - (x-1)x = 2x cancels the increase in 2y; x counts down to zero.
// g14: F(x)=x(2m+x-1) has F(x+1)-F(x)=2(m+x), matching twice the next addend.
// g15-g16: x^2 and x(x+1) increase by 2x+1 and 2x+2 respectively. Each bounded
//   counter reaches n, so the invariant's prefix formula becomes the full sum.
// g17: F(x)=x(x+1)(2x+1) has F(x)-F(x-1)=6x^2. Hence 6y+F(x)=F(n) is preserved;
//   countdown termination yields the sum-of-squares formula for every n>=0.
// g18: (y+1)^2-y^2=2y+1 preserves x+y^2=n, even at hypothetical negative y.
//   At exit 0<=x<2y+1 implies y>=0 and gives y^2<=n<(y+1)^2.
// g19: the same square difference preserves y=x^2. Before each step y<n,
//   proving that the next state's previous square is below n. Increasing squares
//   eventually reach n, and that previous-square bound establishes minimality.
// g20: x<y and x^2<=n<y^2 hold initially for every n>=0. At width>1,
//   floor((x+y)/2) is strictly between the endpoints; either update preserves the
//   bracketing inequalities and strictly reduces the positive integer width.
//   Width one forces x>=0 (otherwise x^2>=y^2), proving floor(sqrt(n)).
// Localized initiation, preservation, exit proofs and removed-condition notes
// are in solution-explanations.js. Invariants need not characterize reachability.
// These arguments assume mathematical integers. JavaScript and the interactive
// checker use exact safe integers within their explicitly reported test windows.
const point = ({ x, y }) => ({ x, y });
const positionKey = ({ x, y }) => `${x},${y}`;
const mission = ({ start, initialization, ...definition }) => {
  const initialize = ({ a, b }) => {
    const n = Math.abs(a);
    const m = Math.abs(b);
    return { ...start({ a, b, n, m }), n, m };
  };
  const guard = parseExpression(definition.guardSource);
  const endpoints = definition.battleInputs.map(({ a, b }) => {
    const initial = initialize({ a, b });
    let state = { ...initial, a, b };
    let iterations = 0;
    while (evaluate(guard, state)) {
      if (++iterations > 1024) throw new Error(`Nonterminating battle sample: ${definition.id}`);
      state = { ...state, ...point(definition.step(state)) };
    }
    if (!Number.isInteger(state.x) || !Number.isInteger(state.y)
      || state.x < 0 || state.x > 8 || state.y < 0 || state.y > 8) {
      throw new Error(`Off-board battle endpoint: ${definition.id}`);
    }
    return point(state);
  });
  return {
    size: 9,
    commands: 6,
    ...definition,
    initialize,
    initializationCode: `const n = Math.abs(a);\nconst m = Math.abs(b);\n${initialization}`,
    enemies: [...new Map(endpoints.map(endpoint => [positionKey(endpoint), endpoint])).values()],
    starter: definition.starter ?? definition.referenceInvariant,
    hints: [...definition.hints, `검증 해법: ${definition.solution}`],
    explanation: SOLUTION_EXPLANATIONS[definition.id].ko,
    en: {
      ...definition.en,
      hints: [...definition.en.hints, `Verified solution: ${definition.solution}`],
      explanation: SOLUTION_EXPLANATIONS[definition.id].en,
    },
  };
};

export const GENERAL_LEVELS = [
  mission({
    id: 'g01', chapter: 1, name: '값 이송', subtitle: 'COUNTDOWN TRANSFER', concept: '남은 양과 처리한 양의 합',
    brief: '임의의 정수 a의 크기 n을 y로 이송하라. x는 남은 양이다. 입력값을 상수 n으로 기억하면 모든 입력에 같은 불변식을 적용할 수 있다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 2, b: 0 }, { a: -3, b: 0 }, { a: 4, b: 0 }],
    guardSource: 'x > 0', step: ({ x, y }) => ({ x: x - 1, y: y + 1 }),
    code: 'while (x > 0) {\n  x = x - 1;\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && x + y <= n',
    solution: 'x >= 0 && x + y == n', goalSolution: 'x == 0 && y == n',
    hints: ["한 번 반복할 때 x의 감소량과 y의 증가량이 같다. 두 변수의 합을 확인하라.","합을 n과 연결하고 x ≥ 0을 보존하라. 종료 조건과 합치면 x = 0이다. 상한 x ≤ n은 필요 없다."],
    en: { name: 'Countdown Transfer', concept: 'Remaining work plus completed work', brief: 'Transfer n, the magnitude of any integer a, into y. x tracks the work remaining. Remember the input in n to use one invariant for every input.', hints: ["Each iteration decreases x and increases y by the same amount. Inspect their sum.","Relate the sum to n and preserve x ≥ 0. The exit condition then gives x = 0; no upper bound x ≤ n is needed."] },
  }),
  mission({
    id: 'g02', chapter: 1, name: '두 크기의 합', subtitle: 'ADDITION', concept: '초기 합의 보존',
    brief: '두 정수의 크기 n과 m을 더하라. x에서 y로 한 단위씩 옮겨 y에 n + m을 완성한다.',
    start: ({ n, m }) => ({ x: n, y: m }), initialization: 'let x = n;\nlet y = m;',
    battleInputs: [{ a: 2, b: 2 }, { a: -3, b: 2 }, { a: 4, b: -2 }],
    guardSource: 'x > 0', step: ({ x, y }) => ({ x: x - 1, y: y + 1 }),
    code: 'while (x > 0) {\n  x = x - 1;\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 7 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= m && x + y <= n + m',
    solution: 'x >= 0 && x + y == n + m', goalSolution: 'x == 0 && y == n + m',
    hints: ["초기 y는 0이 아니라 m이다. 초기 합부터 기록하라.","초기 합 n + m과 x ≥ 0을 보존하라. 종료 시 x = 0이므로 y의 최종값을 얻는다."],
    en: { name: 'Addition', concept: 'Preserve the initial sum', brief: 'Add the magnitudes n and m of two integers. Transfer one unit at a time from x into y to obtain n + m.', hints: ["The initial y is m rather than 0. Record the correct initial sum.","Preserve the initial sum n + m and x ≥ 0. At exit x = 0, determining the final y."] },
  }),
  mission({
    id: 'g03', chapter: 1, name: '배가 누산', subtitle: 'DOUBLING', concept: '변화율에 맞춘 가중 합',
    brief: 'n번 반복하여 2를 누적하라. x의 한 단위 감소가 y의 두 단위 증가와 균형을 이루는 관계를 확보한다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 1, b: 0 }, { a: -2, b: 0 }, { a: 3, b: 0 }],
    guardSource: 'x > 0', step: ({ x, y }) => ({ x: x - 1, y: y + 2 }),
    code: 'while (x > 0) {\n  y = y + 2;\n  x = x - 1;\n}',
    allies: [{ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 0, y: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && 2 * x + y <= 2 * n',
    solution: 'x >= 0 && 2 * x + y == 2 * n', goalSolution: 'x == 0 && y == 2 * n',
    hints: ["x + y는 매회 증가한다. x의 기여량을 두 배로 계산하라.","2 * x + y를 2 * n과 연결하라. 종료 시 x = 0을 얻는 데 필요한 경계는 x ≥ 0이다."],
    en: { name: 'Doubling', concept: 'Weight a sum by the rates of change', brief: 'Accumulate 2 for n iterations. Balance each one-unit decrease in x against the two-unit increase in y.', hints: ["x + y increases each time. Count the contribution of x twice.","Relate 2 * x + y to 2 * n. The bound x ≥ 0 is enough to establish x = 0 at exit."] },
  }),
  mission({
    id: 'g04', chapter: 1, name: '반복 덧셈 곱셈', subtitle: 'REPEATED-ADDITION PRODUCT', concept: '입력 매개변수를 가중치로 사용',
    brief: 'm을 n번 더해 n * m을 계산하라. m이 0인 입력도 같은 루프와 명세로 처리한다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 1, b: 2 }, { a: -2, b: 2 }, { a: 3, b: -2 }],
    guardSource: 'x > 0', step: ({ x, y, m }) => ({ x: x - 1, y: y + m }),
    code: 'while (x > 0) {\n  y = y + m;\n  x = x - 1;\n}',
    allies: [{ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 0, y: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && m * x + y <= n * m',
    solution: 'x >= 0 && m * x + y == n * m', goalSolution: 'x == 0 && y == n * m',
    hints: ["남은 반복은 x회이고 매회 m을 더한다. 남은 계산량을 식으로 적어라.","m * x + y == n * m과 x ≥ 0을 보존하라. m = 0에서도 성립하며 x의 상한은 필요 없다."],
    en: { name: 'Repeated-Addition Product', concept: 'Use an input parameter as a weight', brief: 'Add m exactly n times to compute n * m. The same loop and specification also handle m == 0.', hints: ["There are x iterations left, each adding m. Express the remaining contribution.","Preserve m * x + y == n * m and x ≥ 0. This includes m = 0 and needs no upper bound on x."] },
  }),
  mission({
    id: 'g05', chapter: 2, name: '용량과 최솟값', subtitle: 'MINIMUM BY FILLING', concept: '두 종료 원인과 합 보존',
    brief: '총량 n을 용량 m까지 채워 y = min(n,m)을 구하라. 재고가 소진되거나 용량이 찬다는 두 종료 원인을 모두 다룬다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 2, b: 3 }, { a: 3, b: 2 }, { a: -4, b: 3 }],
    guardSource: 'x > 0 && y < m', step: ({ x, y }) => ({ x: x - 1, y: y + 1 }),
    code: 'while (x > 0 && y < m) {\n  x = x - 1;\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 3 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && y <= m',
    solution: 'x >= 0 && y <= m && x + y == n',
    goalSolution: '(n <= m && x == 0 && y == n) || (n > m && x == n - m && y == m)',
    hints: ["x + y는 총량 n이다. y가 용량 m을 넘지 않는 경계도 필요하다.","x ≥ 0, y ≤ m과 합 보존으로 종료 시 x = 0 또는 y = m을 얻어라. y의 하한은 추가하지 않아도 된다."],
    en: { name: 'Minimum by Filling', concept: 'Two exit causes and a conserved sum', brief: 'Fill capacity m from a supply of n to compute y = min(n,m). Account for both exits: exhausted supply and full capacity.', hints: ["x + y equals the total supply n. Preserve the upper bound m on y too.","Combine x ≥ 0, y ≤ m, and the conserved sum. At exit x = 0 or y = m; a lower bound on y is unnecessary."] },
  }),
  mission({
    id: 'g06', chapter: 2, name: '차이 소거', subtitle: 'CANCELLATION', concept: '차이 보존과 부호에 따른 결과',
    brief: '두 크기에서 같은 양을 차감하라. 먼저 0이 된 쪽이 작았던 값이며, 반대쪽에는 두 크기의 차이가 남는다.',
    start: ({ n, m }) => ({ x: n, y: m }), initialization: 'let x = n;\nlet y = m;',
    battleInputs: [{ a: 4, b: 1 }, { a: -4, b: 2 }, { a: 2, b: -4 }],
    guardSource: 'x > 0 && y > 0', step: ({ x, y }) => ({ x: x - 1, y: y - 1 }),
    code: 'while (x > 0 && y > 0) {\n  x = x - 1;\n  y = y - 1;\n}',
    allies: [{ x: 4, y: 0 }, { x: 0, y: 3 }, { x: 0, y: 1 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && y <= m',
    solution: 'x >= 0 && y >= 0 && x - y == n - m',
    goalSolution: '(n >= m && x == n - m && y == 0) || (n < m && x == 0 && y == m - n)',
    hints: ["두 변수에서 같은 양을 빼면 차이는 변하지 않는다.","x - y == n - m과 두 비음수 하한을 결합하라. 초기값 상한 없이도 종료 시 한쪽이 0임을 보장한다."],
    en: { name: 'Cancellation', concept: 'Preserve a difference through either exit', brief: 'Subtract equal amounts from both magnitudes. The smaller side reaches zero first; the other retains their difference.', hints: ["Subtracting the same amount from both variables leaves their difference unchanged.","Combine x - y == n - m with both nonnegative lower bounds. Initial-value upper bounds are unnecessary."] },
  }),
  mission({
    id: 'g07', chapter: 2, name: '상한 집결', subtitle: 'MAXIMUM BY EQUALIZATION', concept: '입력 순서별 분기 불변식',
    brief: '작은 값만 한 칸씩 증가시켜 두 좌표를 최댓값 max(n,m)으로 일치시켜라. 처음 큰 쪽은 실행 내내 고정된다.',
    start: ({ n, m }) => ({ x: n, y: m }), initialization: 'let x = n;\nlet y = m;',
    battleInputs: [{ a: 1, b: 2 }, { a: 3, b: -1 }, { a: -2, b: 4 }],
    guardSource: 'x != y', step: ({ x, y }) => x < y ? { x: x + 1, y } : { x, y: y + 1 },
    code: 'while (x != y) {\n  if (x < y) {\n    x = x + 1;\n  } else {\n    y = y + 1;\n  }\n}',
    allies: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 6 }],
    referenceInvariant: 'x >= 0 && y >= 0 && x <= n + m && y <= n + m',
    solution: '(n >= m && x == n && y <= n) || (n < m && y == m && x <= m)',
    goalSolution: 'x == y && x >= n && x >= m && (x == n || x == m)',
    hints: ["n >= m이면 x는 n으로 고정된다. 반대 경우에는 y가 m으로 고정된다.","큰 좌표는 고정하고 움직이는 좌표가 그 값을 넘지 않게 하라. 두 입력 순서를 ||로 결합하되 움직이는 좌표의 하한은 생략한다."],
    en: { name: 'Maximum by Equalization', concept: 'A disjunctive invariant based on input order', brief: 'Increase only the smaller value until both coordinates equal max(n,m). The initially larger side stays fixed.', hints: ["When n >= m, x stays at n. Otherwise, y stays at m.","Fix the larger coordinate and bound the moving one above by it. Join the input-order cases with ||; omit lower bounds on the moving coordinate."] },
  }),
  mission({
    id: 'g08', chapter: 2, name: '맨해튼 거리', subtitle: 'MANHATTAN DISTANCE', concept: '부호 분기와 남은 거리',
    brief: '부호가 있는 좌표 a를 원점으로 이동시키며 이미 확보한 |b|에 이동량을 더하라. 최종 y는 |a| + |b|이다.',
    start: ({ a, m }) => ({ x: a, y: m }), initialization: 'let x = a;\nlet y = m;',
    battleInputs: [{ a: -2, b: 1 }, { a: 3, b: -1 }, { a: -4, b: 2 }],
    guardSource: 'x != 0', step: ({ x, y }) => ({ x: x > 0 ? x - 1 : x + 1, y: y + 1 }),
    code: 'while (x != 0) {\n  if (x > 0) {\n    x = x - 1;\n  } else {\n    x = x + 1;\n  }\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 5 }],
    referenceInvariant: 'y >= m && ((x >= 0 && x + y <= n + m) || (x < 0 && y - x <= n + m))',
    solution: 'y <= n + m && (x + y == n + m || y - x == n + m)',
    goalSolution: 'x == 0 && y == n + m',
    hints: ["남은 거리 |x|와 누적값 y의 합이 일정하다. x의 부호에 따라 |x|를 풀어 써라.","공통 상한 y ≤ n + m을 두고 x + y == n + m 또는 y - x == n + m을 결합하라. 각 등식이 필요한 x의 부호도 결정한다."],
    en: { name: 'Manhattan Distance', concept: 'Sign branches and remaining distance', brief: 'Move signed coordinate a to zero while adding the distance to |b|. The final y is |a| + |b|.', hints: ["The remaining distance |x| plus y is constant. Expand |x| by the sign of x.","Use the shared bound y ≤ n + m with x + y == n + m or y - x == n + m. Each equality then determines the required sign of x."] },
  }),
  mission({
    id: 'g09', chapter: 3, name: '몫과 나머지', subtitle: 'QUOTIENT AND REMAINDER', concept: '제수로 가중한 보존식',
    brief: 'n을 양의 제수 m + 1로 나누어라. x는 나머지, y는 몫이 된다. 제수는 어떤 정수 b에서도 0이 되지 않는다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 4, b: 1 }, { a: -3, b: 1 }, { a: 4, b: -3 }],
    guardSource: 'x >= m + 1', step: ({ x, y, m }) => ({ x: x - (m + 1), y: y + 1 }),
    code: 'while (x >= m + 1) {\n  x = x - (m + 1);\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    referenceInvariant: 'x >= 0 && y >= 0 && x + (m + 1) * y <= n',
    solution: 'x >= 0 && x + (m + 1) * y == n',
    goalSolution: 'x >= 0 && x < m + 1 && y >= 0 && x + (m + 1) * y == n',
    hints: ["제수를 한 번 빼면 몫 y가 1 증가한다. 복원된 피제수를 기록하라.","복원식 x + (m + 1) * y == n과 x ≥ 0을 유지하라. 종료 시 나머지의 상한과 몫의 비음수성까지 따라온다."],
    en: { name: 'Quotient and Remainder', concept: 'A conserved sum weighted by the divisor', brief: 'Divide n by the positive divisor m + 1. x becomes the remainder and y the quotient. The divisor is nonzero for every integer b.', hints: ["Subtracting the divisor once increases y by 1. Express the reconstructed dividend.","Preserve x + (m + 1) * y == n and x ≥ 0. The exit interval also implies that the quotient is nonnegative."] },
  }),
  mission({
    id: 'g10', chapter: 3, name: '올림 나눗셈', subtitle: 'CEILING DIVISION', concept: '음수 잔여량과 엄격한 하한',
    brief: '남은 양이 양수인 동안 용량 m + 1을 차감하라. y는 n을 수용하는 최소 묶음 수이며 x는 0 이하의 남은 양이다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 2, b: 1 }, { a: -4, b: 1 }, { a: 3, b: 0 }],
    guardSource: 'x > 0', step: ({ x, y, m }) => ({ x: x - (m + 1), y: y + 1 }),
    code: 'while (x > 0) {\n  x = x - (m + 1);\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 0, y: 5 }],
    referenceInvariant: 'x > -(m + 1) && y >= 0 && x + (m + 1) * y <= n',
    solution: 'x >= -m && x + (m + 1) * y == n',
    goalSolution: 'x <= 0 && x > -(m + 1) && y >= 0 && x + (m + 1) * y == n',
    hints: ["마지막 차감은 x를 음수로 만들 수 있다. x >= 0은 불변식이 아니다.","정수 x > 0에서 차감한 값은 x ≥ -m이다. 이 하한과 복원식이면 충분하며 y ≥ 0은 종료 시 도출된다."],
    en: { name: 'Ceiling Division', concept: 'Negative residuals and a strict lower bound', brief: 'Subtract capacity m + 1 while work remains. y counts the minimum number of batches; x is the nonpositive residual.', hints: ["The final subtraction can make x negative. x >= 0 is not invariant.","After subtraction from positive integer x, the new x is at least -m. This bound and the dividend relation suffice; y ≥ 0 follows at exit."] },
  }),
  mission({
    id: 'g11', chapter: 3, name: '순환 계수', subtitle: 'CYCLIC COUNTER', concept: '반복 횟수와 합동 관계',
    brief: 'x로 n회 진행을 세고 y를 0부터 m까지 순환시켜라. 초기 입력을 축소하지 않고 실제 반복으로 n의 나머지를 계산한다.',
    start: () => ({ x: 0, y: 0 }), initialization: 'let x = 0;\nlet y = 0;',
    battleInputs: [{ a: 2, b: 1 }, { a: -3, b: 1 }, { a: 4, b: -2 }],
    guardSource: 'x < n', step: ({ x, y, m }) => ({ x: x + 1, y: y + 1 === m + 1 ? 0 : y + 1 }),
    code: 'while (x < n) {\n  x = x + 1;\n  y = y + 1;\n  if (y == m + 1) {\n    y = 0;\n  }\n}',
    allies: [{ x: 2, y: 1 }, { x: 3, y: 0 }, { x: 4, y: 0 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && y < m + 1',
    solution: 'x >= 0 && x <= n && y == x % (m + 1)',
    goalSolution: 'x == n && y == n % (m + 1)',
    hints: ["y의 범위만으로는 현재 반복 횟수와의 연결이 없다. x와 y 사이의 합동 관계를 찾아라.","0 ≤ x ≤ n과 y == x % (m + 1)을 결합하라. y의 범위는 나머지 관계에서 따라오므로 따로 적지 않는다."],
    en: { name: 'Cyclic Counter', concept: 'Iteration count and modular congruence', brief: 'Count n iterations in x while cycling y from 0 through m. Compute the remainder through the loop without reducing the external input first.', hints: ["Bounds on y do not connect it to the iteration count. Find a congruence relating x and y.","Combine 0 ≤ x ≤ n with y == x % (m + 1). The bounds on y follow from the remainder relation."] },
  }),
  mission({
    id: 'g12', chapter: 3, name: '균형 정수평균', subtitle: 'BALANCED INTEGER MEAN', concept: '합 보존과 종료 구간',
    brief: '원래의 부호 있는 정수 a와 b를 균등하게 나누어라. 두 값의 합을 보존하며 x는 내림 평균, y는 올림 평균에 도달한다.',
    start: ({ a, b }) => ({ x: a, y: b }), initialization: 'let x = a;\nlet y = b;',
    battleInputs: [{ a: 0, b: 4 }, { a: 2, b: 4 }, { a: 1, b: 4 }],
    guardSource: 'x > y || y > x + 1', step: ({ x, y }) => x > y ? { x: x - 1, y: y + 1 } : { x: x + 1, y: y - 1 },
    code: 'while (x > y || y > x + 1) {\n  if (x > y) {\n    x = x - 1;\n    y = y + 1;\n  } else {\n    x = x + 1;\n    y = y - 1;\n  }\n}',
    allies: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
    referenceInvariant: '(a <= b && x >= a && x <= b && y >= a && y <= b) || (a > b && x >= b && x <= a && y >= b && y <= a)',
    solution: 'x + y == a + b',
    goalSolution: 'x + y == a + b && x <= y && y <= x + 1',
    hints: ["한쪽에서 1을 빼 반대쪽에 더하므로 x + y는 a + b이다. 음수 입력에서도 같다.","반복 조건을 부정하면 x ≤ y ≤ x + 1이다. ensures의 나머지 조건은 종료가 제공하므로 합 보존식 하나만 유지하라."],
    en: { name: 'Balanced Integer Mean', concept: 'A conserved sum and the exit interval', brief: 'Balance the original signed integers a and b without changing their sum. x reaches the floor of their mean, and y its ceiling.', hints: ["Moving one unit between variables preserves x + y == a + b, including negative inputs.","Negating the guard gives x ≤ y ≤ x + 1. Exit supplies the remaining ensures clauses, so preserve only the sum."] },
  }),
  mission({
    id: 'g13', chapter: 4, name: '삼각수 집결', subtitle: 'TRIANGULAR SUM', concept: '누적값과 남은 합의 보존',
    brief: 'n부터 1까지 차례로 더하라. y에 이미 더한 양과 x까지 남은 삼각수를 합치면 전체 결과를 보존할 수 있다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 1, b: 0 }, { a: -2, b: 0 }, { a: 3, b: 0 }],
    guardSource: 'x > 0', step: ({ x, y }) => ({ x: x - 1, y: y + x }),
    code: 'while (x > 0) {\n  y = y + x;\n  x = x - 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 0, y: 4 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && 2 * y + x * (x + 1) <= n * (n + 1)',
    solution: 'x >= 0 && 2 * y + x * (x + 1) == n * (n + 1)',
    goalSolution: 'x == 0 && 2 * y == n * (n + 1)',
    hints: ["남은 합 1 + ... + x는 x * (x + 1)의 절반이다.","2 * y와 남은 합의 두 배를 n * (n + 1)에 연결하라. x ≥ 0이면 종료 시 x = 0이며 x의 상한은 필요 없다."],
    en: { name: 'Triangular Sum', concept: 'Accumulated work plus a remaining sum', brief: 'Add n down through 1. Combine the amount already in y with the remaining triangular sum through x.', hints: ["The remaining sum 1 + ... + x is half of x * (x + 1).","Relate 2 * y plus twice the remaining sum to n * (n + 1). Keep x ≥ 0 for exit; no upper bound on x is needed."] },
  }),
  mission({
    id: 'g14', chapter: 4, name: '등차수열 누산', subtitle: 'ARITHMETIC PROGRESSION', concept: '처리한 접두 합의 닫힌식',
    brief: 'm에서 시작하는 연속한 n개 정수를 더하라. x는 처리한 항 수이고 y는 그 접두 합이다.',
    start: () => ({ x: 0, y: 0 }), initialization: 'let x = 0;\nlet y = 0;',
    battleInputs: [{ a: 1, b: 2 }, { a: -2, b: 2 }, { a: 3, b: -1 }],
    guardSource: 'x < n', step: ({ x, y, m }) => ({ x: x + 1, y: y + m + x }),
    code: 'while (x < n) {\n  y = y + m + x;\n  x = x + 1;\n}',
    allies: [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && 2 * y <= x * (2 * m + x - 1)',
    solution: 'x <= n && 2 * y == x * (2 * m + x - 1)',
    goalSolution: 'x == n && 2 * y == n * (2 * m + n - 1)',
    hints: ["x개 항의 첫 항은 m, 마지막 항은 m + x - 1이다.","2 * y == x * (2 * m + x - 1)과 x ≤ n을 결합하라. 항등식은 음수 x에서도 유지되므로 하한은 필요 없다."],
    en: { name: 'Arithmetic Progression', concept: 'A closed form for the processed prefix', brief: 'Add n consecutive integers starting at m. x counts processed terms and y stores their prefix sum.', hints: ["For x processed terms, the first is m and the last is m + x - 1.","Combine 2 * y == x * (2 * m + x - 1) with x ≤ n. The identity also holds for negative x, so no lower bound is needed."] },
  }),
  mission({
    id: 'g15', chapter: 4, name: '홀수로 제곱', subtitle: 'SQUARE BY ODD SUMS', concept: '차분으로 유지되는 제곱 관계',
    brief: '홀수 1, 3, 5, ...를 n개 더해 n의 제곱을 구하라. x는 더한 홀수의 개수이다.',
    start: () => ({ x: 0, y: 0 }), initialization: 'let x = 0;\nlet y = 0;',
    battleInputs: [{ a: 0, b: 0 }, { a: -1, b: 0 }, { a: 2, b: 0 }],
    guardSource: 'x < n', step: ({ x, y }) => ({ x: x + 1, y: y + 2 * x + 1 }),
    code: 'while (x < n) {\n  y = y + 2 * x + 1;\n  x = x + 1;\n}',
    allies: [{ x: 1, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 3 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && y <= x * x',
    solution: 'x <= n && y == x * x', goalSolution: 'x == n && y == n * n',
    hints: ["(x + 1)의 제곱과 x의 제곱 사이 차이는 2 * x + 1이다.","y == x * x와 x ≤ n을 유지하라. 종료 조건이 x = n을 결정하며 x ≥ 0을 추가할 필요는 없다."],
    en: { name: 'Square by Odd Sums', concept: 'Preserve a square through its finite difference', brief: 'Add n odd numbers, 1, 3, 5, ... to compute n squared. x counts how many have been added.', hints: ["The difference between (x + 1) squared and x squared is 2 * x + 1.","Preserve y == x * x and x ≤ n. The exit condition forces x = n; no additional x ≥ 0 clause is needed."] },
  }),
  mission({
    id: 'g16', chapter: 4, name: '짝수로 연속곱', subtitle: 'PRONIC NUMBER', concept: '인접한 두 정수의 곱과 차분',
    brief: '짝수 2, 4, 6, ...를 n개 더하라. 누적값은 n과 n + 1의 곱으로 표현된다.',
    start: () => ({ x: 0, y: 0 }), initialization: 'let x = 0;\nlet y = 0;',
    battleInputs: [{ a: 0, b: 0 }, { a: 1, b: 0 }, { a: -2, b: 0 }],
    guardSource: 'x < n', step: ({ x, y }) => ({ x: x + 1, y: y + 2 * x + 2 }),
    code: 'while (x < n) {\n  y = y + 2 * x + 2;\n  x = x + 1;\n}',
    allies: [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 2, y: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && y <= x * (x + 1)',
    solution: 'x <= n && y == x * (x + 1)', goalSolution: 'x == n && y == n * (n + 1)',
    hints: ["(x + 1)(x + 2) - x(x + 1) = 2x + 2이다. 연속곱의 변화량을 확인하라.","y == x * (x + 1)과 x ≤ n을 유지하라. 종료 시 x = n이며 음수 x를 미리 배제할 필요는 없다."],
    en: { name: 'Pronic Number', concept: 'A product of adjacent integers and its difference', brief: 'Add n even numbers, 2, 4, 6, ... . Express the total as the product of n and n + 1.', hints: ["The increase in x * (x + 1) when x advances by 1 is 2 * x + 2.","Preserve y == x * (x + 1) and x ≤ n. Exit gives x = n; negative x need not be excluded in advance."] },
  }),
  mission({
    id: 'g17', chapter: 5, name: '제곱합 보급', subtitle: 'SUM OF SQUARES', concept: '세제곱 보존량으로 제곱 누산 증명',
    brief: 'n부터 1까지 각 수의 제곱을 더하라. 처리한 제곱합과 남은 제곱합을 하나의 보존식으로 결합한다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 0, b: 0 }, { a: -1, b: 0 }, { a: 2, b: 0 }],
    guardSource: 'x > 0', step: ({ x, y }) => ({ x: x - 1, y: y + x * x }),
    code: 'while (x > 0) {\n  y = y + x * x;\n  x = x - 1;\n}',
    allies: [{ x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= 0 && 6 * y + x * (x + 1) * (2 * x + 1) <= n * (n + 1) * (2 * n + 1)',
    solution: 'x >= 0 && 6 * y + x * (x + 1) * (2 * x + 1) == n * (n + 1) * (2 * n + 1)',
    goalSolution: 'x == 0 && 6 * y == n * (n + 1) * (2 * n + 1)',
    hints: ["1² + ... + x²의 여섯 배는 x * (x + 1) * (2 * x + 1)이다.","6 * y와 남은 제곱합의 여섯 배를 보존하라. 종료 시 x = 0을 보장하는 하한 x ≥ 0만 덧붙인다."],
    en: { name: 'Sum of Squares', concept: 'A cubic conserved quantity proves a square sum', brief: 'Sum the squares from n down through 1. Combine the accumulated square sum and the remaining square sum into one conserved quantity.', hints: ["Six times 1² + ... + x² is x * (x + 1) * (2 * x + 1).","Conserve 6 * y plus six times the remaining square sum. Add only x ≥ 0 to establish x = 0 at exit."] },
  }),
  mission({
    id: 'g18', chapter: 5, name: '제곱근과 잔여량', subtitle: 'INTEGER SQUARE ROOT', concept: '제곱 관계와 종료 부등식',
    brief: '홀수를 차례로 빼 n의 내림 제곱근을 구하라. y는 현재 제곱근이고 x는 아직 설명하지 못한 잔여량이다.',
    start: ({ n }) => ({ x: n, y: 0 }), initialization: 'let x = n;\nlet y = 0;',
    battleInputs: [{ a: 1, b: 0 }, { a: -2, b: 0 }, { a: 4, b: 0 }],
    guardSource: 'x >= 2 * y + 1', step: ({ x, y }) => ({ x: x - (2 * y + 1), y: y + 1 }),
    code: 'while (x >= 2 * y + 1) {\n  x = x - (2 * y + 1);\n  y = y + 1;\n}',
    allies: [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    referenceInvariant: 'x >= 0 && y >= 0 && x + y * y <= n',
    solution: 'x >= 0 && x + y * y == n',
    goalSolution: 'x >= 0 && x < 2 * y + 1 && y >= 0 && x + y * y == n',
    hints: ["y가 1 증가할 때 y²의 변화량은 2 * y + 1이고 x의 변화량은 그 반대이다.","x ≥ 0과 x + y² == n을 보존하라. 종료 시 0 ≤ x < 2 * y + 1이므로 y ≥ 0도 따라온다."],
    en: { name: 'Integer Square Root', concept: 'A square relation and the exit inequality', brief: 'Subtract successive odd numbers to find the floor of the square root of n. y tracks the root and x is the residual.', hints: ["When y increases by 1, the change in y² is 2 * y + 1. The change in x is its negative.","Preserve x ≥ 0 and x + y² == n. At exit 0 ≤ x < 2 * y + 1 also forces y ≥ 0."] },
  }),
  mission({
    id: 'g19', chapter: 5, name: '올림 제곱근', subtitle: 'CEILING SQUARE ROOT', concept: '현재 제곱과 직전 제곱의 경계',
    brief: '제곱수를 차례로 생성하여 처음으로 n 이상이 되는 제곱을 찾아라. 현재 제곱의 정확성과 직전 제곱이 부족했다는 경계를 함께 유지한다.',
    start: () => ({ x: 0, y: 0 }), initialization: 'let x = 0;\nlet y = 0;',
    battleInputs: [{ a: 0, b: 0 }, { a: -1, b: 0 }, { a: 2, b: 0 }],
    guardSource: 'y < n', step: ({ x, y }) => ({ x: x + 1, y: y + 2 * x + 1 }),
    code: 'while (y < n) {\n  y = y + 2 * x + 1;\n  x = x + 1;\n}',
    allies: [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    referenceInvariant: 'x >= 0 && y >= x * x && (x == 0 || (x - 1) * (x - 1) < n)',
    solution: 'y == x * x && (x == 0 || y - 2 * x + 1 < n)',
    goalSolution: 'y >= n && x >= 0 && y == x * x && (x == 0 || (x - 1) * (x - 1) < n)',
    hints: ["y == x * x만으로는 처음 도달한 제곱인지 알 수 없다. 직전 제곱의 경계가 필요하다.","x = 0인 초기 예외를 허용하라. y == x²에서 직전 제곱은 y - 2 * x + 1이다. x의 비음수성은 종료 시 도출한다."],
    en: { name: 'Ceiling Square Root', concept: 'Bound both the current and previous square', brief: 'Generate successive squares until the first one reaches n. Preserve both the exact current square and the fact that the previous one was too small.', hints: ["y == x * x alone does not prove this was the first sufficient square. Bound the previous square too.","Allow the initial exception x = 0. Under y == x², the previous square is y - 2 * x + 1. Derive nonnegativity of x at exit."] },
  }),
  mission({
    id: 'g20', chapter: 5, name: '제곱근 이분 탐색', subtitle: 'BINARY SQUARE-ROOT SEARCH', concept: '정답을 사이에 둔 두 경계',
    brief: 'x² <= n < y²인 구간을 절반씩 줄여라. 두 끝이 인접하면 x가 내림 제곱근이다. mid는 매회 다시 계산하는 임시값이다.',
    start: ({ n }) => ({ x: 0, y: n + 1 }), initialization: 'let x = 0;\nlet y = n + 1;',
    battleInputs: [{ a: 0, b: 0 }, { a: -1, b: 0 }, { a: 4, b: 0 }],
    guardSource: 'y - x > 1', step: ({ x, y, n }) => {
      const mid = Math.floor((x + y) / 2);
      return mid * mid <= n ? { x: mid, y } : { x, y: mid };
    },
    code: 'while (y - x > 1) {\n  const mid = Math.floor((x + y) / 2);\n  if (mid * mid <= n) {\n    x = mid;\n  } else {\n    y = mid;\n  }\n}',
    allies: [{ x: 3, y: 4 }, { x: 4, y: 5 }, { x: 0, y: 0 }],
    referenceInvariant: 'x >= 0 && x < y && y <= n + 1',
    solution: 'x < y && x * x <= n && n < y * y',
    goalSolution: 'x >= 0 && y == x + 1 && x * x <= n && n < y * y',
    hints: ["왼쪽 끝의 제곱은 n 이하이고 오른쪽 끝의 제곱은 n보다 크다. 서로 다른 두 부등호를 보존하라.","x < y와 제곱의 두 경계만 유지하라. 종료 시 y = x + 1이며 이때 x가 음수라면 두 제곱의 순서가 모순된다."],
    en: { name: 'Binary Square-Root Search', concept: 'Two boundaries bracket the answer', brief: 'Halve an interval satisfying x² <= n < y². Once the endpoints are adjacent, x is the floor square root. mid is recomputed locally each iteration.', hints: ["The left square is at most n; the right square is strictly greater. Preserve both different inequalities.","Keep only x < y and both square bounds. At exit y = x + 1; negative x would contradict the order of the two squares."] },
  }),
];
