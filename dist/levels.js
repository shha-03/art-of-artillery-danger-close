import { GENERAL_LEVELS } from './levels-general.js';
import { SPATIAL_LEVELS } from './levels-spatial.js';
import { withUnitBranches } from './unit-types.js';
import { computeRefinementRisks } from './refinement-risk.js';

export const CHAPTERS = [
  { id: 1, name: '입력과 보존량', description: '임의의 정수 입력을 상수로 기억하라. 합과 가중 합으로 처리한 양과 남은 양을 연결한다.', en: { name: 'Inputs & Conservation', description: 'Remember arbitrary integer inputs in fixed parameters. Relate completed and remaining work through sums and weighted sums.' } },
  { id: 2, name: '분기와 경계', description: '두 종료 원인과 부호 분기를 분석하라. 입력 순서에 따라 달라지는 관계를 보존한다.', en: { name: 'Branches & Bounds', description: 'Analyze alternative exits and sign branches. Preserve the relations that depend on input order.' } },
  { id: 3, name: '몫과 균형', description: '몫·나머지·올림과 순환을 계산하라. 부호 있는 두 입력의 평균까지 일반화한다.', en: { name: 'Division & Balance', description: 'Compute quotients, remainders, ceilings, and cycles. Extend the reasoning to the mean of signed inputs.' } },
  { id: 4, name: '누적합과 다항식', description: '유한 차분과 남은 합을 활용하라. 반복 누산을 일반적인 다항식 명세와 연결한다.', en: { name: 'Sums & Polynomials', description: 'Use finite differences and remaining sums. Connect iterative accumulation to general polynomial specifications.' } },
  { id: 5, name: '제곱과 탐색', description: '고차 보존량과 양쪽 경계를 결합하라. 같은 제곱근 문제를 차감·누적·이분 탐색으로 검증한다.', en: { name: 'Squares & Search', description: 'Combine higher-degree conservation with two-sided bounds. Verify square roots by subtraction, accumulation, and binary search.' } },
  { id: 6, name: '세 변수와 층별 전장', description: '세 상태 변수 사이의 보존 관계를 수립하라. z층마다 다른 전장을 확인하고 모든 층의 적을 격파한다.', en: { name: 'Three Variables & Layers', description: 'Establish relations among three state variables. Inspect the battlefield on each z layer and eliminate enemies across every layer.' } },
];

// g-prefixed IDs separate general-input missions from the retired fixed-input
// campaign. Old score records remain in storage without identifying these rounds.
export const LEVELS = [...GENERAL_LEVELS, ...SPATIAL_LEVELS].map(level => withUnitBranches(level, computeRefinementRisks(level)));
