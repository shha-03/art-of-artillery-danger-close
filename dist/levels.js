import { BASIC_LEVELS } from './levels-basic.js';
import { ADVANCED_LEVELS } from './levels-advanced.js';
import { withUnitBranches } from './unit-types.js';

// Stable IDs keep earlier completion records available across scoring versions.
const LEGACY_LEVELS = [
  {
    id: '01',
    name: '덧셈 이송',
    subtitle: 'ADDITION TRANSFER',
    brief: 'x를 하나씩 y로 이전해 두 수의 합을 계산한다. x는 남은 이송량, y는 누산값이다. 세 입력의 합에 해당하는 종료 좌표만 포착하라.',
    size: 9,
    initialStates: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 6, y: 2 }],
    guardSource: 'x > 0',
    step: ({ x, y }) => ({ x: x - 1, y: y + 1 }),
    code: 'while (x > 0) {\n  x = x - 1;\n  y = y + 1;\n}',
    commands: 6,
    enemies: [{ x: 0, y: 4 }, { x: 0, y: 6 }, { x: 0, y: 8 }],
    allies: [{ x: 0, y: 3 }, { x: 0, y: 5 }, { x: 0, y: 7 }],
    starter: 'x >= 0 && y >= 0 && x + y <= 8',
    hints: [
      '한 번 반복하면 x는 1 감소하고 y는 1 증가한다. 두 변화를 상쇄하는 합 x + y를 확인하라.',
      '세 입력에서 x + y는 각각 4, 6, 8이다. x와 y가 음수가 되지 않도록 하고, 이 세 합만 허용하라.',
      '검증 해법: x >= 0 && y >= 0 && (x + y == 4 || x + y == 6 || x + y == 8)',
    ],
    en: {
      name: 'Addition Transfer',
      brief: 'Add the two starting values by moving one unit from x to y each iteration. x tracks the amount left to transfer; y accumulates the sum. Designate only the three actual exit states.',
      hints: [
        'Each iteration decreases x by 1 and increases y by 1. Identify the conserved sum x + y.',
        'The three inputs have sums of 4, 6, and 8. Keep x and y nonnegative, and permit only these three sums.',
        'Verified solution: x >= 0 && y >= 0 && (x + y == 4 || x + y == 6 || x + y == 8)',
      ],
    },
    solution: 'x >= 0 && y >= 0 && (x + y == 4 || x + y == 6 || x + y == 8)',
    goalSolution: 'x == 0 && (y == 4 || y == 6 || y == 8)',
  },
  {
    id: '02',
    name: '정수 나눗셈',
    subtitle: 'QUOTIENT & REMAINDER',
    brief: 'x에서 3을 반복 차감해 정수 나눗셈을 수행한다. x는 남은 수이자 최종 나머지, y는 누적 몫이다. 입력 5, 6, 8의 실제 결과만 사격 범위에 포함하라.',
    size: 9,
    initialStates: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 }],
    guardSource: 'x >= 3',
    step: ({ x, y }) => ({ x: x - 3, y: y + 1 }),
    code: 'while (x >= 3) {\n  x = x - 3;\n  y = y + 1;\n}',
    commands: 6,
    enemies: [{ x: 0, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    allies: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
    starter: 'x >= 0 && y >= 0 && x + 3 * y <= 8',
    hints: [
      'x에서 3을 뺄 때 y는 1 증가한다. y를 3배해 x와 합치면 실행 전후 값이 보존된다.',
      '보존량 x + 3 * y는 입력 5, 6, 8이다. 종료 시 x는 0 이상 3 미만이므로 나머지가 되고, y가 몫이 된다.',
      '검증 해법: x >= 0 && y >= 0 && (x + 3 * y == 5 || x + 3 * y == 6 || x + 3 * y == 8)',
    ],
    en: {
      name: 'Integer Division',
      brief: 'Divide each input by 3 through repeated subtraction. x holds the remaining dividend and final remainder; y counts the quotient. Target the results for inputs 5, 6, and 8.',
      hints: [
        'Subtracting 3 from x increases y by 1. Multiply y by 3 and add x to obtain a conserved quantity.',
        'The quantity x + 3 * y preserves the input: 5, 6, or 8. At exit, x is nonnegative and less than 3, making x the remainder and y the quotient.',
        'Verified solution: x >= 0 && y >= 0 && (x + 3 * y == 5 || x + 3 * y == 6 || x + 3 * y == 8)',
      ],
    },
    solution: 'x >= 0 && y >= 0 && (x + 3 * y == 5 || x + 3 * y == 6 || x + 3 * y == 8)',
    goalSolution: '(x == 0 && y == 2) || (x == 2 && y == 1) || (x == 2 && y == 2)',
  },
  {
    id: '03',
    name: '삼각수 집결',
    subtitle: 'TRIANGULAR SUM',
    brief: '초기 x부터 1까지 차례로 더해 삼각수를 계산한다. x는 다음에 더할 수, y는 누적 합이다. 세 입력의 종료 결과만 포착하라.',
    size: 9,
    initialStates: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    guardSource: 'x > 0',
    step: ({ x, y }) => ({ x: x - 1, y: y + x }),
    code: 'while (x > 0) {\n  y = y + x;\n  x = x - 1;\n}',
    commands: 6,
    enemies: [{ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 0, y: 6 }],
    allies: [{ x: 0, y: 2 }, { x: 0, y: 4 }, { x: 0, y: 5 }],
    starter: 'x >= 0 && y >= 0 && x * (x + 1) + 2 * y <= 12',
    hints: [
      '남은 합 1 + 2 + … + x를 두 배 하면 x * (x + 1)이다. 이미 누적한 값도 2 * y로 맞춰 합쳐라.',
      '보존량 x * (x + 1) + 2 * y는 입력별로 2, 6, 12이다. x가 0이면 남은 합이 사라지고 y가 최종 삼각수가 된다.',
      '검증 해법: x >= 0 && y >= 0 && (x * (x + 1) + 2 * y == 2 || x * (x + 1) + 2 * y == 6 || x * (x + 1) + 2 * y == 12)',
    ],
    en: {
      name: 'Triangular Sum',
      brief: 'Compute triangular numbers by adding the integers from the initial x down to 1. x is the next addend; y is the running total. Designate only the three actual results.',
      hints: [
        'Twice the remaining sum, 1 + 2 + … + x, is x * (x + 1). Add twice the accumulated total, 2 * y.',
        'The quantity x * (x + 1) + 2 * y remains 2, 6, or 12 for the three inputs. When x reaches 0, y holds the completed triangular number.',
        'Verified solution: x >= 0 && y >= 0 && (x * (x + 1) + 2 * y == 2 || x * (x + 1) + 2 * y == 6 || x * (x + 1) + 2 * y == 12)',
      ],
    },
    solution: 'x >= 0 && y >= 0 && (x * (x + 1) + 2 * y == 2 || x * (x + 1) + 2 * y == 6 || x * (x + 1) + 2 * y == 12)',
    goalSolution: 'x == 0 && (y == 1 || y == 3 || y == 6)',
  },
  {
    id: '04',
    name: '제곱근 탐색',
    subtitle: 'INTEGER SQUARE ROOT',
    brief: '홀수 1, 3, 5…를 차감해 정수 제곱근과 나머지를 계산한다. y는 제곱근 후보, x는 남은 수이다. 입력 2, 5, 8의 종료 결과만 포착하라.',
    size: 9,
    initialStates: [{ x: 2, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }],
    guardSource: 'x >= 2 * y + 1',
    step: ({ x, y }) => ({ x: x - (2 * y + 1), y: y + 1 }),
    code: 'while (x >= 2 * y + 1) {\n  x = x - (2 * y + 1);\n  y = y + 1;\n}',
    commands: 6,
    enemies: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 4, y: 2 }],
    allies: [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    starter: 'x >= 0 && y >= 0 && x + y * y <= 8',
    hints: [
      'x는 2 * y + 1만큼 감소하고 y는 1 증가한다. (y + 1) * (y + 1) = y * y + 2 * y + 1을 이용해 보존량을 구성하라.',
      'x + y * y는 초기 입력 2, 5, 8로 보존된다. 종료 시 남은 x가 다음 홀수 2 * y + 1보다 작으므로 y가 정수 제곱근이다.',
      '검증 해법: x >= 0 && y >= 0 && (x + y * y == 2 || x + y * y == 5 || x + y * y == 8)',
    ],
    en: {
      name: 'Integer Square Root',
      brief: 'Subtract successive odd numbers, 1, 3, 5, … to compute an integer square root and remainder. y tracks the root so far; x is the remainder. Target the results for inputs 2, 5, and 8.',
      hints: [
        'x decreases by 2 * y + 1 while y increases by 1. Use (y + 1) * (y + 1) = y * y + 2 * y + 1 to construct a conserved quantity.',
        'The quantity x + y * y preserves the input: 2, 5, or 8. At exit, x is smaller than the next odd number, 2 * y + 1, so y is the integer square root.',
        'Verified solution: x >= 0 && y >= 0 && (x + y * y == 2 || x + y * y == 5 || x + y * y == 8)',
      ],
    },
    solution: 'x >= 0 && y >= 0 && (x + y * y == 2 || x + y * y == 5 || x + y * y == 8)',
    goalSolution: '(x == 1 && y == 1) || (x == 1 && y == 2) || (x == 4 && y == 2)',
  },
  {
    id: '05',
    name: '좌표 표준화',
    subtitle: 'COORDINATE NORMALIZATION',
    brief: '모든 정수 쌍 (x, y)을 초기 입력으로 허용한다. x를 3으로 나눈 0 이상 나머지로 표준화하고 y를 0으로 복귀시켜라. 표시된 세 경로는 대표 예시일 뿐이다.',
    size: 9,
    initialCondition: 'true',
    traceInputs: [{ x: 6, y: 3 }, { x: -5, y: 2 }, { x: 2, y: -3 }],
    guardSource: 'x < 0 || x >= 3 || y != 0',
    step: ({ x, y }) => {
      if (x < 0) {
        x = x + 3;
      } else if (x >= 3) {
        x = x - 3;
      }
      if (y < 0) {
        y = y + 1;
      } else if (y > 0) {
        y = y - 1;
      }
      return { x, y };
    },
    code: 'while (x < 0 || x >= 3 || y != 0) {\n  if (x < 0) {\n    x = x + 3;\n  } else if (x >= 3) {\n    x = x - 3;\n  }\n  if (y < 0) {\n    y = y + 1;\n  } else if (y > 0) {\n    y = y - 1;\n  }\n}',
    commands: 6,
    enemies: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    allies: [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 0 }],
    starter: 'x >= 0 && y >= 0',
    hints: [
      'x가 음수이면 3을 더하고, 3 이상이면 3을 빼라. y는 매회 0에 한 칸 접근한다. 음수 x도 최종 나머지는 0, 1, 2 중 하나이다.',
      '초기 조건 P = true는 모든 정수 쌍을 허용한다. 초기 성립을 통과하려면 I도 모든 초기 상태에서 참이어야 한다. 대표 경로는 실행 예시일 뿐이다.',
      '검증 해법: true. 종료 조건 x >= 0 && x < 3 && y == 0이 세 적 좌표를 정확히 결정한다.',
    ],
    en: {
      name: 'Coordinate Normalization',
      brief: 'Accept any integer pair (x, y). Normalize x to its nonnegative remainder modulo 3 and return y to 0. The three displayed paths are representative samples.',
      hints: [
        'Add 3 when x is negative; subtract 3 when x is at least 3. Move y one step toward 0 per iteration. Even a negative initial x ends with a remainder of 0, 1, or 2.',
        'The initial condition P = true admits every integer pair. To pass the initial check, I must hold for every initial state. The representative paths are execution samples only.',
        'Verified solution: true. The exit condition x >= 0 && x < 3 && y == 0 identifies exactly the three enemy coordinates.',
      ],
    },
    solution: 'true',
    goalSolution: 'x >= 0 && x < 3 && y == 0',
  },
];

export const CHAPTERS = [
  { id: 1, name: '기초 사격', description: '변수의 범위와 합·차를 추적하라. 초기 성립과 유지의 기본을 확보한다.', en: { name: 'Basic Fire Control', description: 'Track bounds, sums, and differences. Establish initiation and preservation.' } },
  { id: 2, name: '분기와 입력', description: '분기마다 유지되는 조건을 확보하라. 부호·순서·입력 가정을 함께 다룬다.', en: { name: 'Branches & Inputs', description: 'Keep conditions valid across branches. Account for signs, ordering, and input assumptions.' } },
  { id: 3, name: '누적 계산', description: '처리한 양과 남은 계산을 연결하라. 나머지 관계에서 이차식까지 확장한다.', en: { name: 'Accumulation', description: 'Relate completed work to what remains. Advance from remainders to quadratic relations.' } },
  { id: 4, name: '비선형 관계', description: '곱·약수·기하 관계를 결합하라. 경계 조건을 함께 검증해야 목표가 보장된다.', en: { name: 'Nonlinear Relations', description: 'Combine products, divisibility, and geometry. Preserve the bounds needed to prove the objective.' } },
  { id: 5, name: '종합 검증', description: '탐색·최대공약수·점화식을 분석하라. 논리합과 변환되는 관계로 최종 목표를 증명한다.', en: { name: 'Combined Verification', description: 'Analyze search, GCD, and recurrences. Prove the objective using disjunctions and changing algebraic relations.' } },
];

const legacyConcepts = {
  '01': ['합 보존', 'Conservation of a sum'],
  '02': ['몫·나머지와 가중 합', 'Quotient, remainder, and a weighted sum'],
  '03': ['누적 합과 남은 삼각수', 'Accumulated sum and remaining triangle'],
  '04': ['제곱근과 잔여량', 'Square root and remainder'],
  '05': ['무제약 초기 조건 P = true', 'Unrestricted precondition P = true'],
};
const campaignOrder = [
  '06', '01', '07', '09',
  '11', '08', '12', '05',
  '10', '02', '03', '14',
  '04', '16', '13', '15',
  '17', '18', '19', '20',
];
const missions = new Map([...LEGACY_LEVELS, ...BASIC_LEVELS, ...ADVANCED_LEVELS].map(mission => [mission.id, mission]));
export const LEVELS = campaignOrder.map((id, index) => {
  const mission = missions.get(id);
  if (!mission) throw new Error(`Missing campaign mission: ${id}`);
  const legacyConcept = legacyConcepts[id];
  return withUnitBranches({ ...mission, chapter: Math.floor(index / 4) + 1,
    concept: legacyConcept?.[0] ?? mission.concept,
    en: { ...mission.en, concept: legacyConcept?.[1] ?? mission.en.concept } });
});
