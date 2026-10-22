/**
 * Danger Close: a dependency-free, finite-state invariant checker.
 *
 * The mathematical state space is exactly {-32,...,32}². We enumerate every
 * state, including states outside the visible board and unreachable states.
 * A successor outside that space FAILS preservation; it is never clipped.
 * `valid` means initial + preservation, independently of the goal check.
 * All three checks run independently, even when the initial check fails.
 */
export const DOMAIN = Object.freeze({ min: -32, max: 32, stateCount: 4225 });

const MAX_SOURCE_LENGTH = 4096;
const MAX_TOKENS = 1024;
const MAX_DEPTH = 128;

function expressionError(message, position) {
  return new SyntaxError(`${message}${position === undefined ? '' : ` (위치 ${position + 1})`}`);
}

function integer(value, description = '산술 결과') {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${description}: 정확히 표현 가능한 정수 범위 위반.`);
  }
  return value;
}

function tokenize(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw expressionError('수식 누락. 사격 조건을 입력하라.');
  }
  if (source.length > MAX_SOURCE_LENGTH) throw expressionError('수식 길이 한도 초과. 조건을 축약하라.');
  const tokens = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { position += whitespace[0].length; continue; }
    const match = /^(?:\d+|[A-Za-z_][A-Za-z_0-9]*|&&|\|\||==|!=|<=|>=|[+*%<>()!\-])/.exec(rest);
    if (!match) throw expressionError(`미지원 문자 '${source[position]}' 확인. 지원 문법을 대조하라.`, position);
    tokens.push({ value: match[0], position });
    position += match[0].length;
    if (tokens.length > MAX_TOKENS) throw expressionError('수식 항목 한도 초과. 조건을 축약하라.');
  }
  tokens.push({ value: '<end>', position: source.length });
  return tokens;
}

/** Parse and statically type-check a numeric or Boolean expression. Throws. */
export function parseExpression(source) {
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const needType = (node, expected, token) => {
    if (node.valueType !== expected) {
      throw expressionError(`'${token.value}'의 입력 형식 불일치. ${expected === 'integer' ? '정수' : '참/거짓'} 식을 사용하라.`, token.position);
    }
  };
  function binary(left, token, right) {
    const op = token.value;
    let valueType;
    if (op === '&&' || op === '||') {
      needType(left, 'boolean', token);
      needType(right, 'boolean', token);
      valueType = 'boolean';
    } else if (op === '==' || op === '!=') {
      if (left.valueType !== right.valueType) {
        throw expressionError('비교 대상의 형식 불일치. 같은 종류의 값끼리 비교하라.', token.position);
      }
      valueType = 'boolean';
    } else {
      needType(left, 'integer', token);
      needType(right, 'integer', token);
      valueType = ['+', '-', '*', '%'].includes(op) ? 'integer' : 'boolean';
    }
    return { kind: 'binary', op, left, right, valueType };
  }
  function chain(next, operators) {
    let node = next();
    while (operators.includes(peek().value)) {
      const op = take();
      node = binary(node, op, next());
    }
    return node;
  }
  const parseOr = () => chain(parseAnd, ['||']);
  const parseAnd = () => chain(parseEquality, ['&&']);
  const parseEquality = () => chain(parseComparison, ['==', '!=']);
  const parseComparison = () => chain(parseAdd, ['<', '<=', '>', '>=']);
  const parseAdd = () => chain(parseMultiply, ['+', '-']);
  const parseMultiply = () => chain(parseUnary, ['*', '%']);
  function parseUnary() {
    if (++depth > MAX_DEPTH) throw expressionError('중첩 깊이 한도 초과. 괄호와 단항 연산자를 줄여라.', peek().position);
    try {
      if (['!', '-', '+'].includes(peek().value)) {
        const token = take();
        const argument = parseUnary();
        const valueType = token.value === '!' ? 'boolean' : 'integer';
        needType(argument, valueType, token);
        return { kind: 'unary', op: token.value, argument, valueType };
      }
      const token = take();
      if (token.value === '(') {
        const node = parseOr();
        if (peek().value !== ')') throw expressionError("닫는 괄호 ')' 누락. 수식을 보완하라.", peek().position);
        take();
        return node;
      }
      if (/^\d+$/.test(token.value)) {
        return { kind: 'literal', value: integer(Number(token.value), '숫자'), valueType: 'integer' };
      }
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'literal', value: token.value === 'true', valueType: 'boolean' };
      }
      if (token.value === 'x' || token.value === 'y') {
        return { kind: 'variable', name: token.value, valueType: 'integer' };
      }
      throw expressionError(`'${token.value}' 위치에 x, y, 숫자 또는 괄호 식을 입력하라.`, token.position);
    } finally { depth--; }
  }
  const ast = parseOr();
  if (peek().value !== '<end>') throw expressionError(`잘못 배치된 '${peek().value}' 확인. 수식 구성을 점검하라.`, peek().position);
  return ast;
}

/**
 * Evaluate without eval/Function or JavaScript coercion. Integer arithmetic is
 * exact within the safe-integer range; overflow is rejected. `%` is remainder
 * with the dividend's sign. Boolean &&/|| short-circuit, including zero guards.
 */
export function evaluate(ast, state) {
  function visit(node) {
    if (!node || typeof node !== 'object') throw new TypeError('수식 구조 오류.');
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'variable') return integer(state[node.name], node.name);
    if (node.kind === 'unary') {
      const value = visit(node.argument);
      if (node.op === '!') return !value;
      if (node.op === '-') return integer(-value);
      if (node.op === '+') return integer(value);
    }
    if (node.kind === 'binary') {
      const left = visit(node.left);
      if (node.op === '&&') return left && visit(node.right);
      if (node.op === '||') return left || visit(node.right);
      const right = visit(node.right);
      switch (node.op) {
        case '+': return integer(left + right);
        case '-': return integer(left - right);
        case '*': return integer(left * right);
        case '%':
          if (right === 0) throw new RangeError('0으로 나누는 나머지 연산 불가. 제수를 확인하라.');
          return integer(left % right);
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    throw new TypeError('미지원 수식 구조 확인.');
  }
  return visit(ast);
}

const point = ({ x, y }) => ({ x, y });
const key = ({ x, y }) => `${x},${y}`;
const inDomain = (s) => s && Number.isInteger(s.x) && Number.isInteger(s.y)
  && s.x >= DOMAIN.min && s.x <= DOMAIN.max && s.y >= DOMAIN.min && s.y <= DOMAIN.max;
const onBoard = (s, size) => s.x >= 0 && s.y >= 0 && s.x < size && s.y < size;

function predicate(source, label) {
  const ast = parseExpression(source);
  if (ast.valueType !== 'boolean') throw expressionError(`${label}: 참/거짓을 나타내는 식을 입력하라.`);
  return ast;
}

function validateLevel(level) {
  if (!level || !inDomain(level.initial)) throw new TypeError('초기 좌표 오류. 허용 범위는 -32부터 32 사이의 정수이다.');
  if (!Number.isInteger(level.size) || level.size < 1 || level.size > DOMAIN.max + 1) {
    throw new TypeError('전장 크기 오류. 허용 범위는 1부터 33 사이의 정수이다.');
  }
  if (typeof level.step !== 'function') throw new TypeError('프로그램의 한 단계 실행 함수 누락.');
}

function successor(level, before) {
  const after = level.step(point(before));
  if (!after || typeof after !== 'object') throw new TypeError('프로그램 실행 결과에 좌표 누락.');
  return point(after);
}

function traceProgram(level, guard) {
  const trace = [point(level.initial)];
  const visited = new Set();
  let current = point(level.initial);
  while (true) {
    if (!inDomain(current)) return { trace, traceStatus: 'outside-domain' };
    if (!evaluate(guard, current)) return { trace, traceStatus: 'terminated' };
    if (visited.has(key(current))) return { trace, traceStatus: 'cycle' };
    visited.add(key(current));
    current = successor(level, current);
    trace.push(point(current));
  }
}

/**
 * S = I && !guard is checked over the WHOLE domain. Only candidates are
 * projected onto the visible board. A goal witness may therefore be off-board.
 * A preservation witness may be unreachable from the fixed initial state.
 * trace is one actual execution; it is a visualization, never proof evidence.
 */
export function analyze(source, goalSource, level) {
  const result = {
    valid: false,
    initial: { pass: null },
    preservation: { pass: null },
    goal: { pass: null },
    candidates: [],
    trace: [],
    exitStateCount: 0,
    checkedStateCount: 0,
  };
  try {
    validateLevel(level);
    const invariant = predicate(source, '불변식');
    const goal = predicate(goalSource, '목표');
    const guard = predicate(level.guardSource, '반복 조건');
    Object.assign(result, traceProgram(level, guard));
    result.initial = evaluate(invariant, level.initial)
      ? { pass: true } : { pass: false, before: point(level.initial) };
    result.preservation = { pass: true };
    result.goal = { pass: true };
    for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
      for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
        const before = { x, y };
        result.checkedStateCount++;
        if (!evaluate(invariant, before)) continue;
        if (evaluate(guard, before)) {
          const after = successor(level, before);
          const outsideDomain = !inDomain(after);
          if (outsideDomain || !evaluate(invariant, after)) {
            if (result.preservation.pass) {
              result.preservation = { pass: false, before, after, outsideDomain };
            }
          }
        } else {
          result.exitStateCount++;
          if (onBoard(before, level.size)) result.candidates.push(before);
          if (!evaluate(goal, before) && result.goal.pass) result.goal = { pass: false, before };
        }
      }
    }
    result.valid = result.initial.pass && result.preservation.pass;
  } catch (error) {
    result.valid = false;
    // An interrupted enumeration is not a completed proof. Invalidate every
    // check so consumers cannot mistake optimistic/partial flags for success.
    result.initial = { pass: null };
    result.preservation = { pass: null };
    result.goal = { pass: null };
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function copyUnits(units, size, occupied) {
  if (!Array.isArray(units)) throw new TypeError('배치 형식 오류. 좌표 배열이 필요하다.');
  return units.map((unit) => {
    if (!inDomain(unit) || !onBoard(unit, size)) throw new TypeError('배치 좌표 오류. 전장 안의 정수 좌표가 필요하다.');
    const location = key(unit);
    if (occupied.has(location)) throw new TypeError('배치 중복. 한 좌표에 여러 유닛을 배치할 수 없다.');
    occupied.add(location);
    return point(unit);
  });
}

function updateBattleStatus(battle) {
  battle.cleared = battle.enemies.length === 0;
  battle.finished = battle.cleared || battle.remaining === 0;
  battle.score = battle.enemyKills - battle.friendlyKills + battle.remaining;
  return battle;
}

/** Initial arrays are preserved in battle.level; battle.enemies/allies are alive. */
export function createBattle(level) {
  validateLevel(level);
  predicate(level.guardSource, '반복 조건');
  const budget = level.commands ?? level.budget ?? 6;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new TypeError('명령 횟수 오류. 0 이상의 정수가 필요하다.');
  const occupied = new Set();
  const enemies = copyUnits(level.enemies ?? [], level.size, occupied);
  const allies = copyUnits(level.allies ?? [], level.size, occupied);
  return updateBattleStatus({
    level: { ...level, initial: point(level.initial), enemies: enemies.map(point), allies: allies.map(point) },
    budget,
    remaining: budget,
    enemies,
    allies,
    hit: [],
    enemyKills: 0,
    friendlyKills: 0,
  });
}

/**
 * Return a new battle, never mutate the argument. An order costs ONE command,
 * including a failed invariant and a full salvo. Syntax/type/arithmetic errors
 * and an empty unhit candidate set cost nothing. Initial/preservation failure
 * is checked BEFORE empty candidates and therefore always costs one command.
 * Goal failure never prevents firing. Historical hits are only removed from
 * the firing list; they are never removed from the proof region S.
 */
export function order(battle, invariantSource, goalSource, mode = 'single') {
  const outcome = (fields) => ({ battle, analysis: null, shots: [], dud: false, cost: 0, ...fields });
  if (mode !== 'single' && mode !== 'salvo') {
    return outcome({ error: '사격 방식 오류. single 또는 salvo를 지정하라.', reason: 'invalid-mode' });
  }
  if (battle.finished) return outcome({ reason: 'finished' });
  const analysis = analyze(invariantSource, goalSource, battle.level);
  if (analysis.error) return outcome({ analysis, error: analysis.error, reason: 'syntax-error' });
  const next = {
    ...battle,
    enemies: battle.enemies.map(point),
    allies: battle.allies.map(point),
    hit: battle.hit.map((hit) => ({ ...hit })),
  };
  if (!analysis.valid) {
    next.remaining--;
    return outcome({ battle: updateBattleStatus(next), analysis, dud: true, cost: 1, reason: 'invalid-invariant' });
  }
  const hit = new Set(battle.hit.map(key));
  const enemies = new Set(battle.enemies.map(key));
  const allies = new Set(battle.allies.map(key));
  const classify = (cell) => enemies.has(key(cell)) ? 'enemy' : allies.has(key(cell)) ? 'friendly' : 'neutral';
  const priority = { neutral: 0, friendly: 1, enemy: 2 };
  const candidates = analysis.candidates.filter((cell) => !hit.has(key(cell)))
    .map((cell) => ({ ...cell, type: classify(cell) }))
    .sort((a, b) => priority[a.type] - priority[b.type] || a.x - b.x || a.y - b.y);
  if (!candidates.length) return outcome({ analysis, reason: 'no-candidates' });
  const shots = mode === 'single' ? candidates.slice(0, 1) : candidates;
  const shotKeys = new Set(shots.map(key));
  next.remaining--;
  next.enemyKills += shots.filter((shot) => shot.type === 'enemy').length;
  next.friendlyKills += shots.filter((shot) => shot.type === 'friendly').length;
  next.enemies = next.enemies.filter((unit) => !shotKeys.has(key(unit)));
  next.allies = next.allies.filter((unit) => !shotKeys.has(key(unit)));
  next.hit.push(...shots.map((shot) => ({ ...shot })));
  return outcome({ battle: updateBattleStatus(next), analysis, shots, cost: 1, reason: 'fired' });
}
