import { evaluate, parseExpression } from './engine.js';

// The input contract remains (a,b) in Z². Domains below are finite checker
// windows, not preconditions or clamps on the algorithms. x/y are map axes;
// z identifies a distinct layer, including when two units share x/y.
const point = ({ x, y, z }) => ({ x, y, z });
const key = ({ x, y, z }) => `${x},${y},${z}`;
const mission = ({ start, initialization, ...definition }) => {
  const initialize = ({ a, b }) => {
    const n = Math.abs(a), m = Math.abs(b);
    return { ...start({ n, m }), n, m };
  };
  const guard = parseExpression(definition.guardSource);
  const endpoints = definition.battleInputs.map(({ a, b }) => {
    let state = { ...initialize({ a, b }), a, b };
    let steps = 0;
    while (evaluate(guard, state)) {
      if (++steps > 1024) throw new Error(`Nonterminating spatial sample: ${definition.id}`);
      state = { ...state, ...point(definition.step(state)) };
    }
    if (state.x < 0 || state.x >= 9 || state.y < 0 || state.y >= 9
      || state.z < definition.domains.z.min || state.z > definition.domains.z.max) {
      throw new Error(`Off-board spatial endpoint: ${definition.id}`);
    }
    return point(state);
  });
  return {
    size: 9, commands: 6, chapter: 6, variables: ['x', 'y', 'z'],
    ...definition, initialize,
    initializationCode: `const n = Math.abs(a);\nconst m = Math.abs(b);\n${initialization}`,
    enemies: [...new Map(endpoints.map(endpoint => [key(endpoint), endpoint])).values()],
    starter: definition.starter ?? definition.referenceInvariant,
    hints: [...definition.hints, `검증 해법: ${definition.solution}`],
    en: { ...definition.en, hints: [...definition.en.hints, `Verified solution: ${definition.solution}`] },
  };
};

export const SPATIAL_LEVELS = [
  mission({
    id: 's01', name: '홀수 차분 장전', subtitle: 'SQUARES BY FINITE DIFFERENCES', concept: '현재 제곱과 다음 차분의 두 관계',
    brief: '곱셈 없이 n²+m을 계산하라. x는 처리한 횟수, y는 누산값, z는 다음에 더할 홀수이다. z층을 바꾸어 세 변수의 관계를 확인하라.',
    domains: { x: { min: 0, max: 4 }, y: { min: 0, max: 20 }, z: { min: 1, max: 9 } },
    start: ({ m }) => ({ x: 0, y: m, z: 1 }), initialization: 'let x = 0;\nlet y = m;\nlet z = 1;',
    battleInputs: [{ a: 0, b: 1 }, { a: -1, b: 1 }, { a: 2, b: 0 }],
    guardSource: 'x < n',
    step: ({ x, y, z }) => ({ x: x + 1, y: y + z, z: z + 2 }),
    code: 'while (x < n) {\n  y = y + z;\n  z = z + 2;\n  x = x + 1;\n}',
    allies: [{ x: 1, y: 1, z: 3 }, { x: 2, y: 2, z: 5 }, { x: 2, y: 3, z: 5 }],
    referenceInvariant: 'x >= 0 && x <= n && y >= m && y <= x * x + m && z == 2 * x + 1',
    solution: 'x <= n && y == x * x + m && z == 2 * x + 1',
    goalSolution: 'x == n && y == n * n + m && z == 2 * n + 1',
    hints: ['제곱의 차 (x+1)²−x²는 2x+1이다. z가 이 차이를 기억하게 하라.', 'y와 현재 제곱의 관계, z와 다음 홀수의 관계를 함께 보존하라. x ≤ n으로 종료 지점을 고정한다.'],
    explanation: {
      initial: 'x=0, y=m, z=1이므로 y=x²+m, z=2x+1, x≤n이 모두 성립한다.',
      preservation: 'y′=y+z=x²+m+2x+1=(x+1)²+m이고 z′=z+2=2(x+1)+1이다. 정수 x<n에서 x′=x+1≤n이다.',
      postcondition: '종료 시 x≥n이고 불변식은 x≤n이므로 x=n이다. 두 등식에 대입하면 y=n²+m, z=2n+1을 얻는다.',
      note: '모든 정수 입력의 크기 n,m≥0에 대한 관계이다. 실제 실행은 x가 0부터 n까지 증가하므로 종료한다. 유한 검사창은 이 일반 논증을 대신하지 않는다.',
    },
    en: {
      name: 'Load the Next Odd Difference', concept: 'Relate the current square and its next difference',
      brief: 'Compute n²+m without multiplication in the loop. x counts completed steps, y accumulates the result, and z stores the next odd addend. Inspect their relation across z layers.',
      hints: ['The difference (x+1)²−x² is 2x+1. Let z remember it.', 'Preserve both y’s square relation and z’s next-odd-number relation. Bound x by n to identify the exit.'],
      explanation: {
        initial: 'Initially x=0, y=m, z=1, so y=x²+m, z=2x+1, and x≤n all hold.',
        preservation: 'y′=y+z=x²+m+2x+1=(x+1)²+m and z′=z+2=2(x+1)+1. Integer x<n implies x′=x+1≤n.',
        postcondition: 'Exit gives x≥n; the invariant gives x≤n. Thus x=n, and substitution yields y=n²+m and z=2n+1.',
        note: 'The argument applies to all integer inputs through n,m≥0. Actual execution increments x from 0 to n and terminates. Finite checking is separate from this general argument.',
      },
    },
  }),
  mission({
    id: 's02', name: '짝짓기와 최솟값', subtitle: 'PAIRING TWO STOCKPILES', concept: '잔여량 둘과 공통 처리량',
    brief: '두 물자의 짝을 최대한 만들어라. x와 y는 각 잔여량, z는 완성한 짝 수이다. 같은 지도 좌표라도 z가 다르면 서로 다른 부대이다.',
    domains: { x: { min: 0, max: 4 }, y: { min: 0, max: 4 }, z: { min: 0, max: 4 } },
    start: ({ n, m }) => ({ x: n, y: m, z: 0 }), initialization: 'let x = n;\nlet y = m;\nlet z = 0;',
    battleInputs: [{ a: 1, b: 1 }, { a: -2, b: 2 }, { a: 1, b: 3 }],
    guardSource: 'x > 0 && y > 0',
    step: ({ x, y, z }) => ({ x: x - 1, y: y - 1, z: z + 1 }),
    code: 'while (x > 0 && y > 0) {\n  x = x - 1;\n  y = y - 1;\n  z = z + 1;\n}',
    allies: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }],
    referenceInvariant: 'x >= 0 && y >= 0 && z >= 0 && x + z <= n && y + z <= m',
    solution: 'x >= 0 && y >= 0 && x + z == n && y + z == m',
    goalSolution: 'x >= 0 && y >= 0 && (x == 0 || y == 0) && x + z == n && y + z == m',
    hints: ['완성한 짝 하나마다 두 잔여량이 각각 하나 감소한다. 각 입력을 보존하는 합을 찾아라.', 'x+z와 y+z를 각각 원래 물자 수에 연결하라. 두 잔여량의 비음수성과 종료 조건으로 z=min(n,m)을 도출한다.'],
    explanation: {
      initial: '초기 잔여량은 n,m이고 완성한 짝은 0이다. 따라서 x+z=n, y+z=m이며 x,y≥0이다.',
      preservation: 'x와 y가 각각 1 감소하고 z가 1 증가하므로 두 합은 그대로이다. 반복 조건은 두 잔여량이 양수임을 보장하여 감소 후에도 비음수이다.',
      postcondition: '종료 시 x≤0 또는 y≤0이다. 비음수성 때문에 적어도 하나는 0이고 두 합 관계가 유지된다. 따라서 z=min(n,m), x=n−z, y=m−z이다.',
      note: '실제 경로에서 z≥0은 초기값과 증가 동작으로 성립한다. 불변식에 따로 적지 않아도 종료 시 z는 n 또는 m이므로 비음수이다. 실제 반복 횟수는 min(n,m)이다.',
    },
    en: {
      name: 'Pairing and the Minimum', concept: 'Two remainders share one completed count',
      brief: 'Build as many pairs as possible from two stockpiles. x and y are leftovers; z counts completed pairs. Equal map coordinates on different z layers identify different units.',
      hints: ['Every completed pair consumes one item from each stockpile. Find a conserved sum for each input.', 'Relate x+z and y+z to the initial amounts. Nonnegative leftovers and the exit condition give z=min(n,m).'],
      explanation: {
        initial: 'The initial leftovers are n,m and the completed count is 0. Hence x+z=n, y+z=m, and x,y≥0.',
        preservation: 'Both leftovers decrease by 1 while z increases by 1, preserving both sums. The guard makes both leftovers positive, so neither becomes negative.',
        postcondition: 'Exit gives x≤0 or y≤0. Nonnegativity makes at least one zero. The conserved sums therefore give z=min(n,m), x=n−z, and y=m−z.',
        note: 'Actual execution keeps z≥0 by initialization and incrementing. It is unnecessary in the invariant: at exit z equals n or m and is nonnegative. Execution takes min(n,m) iterations.',
      },
    },
  }),
  mission({
    id: 's03', name: '단위 분배 계수기', subtitle: 'QUOTIENT AND REMAINDER COUNTER', concept: '미처리량·완성 묶음·부분 묶음의 보존',
    brief: 'n개 항목을 크기 m+1의 묶음으로 나눠라. x는 미처리량, y는 완성 묶음 수, z는 현재 묶음의 항목 수이다. 넘침 분기의 보존식을 세워라.',
    domains: { x: { min: 0, max: 4 }, y: { min: 0, max: 4 }, z: { min: 0, max: 4 } },
    start: ({ n }) => ({ x: n, y: 0, z: 0 }), initialization: 'let x = n;\nlet y = 0;\nlet z = 0;',
    battleInputs: [{ a: 4, b: 1 }, { a: -4, b: 2 }, { a: 3, b: 3 }],
    guardSource: 'x > 0',
    step: ({ x, y, z, m }) => z + 1 === m + 1
      ? { x: x - 1, y: y + 1, z: 0 } : { x: x - 1, y, z: z + 1 },
    code: 'while (x > 0) {\n  x = x - 1;\n  z = z + 1;\n  if (z == m + 1) {\n    z = 0;\n    y = y + 1;\n  }\n}',
    allies: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    referenceInvariant: 'x >= 0 && y >= 0 && z >= 0 && z <= m && x + (m + 1) * y + z <= n',
    solution: 'x >= 0 && z >= 0 && z <= m && x + (m + 1) * y + z == n',
    goalSolution: 'x == 0 && z >= 0 && z <= m && (m + 1) * y + z == n',
    hints: ['완성 묶음 하나는 항목 m+1개와 같다. 세 상태 변수에 들어 있는 총 항목 수를 보존하라.', 'z의 범위는 0부터 m까지이다. 묶음이 완성될 때 z를 0으로 되돌리는 대신 y를 증가시켜 같은 수량을 보존한다.'],
    explanation: {
      initial: 'x=n, y=z=0이므로 총량 x+(m+1)y+z=n이고 x≥0, 0≤z≤m이다.',
      preservation: '먼저 x를 1 줄이고 z를 1 늘려 총량을 보존한다. z=m+1이면 z를 0으로 바꾸고 y를 1 늘려 같은 총량을 유지한다. 아니면 정수성으로 z≤m이며, 두 경우 모두 0≤z≤m이다.',
      postcondition: 'x≥0과 종료 조건 x≤0에서 x=0이다. 따라서 n=(m+1)y+z와 0≤z<m+1이 성립하여 y는 몫, z는 나머지이다.',
      note: '제수 m+1은 항상 양수이다. y≥0은 종료 시 n≥0과 나머지 범위에서 따라온다. x가 n에서 0까지 감소하여 모든 입력에서 종료한다.',
    },
    en: {
      name: 'Unit Distribution Counter', concept: 'Conserve pending items, full batches, and a partial batch',
      brief: 'Divide n items into batches of m+1. x counts pending items, y full batches, and z the current partial batch. Preserve the total across the rollover branch.',
      hints: ['One full batch contains m+1 items. Conserve the total represented by all three state variables.', 'Keep z between 0 and m. Completing a batch resets z to 0 and increments y, preserving the same item count.'],
      explanation: {
        initial: 'With x=n and y=z=0, the total x+(m+1)y+z equals n; x≥0 and 0≤z≤m hold.',
        preservation: 'Decrementing x and incrementing z first preserves the total. If z=m+1, resetting z and incrementing y preserves it again. Otherwise integrality gives z≤m. Both branches restore 0≤z≤m.',
        postcondition: 'Nonnegative x and exit condition x≤0 force x=0. Thus n=(m+1)y+z and 0≤z<m+1 identify quotient y and remainder z.',
        note: 'The divisor m+1 is always positive. At exit, n≥0 and the remainder bound imply y≥0. The counter x decreases from n to 0, proving termination for every input.',
      },
    },
  }),
  mission({
    id: 's04', name: '반감과 배증 곱셈', subtitle: 'RUSSIAN PEASANT MULTIPLICATION', concept: '남은 곱과 누적한 곱의 합',
    brief: '한 인수는 절반으로 줄이고 다른 인수는 두 배로 늘려 n×m을 계산하라. x가 홀수일 때만 y를 z에 누적한다. 결과는 z이며 종료 시 y값은 명세가 제한하지 않는다.',
    domains: { x: { min: 0, max: 4 }, y: { min: 0, max: 32 }, z: { min: 0, max: 16 } },
    start: ({ n, m }) => ({ x: n, y: m, z: 0 }), initialization: 'let x = n;\nlet y = m;\nlet z = 0;',
    battleInputs: [{ a: 1, b: 1 }, { a: -2, b: 1 }, { a: 3, b: 1 }],
    guardSource: 'x > 0',
    step: ({ x, y, z }) => ({ x: Math.floor(x / 2), y: 2 * y, z: x % 2 === 1 ? z + y : z }),
    code: 'while (x > 0) {\n  if (x % 2 == 1) {\n    z = z + y;\n  }\n  x = Math.floor(x / 2);\n  y = 2 * y;\n}',
    allies: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 3, z: 0 }],
    referenceInvariant: 'x >= 0 && y >= 0 && z >= 0 && x * y + z <= n * m',
    solution: 'x >= 0 && x * y + z == n * m',
    goalSolution: 'x == 0 && z == n * m',
    hints: ['x×y는 아직 누적하지 않은 곱이다. 이미 확보한 z와 더하면 어떤 입력 관계가 되는가?', '짝수 x=2k와 홀수 x=2k+1을 나누어 확인하라. 홀수일 때 사라지는 y 한 개를 z로 옮기면 총량이 보존된다.'],
    explanation: {
      initial: 'x=n, y=m, z=0이므로 x≥0이고 xy+z=nm이다.',
      preservation: '짝수 x=2k이면 x′y′+z′=k·2y+z=xy+z이다. 홀수 x=2k+1이면 z′=z+y이므로 k·2y+z+y=xy+z이다. 두 경우 모두 x′≥0이다.',
      postcondition: '종료 조건 x≤0과 불변식 x≥0에서 x=0이다. 남은 곱 xy가 0이므로 z=nm을 얻는다. y의 최종값은 제한하지 않아 정답에도 중립 후보가 남을 수 있다.',
      note: '이 관계는 가상의 음수 y,z에서도 보존된다. 실제 경로에서는 모든 변수가 비음수이고 양수 x의 정수 반감이 엄격히 감소하므로 종료한다. 검사창의 비음수 상태에서 xy+z≤16이고 x>0이면 y≤16이므로 다음 y≤32이다.',
    },
    en: {
      name: 'Halve and Double Multiplication', concept: 'Remaining product plus accumulated product',
      brief: 'Compute n×m by halving one factor and doubling the other. Add y to z only when x is odd. The result is z; the specification does not constrain the final y.',
      hints: ['x×y is the product still waiting to be accumulated. What input relation does it form together with z?', 'Consider even x=2k and odd x=2k+1 separately. For odd x, transfer the lost copy of y into z to preserve the total.'],
      explanation: {
        initial: 'Initially x=n, y=m, z=0, so x≥0 and xy+z=nm.',
        preservation: 'For even x=2k, x′y′+z′=k·2y+z=xy+z. For odd x=2k+1, z′=z+y gives k·2y+z+y=xy+z. Both branches keep x′≥0.',
        postcondition: 'Exit gives x≤0, and the invariant gives x≥0, so x=0. The remaining product vanishes and z=nm. Final y is unrestricted, so a correct invariant can still leave neutral candidates.',
        note: 'The relation also holds at hypothetical negative y,z. Actual variables stay nonnegative, and halving positive integer x strictly decreases it, proving termination. In the nonnegative test window, xy+z≤16 with x>0 implies y≤16, so the next y is at most 32.',
      },
    },
  }),
];
