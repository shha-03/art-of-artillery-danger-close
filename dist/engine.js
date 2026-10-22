import { verifyWithSMT, DEFAULT_TIMEOUT_MS } from './smt.js';

/**
 * Z3 Int verification has no coordinate bounds. Only the visible firing list
 * is enumerated on the board. Concrete arithmetic uses exact BigInt values.
 * Every proof obligation passes only on UNSAT; UNKNOWN is never a proof.
 */
export { DEFAULT_TIMEOUT_MS };
export const TRACE_LIMIT = 256;
const MAX_BOARD_SIZE = 64; // Display allocation only, never an SMT constraint.

const MAX_SOURCE_LENGTH = 4096;
const MAX_TOKENS = 1024;
const MAX_DEPTH = 128;

const ERROR_LABELS = {
  ko: { arithmetic: '산술 결과', literal: '숫자', invariant: '불변식', goal: '목표', guard: '반복 조건', 'transition-x': 'x 전이식', 'transition-y': 'y 전이식', 'transition-condition': '전이 분기 조건', x: 'x', y: 'y' },
  en: { arithmetic: 'Arithmetic result', literal: 'Number literal', invariant: 'Invariant', goal: 'Goal', guard: 'Loop guard', 'transition-x': 'x transition', 'transition-y': 'y transition', 'transition-condition': 'Transition condition', x: 'x', y: 'y' },
};
const errorLabel = (label, language) => Object.hasOwn(ERROR_LABELS[language], label)
  ? ERROR_LABELS[language][label] : String(label);

const ERROR_MESSAGES = {
  ko: {
    'integer-range': (p) => `${errorLabel(p.label, 'ko')}: 정확히 표현 가능한 정수 범위 위반.`,
    'invalid-integer': (p) => `${errorLabel(p.label, 'ko')}: 정수 입력 오류. 큰 수는 10진 문자열 또는 BigInt로 지정하라.`,
    'missing-expression': () => '수식 누락. 사격 조건을 입력하라.',
    'expression-too-long': () => '수식 길이 한도 초과. 조건을 축약하라.',
    'unsupported-character': (p) => `미지원 문자 '${p.character}' 확인. 지원 문법을 대조하라.`,
    'too-many-tokens': () => '수식 항목 한도 초과. 조건을 축약하라.',
    'operand-type': (p) => `'${p.token}'의 입력 형식 불일치. ${p.expected === 'integer' ? '정수' : '참/거짓'} 식을 사용하라.`,
    'comparison-type': () => '비교 대상의 형식 불일치. 같은 종류의 값끼리 비교하라.',
    'nesting-too-deep': () => '중첩 깊이 한도 초과. 괄호와 단항 연산자를 줄여라.',
    'missing-close-parenthesis': () => "닫는 괄호 ')' 누락. 수식을 보완하라.",
    'expected-operand': (p) => `'${p.token}' 위치에 x, y, 숫자 또는 괄호 식을 입력하라.`,
    'unexpected-token': (p) => `잘못 배치된 '${p.token}' 확인. 수식 구성을 점검하라.`,
    'invalid-ast': () => '수식 구조 오류.',
    'zero-remainder-divisor': () => '0으로 나누는 나머지 연산 불가. 제수를 확인하라.',
    'unsupported-ast': () => '미지원 수식 구조 확인.',
    'predicate-type': (p) => `${errorLabel(p.label, 'ko')}: 참/거짓을 나타내는 식을 입력하라.`,
    'invalid-initial': () => '초기 좌표 오류. x와 y에 정확한 정수를 지정하라.',
    'invalid-board-size': (p) => `전장 크기 오류. 허용 범위는 ${p.min}부터 ${p.max} 사이의 정수이다.`,
    'missing-step': () => '프로그램의 한 단계 실행 함수 누락.',
    'missing-coordinate': () => '프로그램 실행 결과에 좌표 누락.',
    'invalid-layout': () => '배치 형식 오류. 좌표 배열이 필요하다.',
    'offboard-unit': () => '배치 좌표 오류. 전장 안의 정수 좌표가 필요하다.',
    'duplicate-unit': () => '배치 중복. 한 좌표에 여러 유닛을 배치할 수 없다.',
    'invalid-command-budget': () => '명령 횟수 오류. 0 이상의 정수가 필요하다.',
    'invalid-mode': () => '사격 방식 오류. single 또는 salvo를 지정하라.',
    'missing-transition': () => '프로그램 전이 명세 누락. x와 y의 전이식을 지정하라.',
    'invalid-transition': (p) => `${errorLabel(p.label, 'ko')}: 전이 명세 오류. 정수 식 또는 조건 분기를 지정하라.`,
    'transition-type': (p) => `${errorLabel(p.label, 'ko')}: 정수 결과를 반환하는 식이 필요하다.`,
    'invalid-solver-options': () => '검증 설정 오류. 시간·자원 한도는 지원 범위의 양의 정수로 지정하라.',
    'unexpected-error': (p) => p.detail || '알 수 없는 실행 오류. 오류 내용을 확인하라.',
  },
  en: {
    'integer-range': (p) => `${errorLabel(p.label, 'en')}: exact integer range exceeded.`,
    'invalid-integer': (p) => `${errorLabel(p.label, 'en')}: integer input invalid. Supply large integers as decimal strings or BigInt.`,
    'missing-expression': () => 'Expression missing. Enter firing conditions.',
    'expression-too-long': () => 'Expression length limit exceeded. Shorten the conditions.',
    'unsupported-character': (p) => `Unsupported character '${p.character}'. Check the permitted syntax.`,
    'too-many-tokens': () => 'Expression token limit exceeded. Shorten the conditions.',
    'operand-type': (p) => `Input type mismatch at '${p.token}'. Use ${p.expected === 'integer' ? 'an integer' : 'a Boolean'} expression.`,
    'comparison-type': () => 'Comparison type mismatch. Compare values of the same type.',
    'nesting-too-deep': () => 'Nesting limit exceeded. Reduce parentheses and unary operators.',
    'missing-close-parenthesis': () => "Closing parenthesis ')' missing. Complete the expression.",
    'expected-operand': (p) => `Expected an operand at '${p.token}'. Enter x, y, a number, or a parenthesized expression.`,
    'unexpected-token': (p) => `Unexpected token '${p.token}'. Check the expression structure.`,
    'invalid-ast': () => 'Expression structure invalid.',
    'zero-remainder-divisor': () => 'Remainder divisor is zero. Set a nonzero divisor.',
    'unsupported-ast': () => 'Unsupported expression structure detected.',
    'predicate-type': (p) => `${errorLabel(p.label, 'en')}: enter a Boolean expression.`,
    'invalid-initial': () => 'Initial coordinates invalid. Supply exact integers for x and y.',
    'invalid-board-size': (p) => `Board size invalid. Use an integer from ${p.min} to ${p.max}.`,
    'missing-step': () => 'Program transition function missing.',
    'missing-coordinate': () => 'Program transition returned no coordinates.',
    'invalid-layout': () => 'Deployment format invalid. Supply an array of coordinates.',
    'offboard-unit': () => 'Deployment coordinates invalid. Use integer coordinates inside the board.',
    'duplicate-unit': () => 'Deployment conflict. Assign only one unit to each coordinate.',
    'invalid-command-budget': () => 'Command budget invalid. Use a nonnegative integer.',
    'invalid-mode': () => 'Fire mode invalid. Select single or salvo.',
    'missing-transition': () => 'Program transition specification missing. Define transitions for x and y.',
    'invalid-transition': (p) => `${errorLabel(p.label, 'en')}: transition specification invalid. Supply an integer expression or conditional branch.`,
    'transition-type': (p) => `${errorLabel(p.label, 'en')}: an integer result is required.`,
    'invalid-solver-options': () => 'Verification settings invalid. Supply supported positive integer time and resource limits.',
    'unexpected-error': (p) => p.detail || 'Unknown execution error. Inspect the error report.',
  },
};

/**
 * Format an engine Error or an analyze/order result from its stable metadata.
 * errorParams.position is zero-based; displayed positions are one-based.
 * Known labels are semantic keys, never Korean text. Unknown external errors
 * retain their original diagnostic rather than guessing a translation.
 */
export function formatEngineError(value, language = 'ko') {
  const locale = language === 'en' ? 'en' : 'ko';
  const code = value?.errorCode;
  const params = value?.errorParams ?? {};
  if (!Object.hasOwn(ERROR_MESSAGES[locale], code)) {
    return value?.error ?? value?.message ?? (value == null ? ERROR_MESSAGES[locale]['unexpected-error']({}) : String(value));
  }
  const message = ERROR_MESSAGES[locale][code](params);
  return `${message}${Number.isInteger(params.position) ? ` (${locale === 'en' ? 'position' : '위치'} ${params.position + 1})` : ''}`;
}

function engineError(code, params = {}, ErrorType = Error) {
  const metadata = { errorCode: code, errorParams: { ...params } };
  return Object.assign(new ErrorType(formatEngineError(metadata)), metadata);
}

function errorDetails(value) {
  const message = value instanceof Error ? value.message : String(value);
  return {
    error: message,
    errorCode: value?.errorCode ?? 'unexpected-error',
    errorParams: value?.errorParams ? { ...value.errorParams } : { detail: message },
  };
}

function expressionError(code, params = {}, position) {
  return engineError(code, { ...params, ...(position === undefined ? {} : { position }) }, SyntaxError);
}

function integer(value, label = 'arithmetic') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw engineError('invalid-integer', { label }, TypeError);
}

function tokenize(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw expressionError('missing-expression');
  }
  if (source.length > MAX_SOURCE_LENGTH) throw expressionError('expression-too-long', { limit: MAX_SOURCE_LENGTH });
  const tokens = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { position += whitespace[0].length; continue; }
    const match = /^(?:\d+|[A-Za-z_][A-Za-z_0-9]*|&&|\|\||==|!=|<=|>=|[+*%<>()!\-])/.exec(rest);
    if (!match) throw expressionError('unsupported-character', { character: source[position] }, position);
    tokens.push({ value: match[0], position });
    position += match[0].length;
    if (tokens.length > MAX_TOKENS) throw expressionError('too-many-tokens', { limit: MAX_TOKENS });
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
      throw expressionError('operand-type', { token: token.value, expected }, token.position);
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
        throw expressionError('comparison-type', {}, token.position);
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
    if (++depth > MAX_DEPTH) throw expressionError('nesting-too-deep', { limit: MAX_DEPTH }, peek().position);
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
        if (peek().value !== ')') throw expressionError('missing-close-parenthesis', {}, peek().position);
        take();
        return node;
      }
      if (/^\d+$/.test(token.value)) {
        return { kind: 'literal', value: BigInt(token.value), valueType: 'integer' };
      }
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'literal', value: token.value === 'true', valueType: 'boolean' };
      }
      if (token.value === 'x' || token.value === 'y') {
        return { kind: 'variable', name: token.value, valueType: 'integer' };
      }
      throw expressionError('expected-operand', { token: token.value }, token.position);
    } finally { depth--; }
  }
  const ast = parseOr();
  if (peek().value !== '<end>') throw expressionError('unexpected-token', { token: peek().value }, peek().position);
  return ast;
}

/**
 * Evaluate without eval/Function or JavaScript coercion. Integer arithmetic is
 * exact and unbounded. Numeric results are BigInt. `%` is remainder
 * with the dividend's sign. Boolean &&/|| short-circuit, including zero guards.
 */
export function evaluate(ast, state) {
  function visit(node) {
    if (!node || typeof node !== 'object') throw engineError('invalid-ast', {}, TypeError);
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'variable') return integer(state?.[node.name], node.name);
    if (node.kind === 'conditional') return visit(visit(node.condition) ? node.then : node.else);
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
          if (right === 0n) throw engineError('zero-remainder-divisor', {}, RangeError);
          return integer(left % right);
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    throw engineError('unsupported-ast', {}, TypeError);
  }
  return visit(ast);
}

const point = ({ x, y }) => ({ x, y });
const key = ({ x, y }) => `${x},${y}`;
const onBoard = (s, size) => s.x >= 0 && s.y >= 0 && s.x < size && s.y < size;
const exactPoint = (s) => ({ x: integer(s?.x, 'x'), y: integer(s?.y, 'y') });
const serializedPoint = (s) => ({ x: s.x.toString(), y: s.y.toString() });

function predicate(source, label) {
  const ast = parseExpression(source);
  if (ast.valueType !== 'boolean') throw expressionError('predicate-type', { label });
  return ast;
}

function parseTransition(spec, label, depth = 0) {
  if (typeof spec === 'string') {
    const ast = parseExpression(spec);
    if (ast.valueType !== 'integer') throw engineError('transition-type', { label }, TypeError);
    return ast;
  }
  if (!spec || typeof spec !== 'object' || depth > MAX_DEPTH
    || typeof spec.condition !== 'string' || spec.then === undefined || spec.else === undefined) {
    throw engineError('invalid-transition', { label }, TypeError);
  }
  return {
    kind: 'conditional', valueType: 'integer',
    condition: predicate(spec.condition, 'transition-condition'),
    then: parseTransition(spec.then, label, depth + 1),
    else: parseTransition(spec.else, label, depth + 1),
  };
}

function transitionFor(level) {
  if (!level?.transition || level.transition.x === undefined || level.transition.y === undefined) {
    throw engineError('missing-transition', {}, TypeError);
  }
  return {
    x: parseTransition(level.transition.x, 'transition-x'),
    y: parseTransition(level.transition.y, 'transition-y'),
  };
}

function compileLevel(level) {
  let initial;
  try { initial = exactPoint(level?.initial); }
  catch { throw engineError('invalid-initial', {}, TypeError); }
  if (!Number.isSafeInteger(level.size) || level.size < 1 || level.size > MAX_BOARD_SIZE) {
    throw engineError('invalid-board-size', { min: 1, max: MAX_BOARD_SIZE }, TypeError);
  }
  return { initial, guard: predicate(level.guardSource, 'guard'), transition: transitionFor(level) };
}

function transitionValue(transition, state) {
  // Both right-hand sides read the same old state. Never call level.step.
  return { x: evaluate(transition.x, state), y: evaluate(transition.y, state) };
}

/** Exact, simultaneous transition execution. Returns {x: BigInt, y: BigInt}. */
export function executeTransition(level, state) {
  return transitionValue(transitionFor(level), exactPoint(state));
}

function traceProgram(program) {
  const trace = [serializedPoint(program.initial)];
  const visited = new Set();
  let current = program.initial;
  try {
    for (let step = 0; step < TRACE_LIMIT; step++) {
      if (!evaluate(program.guard, current)) return { trace, traceStatus: 'terminated' };
      if (visited.has(key(current))) return { trace, traceStatus: 'cycle' };
      visited.add(key(current));
      current = transitionValue(program.transition, current);
      const displayed = serializedPoint(current);
      // A visualization-only budget prevents explosive traces from allocating
      // enormous strings. This condition never enters any proof obligation.
      if (displayed.x.length > 4096 || displayed.y.length > 4096) {
        return { trace, traceStatus: 'limited', traceReason: 'display-size' };
      }
      trace.push(displayed);
    }
    return { trace, traceStatus: 'limited', traceReason: 'step-limit' };
  } catch (error) {
    return { trace, traceStatus: 'undefined', traceError: errorDetails(error) };
  }
}

function solverOptions(options) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!options || typeof options !== 'object'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647
    || (options.rlimit !== undefined && (!Number.isSafeInteger(options.rlimit) || options.rlimit < 1 || options.rlimit > 4294967295))
    || (options.solverFactory !== undefined && typeof options.solverFactory !== 'function')) {
    throw engineError('invalid-solver-options', {}, TypeError);
  }
  return { ...options, timeoutMs };
}

function boardCandidates(invariant, guard, size) {
  const candidates = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) {
    try {
      if (evaluate(invariant, { x, y }) && !evaluate(guard, { x, y })) candidates.push({ x, y });
    } catch (error) {
      // Undefined cells are not firing candidates. The SMT definedness queries
      // independently report them and prevent firing; this is no proof filter.
      if (error?.errorCode !== 'zero-remainder-divisor') throw error;
    }
  }
  return candidates;
}

const pendingCheck = (reason = 'not-run') => ({ pass: null, status: 'unknown', reason });

/**
 * Prove initialization, preservation and the exit goal over unbounded Int.
 * SAT witnesses are exact decimal strings, including off-board/unreachable
 * states. The actual trace and board enumeration are visualizations only.
 * options: timeoutMs (default 2000 per obligation), optional rlimit, and an
 * optional solverFactory(ctx, phase) for deterministic fault-injection tests.
 */
export async function analyze(source, goalSource, level, options = {}) {
  const result = {
    valid: false,
    initial: pendingCheck(),
    preservation: pendingCheck(),
    goal: pendingCheck(),
    candidates: [],
    trace: [],
    verification: 'z3-int',
  };
  try {
    const program = compileLevel(level);
    const settings = solverOptions(options);
    const invariant = predicate(source, 'invariant');
    const goal = predicate(goalSource, 'goal');
    Object.assign(result, traceProgram(program));
    result.candidates = boardCandidates(invariant, program.guard, level.size);
    Object.assign(result, await verifyWithSMT(program, invariant, goal, settings));
    result.valid = result.initial.pass === true && result.preservation.pass === true;
  } catch (error) {
    result.valid = false;
    result.initial = pendingCheck('error');
    result.preservation = pendingCheck('error');
    result.goal = pendingCheck('error');
    Object.assign(result, errorDetails(error));
  }
  result.inconclusive = [result.initial, result.preservation, result.goal].some((check) => check.pass === null);
  return result;
}

function copyUnits(units, size, occupied) {
  if (!Array.isArray(units)) throw engineError('invalid-layout', {}, TypeError);
  return units.map((unit) => {
    let exact;
    try { exact = exactPoint(unit); }
    catch { throw engineError('offboard-unit', {}, TypeError); }
    if (!onBoard(exact, size)) throw engineError('offboard-unit', {}, TypeError);
    const cell = { x: Number(exact.x), y: Number(exact.y) };
    const location = key(cell);
    if (occupied.has(location)) throw engineError('duplicate-unit', {}, TypeError);
    occupied.add(location);
    return cell;
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
  const program = compileLevel(level);
  const budget = level.commands ?? level.budget ?? 6;
  if (!Number.isSafeInteger(budget) || budget < 0) throw engineError('invalid-command-budget', {}, TypeError);
  const occupied = new Set();
  const enemies = copyUnits(level.enemies ?? [], level.size, occupied);
  const allies = copyUnits(level.allies ?? [], level.size, occupied);
  return updateBattleStatus({
    level: { ...level, initial: serializedPoint(program.initial), enemies: enemies.map(point), allies: allies.map(point) },
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
 * including a disproved invariant and a full salvo. Input/solver/undefined
 * errors cost nothing. ANY inconclusive check, including the goal, blocks fire
 * without cost even if a different check has a logical counterexample. Once
 * all checks are conclusive, a failed init/preservation costs one command.
 * A SAT goal failure does
 * not prevent firing. Historical hits are only removed from
 * the firing list; they are never removed from the proof region S.
 */
export async function order(battle, invariantSource, goalSource, mode = 'single', options = {}) {
  const outcome = (fields) => ({ battle, analysis: null, shots: [], dud: false, cost: 0, ...fields });
  if (mode !== 'single' && mode !== 'salvo') {
    return outcome({ ...errorDetails(engineError('invalid-mode', { mode })), reason: 'invalid-mode' });
  }
  if (battle.finished) return outcome({ reason: 'finished' });
  const analysis = await analyze(invariantSource, goalSource, battle.level, options);
  if (analysis.error) return outcome({
    analysis,
    error: analysis.error,
    errorCode: analysis.errorCode,
    errorParams: { ...analysis.errorParams },
    reason: 'syntax-error',
  });
  const checks = [analysis.initial, analysis.preservation, analysis.goal];
  if (checks.some((check) => check.pass === null)) {
    return outcome({ analysis, reason: 'inconclusive' });
  }
  const next = {
    ...battle,
    enemies: battle.enemies.map(point),
    allies: battle.allies.map(point),
    hit: battle.hit.map((hit) => ({ ...hit })),
  };
  if (analysis.initial.pass === false || analysis.preservation.pass === false) {
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
