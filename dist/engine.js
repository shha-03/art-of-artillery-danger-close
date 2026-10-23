import { UNIT_TYPES, unitPoints } from './unit-types.js';

/**
 * Danger Close: a dependency-free, finite-state invariant checker.
 *
 * The verification window is {-32,...,32}². We enumerate every state in that
 * window, including states outside the visible board and unreachable states.
 * Initialized programs accept arbitrary mathematical integer inputs, while
 * this checker explicitly tests a,b in {-4,...,4}². This is not an unbounded proof.
 * A successor outside that space FAILS preservation; it is never clipped.
 * `valid` means initial + preservation, independently of the goal check.
 * analyze runs all checks independently. Orders check them in sequence and
 * stop on initial/preservation failure or an error. False exit guarantees are
 * warnings: they do not remove candidates or prevent an otherwise valid shot.
 */
export const DOMAIN = Object.freeze({ min: -32, max: 32, stateCount: 4225 });
export const INPUT_DOMAIN = Object.freeze({ min: -4, max: 4, stateCount: 81 });
const PARAMETERS = Object.freeze(['a', 'b', 'n', 'm']);

const MAX_SOURCE_LENGTH = 4096;
const MAX_TOKENS = 1024;
const MAX_DEPTH = 128;

const ERROR_LABELS = {
  ko: { arithmetic: '산술 결과', literal: '숫자', invariant: '불변식', goal: '목표', guard: '반복 조건', initialCondition: '초기 사전조건', x: 'x', y: 'y' },
  en: { arithmetic: 'Arithmetic result', literal: 'Number literal', invariant: 'Invariant', goal: 'Goal', guard: 'Loop guard', initialCondition: 'Initial precondition', x: 'x', y: 'y' },
};
const errorLabel = (label, language) => Object.hasOwn(ERROR_LABELS[language], label)
  ? ERROR_LABELS[language][label] : String(label);

const ERROR_MESSAGES = {
  ko: {
    'integer-range': (p) => `${errorLabel(p.label, 'ko')}: 정확히 표현 가능한 정수 범위 위반.`,
    'missing-expression': () => '수식 누락. 사격 조건을 입력하라.',
    'expression-too-long': () => '수식 길이 한도 초과. 조건을 축약하라.',
    'unsupported-character': (p) => `미지원 문자 '${p.character}' 확인. 지원 문법을 대조하라.`,
    'too-many-tokens': () => '수식 항목 한도 초과. 조건을 축약하라.',
    'operand-type': (p) => `'${p.token}'의 입력 형식 불일치. ${p.expected === 'integer' ? '정수' : '참/거짓'} 식을 사용하라.`,
    'comparison-type': () => '비교 대상의 형식 불일치. 같은 종류의 값끼리 비교하라.',
    'nesting-too-deep': () => '중첩 깊이 한도 초과. 괄호와 단항 연산자를 줄여라.',
    'missing-close-parenthesis': () => "닫는 괄호 ')' 누락. 수식을 보완하라.",
    'expected-operand': (p) => `'${p.token}' 위치에 x, y, a, b, n, m, 숫자 또는 괄호 식을 입력하라.`,
    'unexpected-token': (p) => `잘못 배치된 '${p.token}' 확인. 수식 구성을 점검하라.`,
    'invalid-ast': () => '수식 구조 오류.',
    'zero-remainder-divisor': () => '0으로 나누는 나머지 연산 불가. 제수를 확인하라.',
    'unsupported-ast': () => '미지원 수식 구조 확인.',
    'predicate-type': (p) => `${errorLabel(p.label, 'ko')}: 참/거짓을 나타내는 식을 입력하라.`,
    'invalid-initial': (p) => `초기 좌표 오류. 허용 범위는 ${p.min}부터 ${p.max} 사이의 정수이다.`,
    'invalid-initial-states': () => '초기 입력 형식 오류. 하나 이상의 좌표를 배열로 지정하라.',
    'invalid-initializer': () => '초기화 함수 누락. 외부 입력 a, b를 초기 상태와 상수로 변환하라.',
    'invalid-initialization': () => '초기화 결과 오류. 검증 범위 안의 x, y와 안전한 정수 상수 n, m을 반환하라.',
    'ambiguous-initialization': () => '초기화 프로그램에는 initialStates나 initialCondition을 함께 지정할 수 없다.',
    'invalid-battle-inputs': () => '대표 전장 입력 오류. 서로 다른 외부 입력 a, b 세 쌍을 지정하라.',
    'invalid-battle-input': (p) => `대표 전장 입력은 검증창 ${p.min}부터 ${p.max} 안의 정수 a, b를 사용하라.`,
    'duplicate-battle-input': (p) => `대표 전장 입력 (${p.a}, ${p.b}) 중복 확인.`,
    'duplicate-initial-state': (p) => `초기 입력 중복. 좌표 (${p.x}, ${p.y})는 한 번만 지정하라.`,
    'ambiguous-initial-inputs': () => '초기 입력 지정 충돌. initialCondition과 initialStates 중 하나만 지정하라.',
    'empty-initial-condition': () => '초기 사전조건을 만족하는 좌표 없음. 검증 범위 안에 허용 입력을 지정하라.',
    'invalid-trace-inputs': () => '대표 실행 입력 형식 오류. 하나 이상의 좌표를 배열로 지정하라.',
    'invalid-trace-input': (p) => `대표 실행 좌표 오류. 허용 범위는 ${p.min}부터 ${p.max} 사이의 정수이다.`,
    'duplicate-trace-input': (p) => `대표 실행 입력 중복. 좌표 (${p.x}, ${p.y})는 한 번만 지정하라.`,
    'trace-input-excluded': (p) => `대표 실행 입력 (${p.x}, ${p.y})은 초기 사전조건을 위반한다. 허용 좌표를 지정하라.`,
    'invalid-board-size': (p) => `전장 크기 오류. 허용 범위는 ${p.min}부터 ${p.max} 사이의 정수이다.`,
    'missing-step': () => '프로그램의 한 단계 실행 함수 누락.',
    'missing-coordinate': () => '프로그램 실행 결과에 좌표 누락.',
    'invalid-layout': () => '배치 형식 오류. 좌표 배열이 필요하다.',
    'offboard-unit': () => '배치 좌표 오류. 전장 안의 정수 좌표가 필요하다.',
    'duplicate-unit': () => '배치 중복. 한 좌표에 여러 유닛을 배치할 수 없다.',
    'invalid-unit-branch': (p) => `미지원 병과 '${p.branch}' 확인. 등록된 병과를 지정하라.`,
    'invalid-command-budget': () => '명령 횟수 오류. 0 이상의 정수가 필요하다.',
    'invalid-mode': () => '사격 방식 오류. single 또는 salvo를 지정하라.',
    'unexpected-error': (p) => p.detail || '알 수 없는 실행 오류. 오류 내용을 확인하라.',
  },
  en: {
    'integer-range': (p) => `${errorLabel(p.label, 'en')}: exact integer range exceeded.`,
    'missing-expression': () => 'Expression missing. Enter firing conditions.',
    'expression-too-long': () => 'Expression length limit exceeded. Shorten the conditions.',
    'unsupported-character': (p) => `Unsupported character '${p.character}'. Check the permitted syntax.`,
    'too-many-tokens': () => 'Expression token limit exceeded. Shorten the conditions.',
    'operand-type': (p) => `Input type mismatch at '${p.token}'. Use ${p.expected === 'integer' ? 'an integer' : 'a Boolean'} expression.`,
    'comparison-type': () => 'Comparison type mismatch. Compare values of the same type.',
    'nesting-too-deep': () => 'Nesting limit exceeded. Reduce parentheses and unary operators.',
    'missing-close-parenthesis': () => "Closing parenthesis ')' missing. Complete the expression.",
    'expected-operand': (p) => `Expected an operand at '${p.token}'. Enter x, y, a, b, n, m, a number, or a parenthesized expression.`,
    'unexpected-token': (p) => `Unexpected token '${p.token}'. Check the expression structure.`,
    'invalid-ast': () => 'Expression structure invalid.',
    'zero-remainder-divisor': () => 'Remainder divisor is zero. Set a nonzero divisor.',
    'unsupported-ast': () => 'Unsupported expression structure detected.',
    'predicate-type': (p) => `${errorLabel(p.label, 'en')}: enter a Boolean expression.`,
    'invalid-initial': (p) => `Initial coordinates invalid. Use integers from ${p.min} to ${p.max}.`,
    'invalid-initial-states': () => 'Initial input format invalid. Supply a nonempty array of coordinates.',
    'invalid-initializer': () => 'Initialization function missing. Convert external inputs a and b into a state and constants.',
    'invalid-initialization': () => 'Initialization invalid. Return x and y within the state window and safe integer constants n and m.',
    'ambiguous-initialization': () => 'An initialized program cannot also specify initialStates or initialCondition.',
    'invalid-battle-inputs': () => 'Battle samples invalid. Supply exactly three distinct external input pairs a and b.',
    'invalid-battle-input': (p) => `Battle samples must use integer a and b within the test window ${p.min} to ${p.max}.`,
    'duplicate-battle-input': (p) => `Duplicate battle input (${p.a}, ${p.b}).`,
    'duplicate-initial-state': (p) => `Duplicate initial input. Assign coordinates (${p.x}, ${p.y}) only once.`,
    'ambiguous-initial-inputs': () => 'Initial input definitions conflict. Specify either initialCondition or initialStates.',
    'empty-initial-condition': () => 'No coordinates satisfy the initial precondition. Permit at least one input within the verification domain.',
    'invalid-trace-inputs': () => 'Trace input format invalid. Supply a nonempty array of coordinates.',
    'invalid-trace-input': (p) => `Trace coordinates invalid. Use integers from ${p.min} to ${p.max}.`,
    'duplicate-trace-input': (p) => `Duplicate trace input. Assign coordinates (${p.x}, ${p.y}) only once.`,
    'trace-input-excluded': (p) => `Trace input (${p.x}, ${p.y}) violates the initial precondition. Select permitted coordinates.`,
    'invalid-board-size': (p) => `Board size invalid. Use an integer from ${p.min} to ${p.max}.`,
    'missing-step': () => 'Program transition function missing.',
    'missing-coordinate': () => 'Program transition returned no coordinates.',
    'invalid-layout': () => 'Deployment format invalid. Supply an array of coordinates.',
    'offboard-unit': () => 'Deployment coordinates invalid. Use integer coordinates inside the board.',
    'duplicate-unit': () => 'Deployment conflict. Assign only one unit to each coordinate.',
    'invalid-unit-branch': (p) => `Unsupported unit branch '${p.branch}'. Select a registered branch.`,
    'invalid-command-budget': () => 'Command budget invalid. Use a nonnegative integer.',
    'invalid-mode': () => 'Fire mode invalid. Select single or salvo.',
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
  if (!Number.isSafeInteger(value)) {
    throw engineError('integer-range', { label }, RangeError);
  }
  return value;
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
        return { kind: 'literal', value: integer(Number(token.value), 'literal'), valueType: 'integer' };
      }
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'literal', value: token.value === 'true', valueType: 'boolean' };
      }
      if (token.value === 'x' || token.value === 'y' || PARAMETERS.includes(token.value)) {
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
 * exact within the safe-integer range; overflow is rejected. `%` is remainder
 * with the dividend's sign. Boolean &&/|| short-circuit, including zero guards.
 */
export function evaluate(ast, state) {
  function visit(node) {
    if (!node || typeof node !== 'object') throw engineError('invalid-ast', {}, TypeError);
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
          if (right === 0) throw engineError('zero-remainder-divisor', {}, RangeError);
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
const contextParameters = state => Object.fromEntries(PARAMETERS.filter(name => Object.hasOwn(state, name)).map(name => [name, state[name]]));
const stateCopy = state => ({ ...point(state), ...contextParameters(state) });
const unitCopy = (unit) => ({ ...point(unit), ...(unit.branch === undefined ? {} : { branch: unit.branch }) });
const key = ({ x, y }) => `${x},${y}`;
const inDomain = (s) => s && Number.isInteger(s.x) && Number.isInteger(s.y)
  && s.x >= DOMAIN.min && s.x <= DOMAIN.max && s.y >= DOMAIN.min && s.y <= DOMAIN.max;
const onBoard = (s, size) => s.x >= 0 && s.y >= 0 && s.x < size && s.y < size;

export const isInitializedLevel = level => level?.initialize !== undefined;

function initializeInput(level, a, b) {
  if (typeof level.initialize !== 'function') throw engineError('invalid-initializer', {}, TypeError);
  const initialized = level.initialize(Object.freeze({ a, b }));
  if (!inDomain(initialized) || !Number.isSafeInteger(initialized.n) || !Number.isSafeInteger(initialized.m)) {
    throw engineError('invalid-initialization', {}, TypeError);
  }
  // Raw input identity belongs to the engine, never to the initializer's return value.
  return { ...point(initialized), a, b, n: initialized.n, m: initialized.m };
}

function initializedVerificationCases(level) {
  if (level.initialStates !== undefined || level.initialCondition !== undefined) {
    throw engineError('ambiguous-initialization', {}, TypeError);
  }
  const cases = [];
  for (let a = INPUT_DOMAIN.min; a <= INPUT_DOMAIN.max; a++) {
    for (let b = INPUT_DOMAIN.min; b <= INPUT_DOMAIN.max; b++) cases.push(initializeInput(level, a, b));
  }
  return cases;
}

function initializedBattlefieldCases(level) {
  if (!Array.isArray(level.battleInputs) || level.battleInputs.length !== 3) {
    throw engineError('invalid-battle-inputs', {}, TypeError);
  }
  const seen = new Set();
  return level.battleInputs.map(input => {
    if (!input || !Number.isInteger(input.a) || !Number.isInteger(input.b)
      || input.a < INPUT_DOMAIN.min || input.a > INPUT_DOMAIN.max
      || input.b < INPUT_DOMAIN.min || input.b > INPUT_DOMAIN.max) {
      throw engineError('invalid-battle-input', { min: INPUT_DOMAIN.min, max: INPUT_DOMAIN.max }, TypeError);
    }
    const id = `${input.a},${input.b}`;
    if (seen.has(id)) throw engineError('duplicate-battle-input', { a: input.a, b: input.b }, TypeError);
    seen.add(id);
    return initializeInput(level, input.a, input.b);
  });
}

/** Test cases are finite verification coverage, not the program's input contract. */
export function verificationCasesForLevel(level) {
  return initialStatesForLevel(level);
}

/** These explicit samples select the visible battlefield, never the proof inputs. */
export function battlefieldCasesForLevel(level) {
  return traceInputsForLevel(level);
}

function predicate(source, label) {
  const ast = parseExpression(source);
  if (ast.valueType !== 'boolean') throw expressionError('predicate-type', { label });
  return ast;
}

const hasInitialCondition = (level) => level?.initialCondition !== undefined;

/**
 * Return every allowed initial input, never just the representative traces.
 * A precondition is evaluated over the full domain in x-then-y order; explicit
 * finite input sets retain authored order. Both forms return independent copies.
 */
export function initialStatesForLevel(level) {
  if (isInitializedLevel(level)) return initializedVerificationCases(level);
  if (hasInitialCondition(level)) {
    if (level.initialStates !== undefined) throw engineError('ambiguous-initial-inputs', {}, TypeError);
    const condition = predicate(level.initialCondition, 'initialCondition');
    const initialStates = [];
    for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
      for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
        const state = { x, y };
        if (evaluate(condition, state)) initialStates.push(state);
      }
    }
    if (!initialStates.length) throw engineError('empty-initial-condition', {}, TypeError);
    return initialStates;
  }
  const states = level?.initialStates === undefined ? [level?.initial] : level.initialStates;
  if (!Array.isArray(states) || states.length === 0) {
    throw engineError('invalid-initial-states', {}, TypeError);
  }
  const seen = new Set();
  const initialStates = [];
  for (const state of states) {
    if (!inDomain(state)) throw engineError('invalid-initial', { min: DOMAIN.min, max: DOMAIN.max }, TypeError);
    const location = key(state);
    if (seen.has(location)) throw engineError('duplicate-initial-state', point(state), TypeError);
    seen.add(location);
    initialStates.push(point(state));
  }
  return initialStates;
}

function selectTraceInputs(level, initialStates) {
  if (!hasInitialCondition(level)) return initialStates.map(point);
  if (level.traceInputs === undefined) return initialStates.slice(0, 3).map(point);
  if (!Array.isArray(level.traceInputs) || level.traceInputs.length === 0) {
    throw engineError('invalid-trace-inputs', {}, TypeError);
  }
  const allowed = new Set(initialStates.map(key));
  const seen = new Set();
  const traceInputs = [];
  for (const state of level.traceInputs) {
    if (!inDomain(state)) throw engineError('invalid-trace-input', { min: DOMAIN.min, max: DOMAIN.max }, TypeError);
    const location = key(state);
    if (seen.has(location)) throw engineError('duplicate-trace-input', point(state), TypeError);
    if (!allowed.has(location)) throw engineError('trace-input-excluded', point(state), TypeError);
    seen.add(location);
    traceInputs.push(point(state));
  }
  return traceInputs;
}

/** Representative executions are for display only and never limit verification. */
export function traceInputsForLevel(level) {
  if (isInitializedLevel(level)) return initializedBattlefieldCases(level);
  return selectTraceInputs(level, initialStatesForLevel(level));
}

function validateLevel(level) {
  const initialStates = initialStatesForLevel(level);
  const traceInputs = isInitializedLevel(level) ? initializedBattlefieldCases(level) : selectTraceInputs(level, initialStates);
  if (!Number.isInteger(level.size) || level.size < 1 || level.size > DOMAIN.max + 1) {
    throw engineError('invalid-board-size', { min: 1, max: DOMAIN.max + 1 }, TypeError);
  }
  if (typeof level.step !== 'function') throw engineError('missing-step', {}, TypeError);
  return { initialStates, traceInputs };
}

function successor(level, before) {
  const executionState = stateCopy(before);
  for (const name of PARAMETERS) {
    if (Object.hasOwn(executionState, name)) Object.defineProperty(executionState, name, { writable: false });
  }
  const after = level.step(executionState);
  if (!after || typeof after !== 'object') throw engineError('missing-coordinate', {}, TypeError);
  // A loop may update only x/y. Returned or mutated parameter values cannot
  // change the fixed context against which its invariant is checked.
  return { ...point(after), ...contextParameters(before) };
}

function traceProgram(level, guard, initial) {
  const trace = [stateCopy(initial)];
  const visited = new Set();
  let current = stateCopy(initial);
  while (true) {
    if (!inDomain(current)) return { trace, traceStatus: 'outside-domain' };
    if (!evaluate(guard, current)) return { trace, traceStatus: 'terminated' };
    if (visited.has(key(current))) return { trace, traceStatus: 'cycle' };
    visited.add(key(current));
    current = successor(level, current);
    trace.push(stateCopy(current));
  }
}

function project(source, level, exitOnly) {
  const ast = predicate(source, exitOnly ? 'invariant' : 'goal');
  const guard = exitOnly ? predicate(level.guardSource, 'guard') : null;
  const contexts = isInitializedLevel(level) ? battlefieldCasesForLevel(level) : [{}];
  if (!Number.isInteger(level.size) || level.size < 1 || level.size > DOMAIN.max + 1) {
    throw engineError('invalid-board-size', { min: 1, max: DOMAIN.max + 1 }, TypeError);
  }
  const coordinates = new Map();
  for (const context of contexts) {
    const parameters = contextParameters(context);
    for (let x = 0; x < level.size; x++) for (let y = 0; y < level.size; y++) {
      const state = { x, y, ...parameters };
      if (evaluate(ast, state) && (!guard || !evaluate(guard, state))) coordinates.set(key(state), point(state));
    }
  }
  return [...coordinates.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Board previews are unverified projections of the three battlefield contexts. */
export function previewCandidatesForLevel(source, level) {
  return project(source, level, true);
}

export function projectPredicate(source, level) {
  return project(source, level, false);
}

/**
 * S = I && !guard is checked over the WHOLE domain. Only candidates are
 * projected onto the visible board. A goal witness may therefore be off-board.
 * A preservation witness may be unreachable from every allowed initial input.
 * traces contains representative executions, never proof evidence. Finite input
 * lists retain every trace; preconditions need not trace every permitted state.
 * trace/traceStatus retain the first displayed execution for legacy consumers.
 */
export function analyze(source, goalSource, level) {
  const result = {
    valid: false,
    objectiveVerified: false,
    initial: { pass: null },
    preservation: { pass: null },
    goal: { pass: null },
    candidates: [],
    trace: [],
    traces: [],
    exitStateCount: 0,
    checkedStateCount: 0,
  };
  try {
    const { initialStates, traceInputs } = validateLevel(level);
    const initialized = isInitializedLevel(level);
    const invariant = predicate(source, 'invariant');
    const goal = predicate(goalSource, 'goal');
    const guard = predicate(level.guardSource, 'guard');
    const specification = initialized ? predicate(level.goalSolution, 'goal') : null;
    if (initialized) {
      result.specification = { pass: null };
      result.contextCount = initialStates.length;
      result.inputWindow = { ...INPUT_DOMAIN };
      result.stateWindow = { ...DOMAIN };
    }
    result.traces = traceInputs.map((initial) => ({
      initial: stateCopy(initial),
      ...traceProgram(level, guard, initial),
    }));
    result.trace = result.traces[0].trace;
    result.traceStatus = result.traces[0].traceStatus;
    result.initial = { pass: true, checkedCount: 0 };
    for (const initial of initialStates) {
      const pass = evaluate(invariant, initial);
      result.initial.checkedCount++;
      if (!pass && result.initial.pass) {
        result.initial.pass = false;
        result.initial.before = stateCopy(initial);
      }
    }
    result.preservation = { pass: true };
    result.goal = { pass: true };
    if (initialized) result.specification = { pass: true };
    const contexts = initialized ? initialStates : [{}];
    const displayedInputs = new Set(traceInputs.map(state => `${state.a},${state.b}`));
    const projected = new Map();
    for (const context of contexts) {
      const parameters = contextParameters(context);
      const displayed = !initialized || displayedInputs.has(`${context.a},${context.b}`);
      for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
        for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
          const before = { x, y, ...parameters };
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
            if (displayed && onBoard(before, level.size)) projected.set(key(before), point(before));
            if (!evaluate(goal, before) && result.goal.pass) result.goal = { pass: false, before };
            if (specification && !evaluate(specification, before) && result.specification.pass) {
              result.specification = { pass: false, before };
            }
          }
        }
      }
    }
    result.candidates = [...projected.values()].sort((a, b) => a.x - b.x || a.y - b.y);
    result.valid = result.initial.pass && result.preservation.pass;
    result.objectiveVerified = result.valid && result.goal.pass && (!initialized || result.specification.pass);
  } catch (error) {
    result.valid = false;
    result.objectiveVerified = false;
    // An interrupted enumeration is not a completed proof. Invalidate every
    // check so consumers cannot mistake optimistic/partial flags for success.
    result.initial = { pass: null };
    result.preservation = { pass: null };
    result.goal = { pass: null };
    if (isInitializedLevel(level)) {
      result.specification = { pass: null };
    }
    Object.assign(result, errorDetails(error));
  }
  return result;
}

function copyUnits(units, size, occupied) {
  if (!Array.isArray(units)) throw engineError('invalid-layout', {}, TypeError);
  return units.map((unit) => {
    if (!inDomain(unit) || !onBoard(unit, size)) throw engineError('offboard-unit', {}, TypeError);
    if (unit.branch !== undefined && (typeof unit.branch !== 'string' || !Object.hasOwn(UNIT_TYPES, unit.branch))) {
      throw engineError('invalid-unit-branch', { branch: String(unit.branch) }, TypeError);
    }
    const location = key(unit);
    if (occupied.has(location)) throw engineError('duplicate-unit', {}, TypeError);
    occupied.add(location);
    return unitCopy(unit);
  });
}

function updateBattleStatus(battle) {
  battle.cleared = battle.enemies.length === 0;
  battle.finished = battle.cleared || battle.remaining === 0;
  battle.baseScore = battle.enemyPoints - battle.friendlyPoints + battle.remaining;
  // Recompute from the base, never multiply a previously reported score. The
  // last order's proof can earn a completion bonus, but cannot delay clearing.
  battle.scoreMultiplier = battle.cleared && battle.objectiveVerified === true ? 2 : 1;
  battle.score = battle.baseScore * battle.scoreMultiplier;
  return battle;
}

/** Initial arrays are preserved in battle.level; battle.enemies/allies are alive. */
export function createBattle(level) {
  const { initialStates, traceInputs } = validateLevel(level);
  predicate(level.guardSource, 'guard');
  const budget = level.commands ?? level.budget ?? 6;
  if (!Number.isSafeInteger(budget) || budget < 0) throw engineError('invalid-command-budget', {}, TypeError);
  const occupied = new Set();
  const enemies = copyUnits(level.enemies ?? [], level.size, occupied);
  const allies = copyUnits(level.allies ?? [], level.size, occupied);
  const normalizedLevel = {
    ...level,
    initial: stateCopy(traceInputs[0]),
    traceInputs: traceInputs.map(stateCopy),
    enemies: enemies.map(unitCopy),
    allies: allies.map(unitCopy),
  };
  // Keep the precondition as the source of truth. Adding its enumerated states
  // would create two conflicting initial-input definitions on the next order.
  if (isInitializedLevel(level)) {
    delete normalizedLevel.initialStates;
    normalizedLevel.battleInputs = level.battleInputs.map(({ a, b }) => ({ a, b }));
  } else if (hasInitialCondition(level)) delete normalizedLevel.initialStates;
  else normalizedLevel.initialStates = initialStates.map(point);
  return updateBattleStatus({
    level: normalizedLevel,
    budget,
    remaining: budget,
    enemies,
    allies,
    hit: [],
    enemyKills: 0,
    friendlyKills: 0,
    enemyPoints: 0,
    friendlyPoints: 0,
    objectiveVerified: false,
  });
}

function orderOutcome(battle, fields) {
  return { battle, analysis: null, shots: [], enemyPoints: 0, friendlyPoints: 0, dud: false, cost: 0, ...fields };
}

/** Apply an already completed staged report once, without repeating checks. */
function resolveOrder(battle, analysis, mode) {
  const outcome = fields => orderOutcome(battle, fields);
  if (analysis.error) return outcome({
    analysis,
    error: analysis.error,
    errorCode: analysis.errorCode,
    errorParams: { ...analysis.errorParams },
    errorStage: analysis.errorStage,
    errorCheck: analysis.errorCheck,
    reason: 'syntax-error',
  });
  const next = {
    ...battle,
    enemies: battle.enemies.map(unitCopy),
    allies: battle.allies.map(unitCopy),
    hit: battle.hit.map((hit) => ({ ...hit })),
  };
  next.objectiveVerified = analysis.objectiveVerified === true;
  if (!analysis.valid) {
    next.remaining--;
    return outcome({ battle: updateBattleStatus(next), analysis, dud: true, cost: 1, reason: 'invalid-invariant' });
  }
  const hit = new Set(battle.hit.map(key));
  const enemies = new Map(battle.enemies.map((unit) => [key(unit), unit]));
  const allies = new Map(battle.allies.map((unit) => [key(unit), unit]));
  const classify = (cell) => enemies.has(key(cell)) ? 'enemy' : allies.has(key(cell)) ? 'friendly' : 'neutral';
  const priority = { neutral: 0, friendly: 1, enemy: 2 };
  const candidates = analysis.candidates.filter((cell) => !hit.has(key(cell)))
    .map((cell) => {
      const unit = enemies.get(key(cell)) ?? allies.get(key(cell));
      return { ...unitCopy(unit ?? cell), type: classify(cell), points: unit ? unitPoints(unit) : 0 };
    })
    .sort((a, b) => priority[a.type] - priority[b.type] || a.x - b.x || a.y - b.y);
  if (!candidates.length) return outcome({ analysis, reason: 'no-candidates' });
  const shots = mode === 'single' ? candidates.slice(0, 1) : candidates;
  const shotKeys = new Set(shots.map(key));
  next.remaining--;
  const enemyShots = shots.filter((shot) => shot.type === 'enemy');
  const friendlyShots = shots.filter((shot) => shot.type === 'friendly');
  const enemyPoints = enemyShots.reduce((sum, shot) => sum + shot.points, 0);
  const friendlyPoints = friendlyShots.reduce((sum, shot) => sum + shot.points, 0);
  next.enemyKills += enemyShots.length;
  next.friendlyKills += friendlyShots.length;
  next.enemyPoints += enemyPoints;
  next.friendlyPoints += friendlyPoints;
  next.enemies = next.enemies.filter((unit) => !shotKeys.has(key(unit)));
  next.allies = next.allies.filter((unit) => !shotKeys.has(key(unit)));
  next.hit.push(...shots.map((shot) => ({ ...shot })));
  return outcome({ battle: updateBattleStatus(next), analysis, shots, enemyPoints, friendlyPoints, cost: 1, reason: 'fired' });
}

/**
 * Each next() performs one proof stage and yields an independent cumulative
 * snapshot. Initial/preservation failure or an error stops later stages; the
 * following next() returns the final outcome. The argument is never mutated.
 * Initialization and preservation gate firing; false ensures/specification
 * results are warnings. Their full exit regions are still checked so a false
 * witness cannot conceal a later arithmetic error or truncate target selection.
 * Duds and successful orders cost one command; expression errors remain free.
 * Enemy elimination finishes immediately. A verified final shot doubles the
 * completed score; later orders cannot revise or multiply it again.
 */
export function* orderStages(battle, invariantSource, goalSource, mode = 'single') {
  if (mode !== 'single' && mode !== 'salvo') {
    return orderOutcome(battle, { ...errorDetails(engineError('invalid-mode', { mode })), reason: 'invalid-mode' });
  }
  if (battle.finished) return orderOutcome(battle, { reason: 'finished' });
  const level = battle.level;
  const initialized = isInitializedLevel(level);
  const skipped = () => ({ pass: null, skipped: true });
  const analysis = {
    valid: false,
    objectiveVerified: false,
    initial: skipped(), preservation: skipped(), goal: skipped(),
    candidates: [], trace: [], traces: [], exitStateCount: 0, checkedStateCount: 0,
    ...(initialized ? {
      specification: skipped(),
      inputWindow: { ...INPUT_DOMAIN }, stateWindow: { ...DOMAIN },
    } : {}),
  };
  const snapshot = stage => ({ stage, analysis: structuredClone(analysis) });
  const failWithError = (error, stage, check = stage) => {
    analysis[check] = { pass: null };
    analysis.valid = analysis.initial.pass === true && analysis.preservation.pass === true;
    analysis.objectiveVerified = false;
    Object.assign(analysis, errorDetails(error), { errorStage: stage, errorCheck: check });
  };
  let initialStates, traceInputs, invariant, guard;
  try {
    ({ initialStates, traceInputs } = validateLevel(level));
    if (initialized) analysis.contextCount = initialStates.length;
    invariant = predicate(invariantSource, 'invariant');
    analysis.initial = { pass: true, checkedCount: 0 };
    for (const initial of initialStates) {
      analysis.initial.checkedCount++;
      if (!evaluate(invariant, initial)) {
        analysis.initial = { ...analysis.initial, pass: false, before: stateCopy(initial) };
        break;
      }
    }
  } catch (error) { failWithError(error, 'initial'); }
  yield snapshot('initial');
  if (analysis.initial.pass !== true) return resolveOrder(battle, analysis, mode);

  const contexts = initialized ? initialStates : [{}];
  const visitStates = visitor => {
    for (const context of contexts) {
      const parameters = contextParameters(context);
      for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
        for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
          if (visitor({ x, y, ...parameters }) === false) return;
        }
      }
    }
  };
  try {
    guard = predicate(level.guardSource, 'guard');
    analysis.preservation = { pass: true };
    visitStates(before => {
      analysis.checkedStateCount++;
      if (!evaluate(invariant, before) || !evaluate(guard, before)) return;
      const after = successor(level, before);
      const outsideDomain = !inDomain(after);
      if (outsideDomain || !evaluate(invariant, after)) {
        analysis.preservation = { pass: false, before, after, outsideDomain };
        return false;
      }
    });
    if (analysis.preservation.pass) {
      // Trace visualization is supplemental and only runs after preservation
      // succeeds. It never executes a future goal or supplies proof evidence.
      analysis.traces = traceInputs.map(initial => ({ initial: stateCopy(initial), ...traceProgram(level, guard, initial) }));
      analysis.trace = analysis.traces[0].trace;
      analysis.traceStatus = analysis.traces[0].traceStatus;
      analysis.valid = true;
    }
  } catch (error) { failWithError(error, 'preservation'); }
  yield snapshot('preservation');
  if (analysis.preservation.pass !== true) return resolveOrder(battle, analysis, mode);

  let activeCheck = 'goal';
  try {
    const goal = predicate(goalSource, 'goal');
    const displayedInputs = new Set(traceInputs.map(state => `${state.a},${state.b}`));
    const projected = new Map();
    analysis.goal = { pass: true };
    visitStates(before => {
      if (!evaluate(invariant, before) || evaluate(guard, before)) return;
      analysis.exitStateCount++;
      if (!evaluate(goal, before) && analysis.goal.pass) {
        analysis.goal = { pass: false, before };
      }
      const displayed = !initialized || displayedInputs.has(`${before.a},${before.b}`);
      if (displayed && onBoard(before, level.size)) projected.set(key(before), point(before));
    });
    analysis.candidates = [...projected.values()].sort((a, b) => a.x - b.x || a.y - b.y);
    if (initialized) {
      activeCheck = 'specification';
      const specification = predicate(level.goalSolution, 'goal');
      analysis.specification = { pass: true };
      visitStates(before => {
        if (evaluate(invariant, before) && !evaluate(guard, before)
          && !evaluate(specification, before) && analysis.specification.pass) {
          analysis.specification = { pass: false, before };
        }
      });
    }
    analysis.objectiveVerified = analysis.valid && analysis.goal.pass && (!initialized || analysis.specification.pass);
  } catch (error) { failWithError(error, 'goal', activeCheck); }
  yield snapshot('goal');
  return resolveOrder(battle, analysis, mode);
}

/** Synchronous compatibility wrapper; consumes the same staged order once. */
export function order(battle, invariantSource, goalSource, mode = 'single') {
  const stages = orderStages(battle, invariantSource, goalSource, mode);
  let result = stages.next();
  while (!result.done) result = stages.next();
  return result.value;
}
