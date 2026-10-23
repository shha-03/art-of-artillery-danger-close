import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from './dist/levels.js';
import { dafnyProgram } from './dist/dafny-program.js';
import { domainsForLevel, statePoint, verificationCasesForLevel } from './dist/engine.js';

// Independent integer-expression parser, including local names such as mid.
// Keeping it separate from the game's parser also checks the display against
// the authored JavaScript when / and % semantics are changed in the engine.
function parseExpression(source) {
  const tokens = source.match(/\d+|[A-Za-z_][A-Za-z_0-9]*|&&|\|\||==|!=|<=|>=|[()+\-*/%<>!]/g) ?? [];
  assert.equal(tokens.join(''), source.replace(/\s/g,''));
  const rank = { '||':1, '&&':2, '==':3, '!=':3, '<':4, '<=':4, '>':4, '>=':4, '+':5, '-':5, '*':6, '/':6, '%':6 };
  let cursor = 0;
  function parse(minimum = 1) {
    const token = tokens[cursor++];
    let node;
    if (token === '(') { node = parse(); assert.equal(tokens[cursor++], ')'); }
    else if (['!', '-', '+'].includes(token)) node = { unary:token, right:parse(7) };
    else if (/^\d+$/.test(token)) node = { value:Number(token) };
    else if (token === 'true' || token === 'false') node = { value:token === 'true' };
    else { assert.match(token ?? '', /^[A-Za-z_][A-Za-z_0-9]*$/); node = { name:token }; }
    while ((rank[tokens[cursor]] ?? 0) >= minimum) {
      const op = tokens[cursor++];
      node = { op, left:node, right:parse(rank[op]+1) };
    }
    return node;
  }
  const ast = parse();
  assert.equal(cursor, tokens.length);
  return ast;
}

function evaluate(node, state) {
  if (Object.hasOwn(node, 'value')) return node.value;
  if (node.name) { assert.ok(Object.hasOwn(state,node.name), 'unbound '+node.name); return state[node.name]; }
  if (node.unary) {
    const value = evaluate(node.right,state);
    return node.unary==='!' ? !value : node.unary==='-' ? -value : value;
  }
  const left = evaluate(node.left,state);
  if (node.op==='&&') return left && evaluate(node.right,state);
  if (node.op==='||') return left || evaluate(node.right,state);
  const right = evaluate(node.right,state);
  switch (node.op) {
    case '+': return left+right;
    case '-': return left-right;
    case '*': return left*right;
    case '/':
    case '%': {
      assert.notEqual(right,0);
      const remainder=((left%right)+Math.abs(right))%Math.abs(right);
      return node.op==='%' ? remainder : (left-remainder)/right;
    }
    case '==': return left===right;
    case '!=': return left!==right;
    case '<': return left<right;
    case '<=': return left<=right;
    case '>': return left>right;
    case '>=': return left>=right;
    default: assert.fail('unknown expression operator');
  }
}

// A small statement interpreter for the displayed Dafny subset. It parses
// statements independently of the display adapter; authored initialize/step
// functions are the independent JavaScript oracle. No source is evaluated.
function parseBody(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
  let cursor = 0;
  const expression = text => {
    const conditional = /^if (.+) then (.+) else (.+)$/.exec(text);
    return conditional ? { condition: parseExpression(conditional[1]), yes: parseExpression(conditional[2]), no: parseExpression(conditional[3]) }
      : { value: parseExpression(text) };
  };
  function block() {
    const body = [];
    while (cursor < lines.length && !lines[cursor].startsWith('}')) {
      const line = lines[cursor++];
      const assignment = /^(?:var )?([A-Za-z_][A-Za-z_0-9]*)(?:: int)? := (.+);$/.exec(line);
      if (assignment) { body.push({ kind: 'set', name: assignment[1], expression: expression(assignment[2]) }); continue; }
      const branch = /^(while|if) (.+) \{$/.exec(line);
      assert.ok(branch, 'unsupported Dafny statement: ' + line);
      const statement = { kind: branch[1], guard: parseExpression(branch[2]), body: block() };
      if (lines[cursor] === '} else {') {
        assert.equal(statement.kind, 'if');
        cursor++;
        statement.otherwise = block();
      }
      assert.equal(lines[cursor++], '}');
      body.push(statement);
    }
    return body;
  }
  const body = block();
  assert.equal(cursor, lines.length);
  return body;
}

function execute(body, state, oneIteration = false, budget = { remaining: 10000 }) {
  for (const statement of body) {
    assert.ok(--budget.remaining >= 0, 'bounded test interpreter exhausted');
    if (statement.kind === 'set') {
      const expr = statement.expression;
      state[statement.name] = expr.value ? evaluate(expr.value, state)
        : evaluate(evaluate(expr.condition, state) ? expr.yes : expr.no, state);
    } else if (statement.kind === 'if') {
      execute(evaluate(statement.guard, state) ? statement.body : statement.otherwise ?? [], state, oneIteration, budget);
    } else {
      while (evaluate(statement.guard, state)) {
        execute(statement.body, state, oneIteration, budget);
        if (oneIteration) break;
      }
    }
  }
  return state;
}

test('all 24 displays use typed Dafny locals, assignments, and method-body control flow', () => {
  assert.equal(LEVELS.length, 24);
  for (const level of LEVELS) {
    const before = { initializationCode: level.initializationCode, code: level.code };
    const converted = dafnyProgram(level);
    assert.match(converted.initializationCode, /^var n: int := if a < 0 then -a else a;/);
    assert.match(converted.initializationCode, /var m: int := if b < 0 then -b else b;/);
    assert.match(converted.code, /^while .+ \{/);
    assert.doesNotMatch(converted.initializationCode + converted.code, /\b(?:let|const|Math)\b|\+\+|--|(?<![<>=!:])=(?!=)/);
    parseBody(converted.initializationCode);
    parseBody(converted.code);
    assert.deepEqual({ initializationCode: level.initializationCode, code: level.code }, before, 'authored source remains unchanged');
  }
});

for (const level of LEVELS) {
  test(level.id + ': Dafny initialization and each executed step match the independent authored program', () => {
    const display = dafnyProgram(level);
    const initialize = parseBody(display.initializationCode), loop = parseBody(display.code);
    const guard = parseExpression(level.guardSource);
    const cases = verificationCasesForLevel(level);
    const extra = [{ a: -7, b: 5 }, { a: 8, b: -6 }, { a: 0, b: -9 }, { a: -6, b: 0 }];
    for (const input of [...cases, ...extra]) {
      const raw = { a: input.a, b: input.b }, initial = level.initialize(raw);
      let state = execute(initialize, { ...raw });
      assert.deepEqual(state, { ...raw, ...initial }, 'Dafny absolute-value initialization');
      const params = { ...raw, n: initial.n, m: initial.m };
      let steps = 0;
      while (evaluate(guard, state)) {
        assert.ok(++steps < 10000);
        const expected = level.step({ ...state });
        state = execute(loop, { ...state }, true);
        assert.deepEqual(statePoint(state), statePoint(expected));
        for (const [name, value] of Object.entries(params)) assert.equal(state[name], value, 'input parameters remain unchanged');
      }
      const end = execute(loop, { ...state }, true);
      assert.deepEqual(statePoint(end), statePoint(state), 'false guard leaves state unchanged');
    }
  });
}

test('floor-to-division conversion preserves hypothetical negative midpoints and sequential updates', () => {
  const level = LEVELS.find(candidate => candidate.id === 'g20');
  const loop = parseBody(dafnyProgram(level).code), guard = parseExpression(level.guardSource);
  const domains = domainsForLevel(level);
  for (let n = 0; n <= 4; n++) for (let x = domains.x.min; x <= domains.x.max; x++) {
    for (let y = domains.y.min; y <= domains.y.max; y++) {
      const state = { x, y, a: n, b: 0, n, m: 0 };
      const expected = evaluate(guard, state) ? level.step({ ...state }) : state;
      assert.deepEqual(statePoint(execute(loop, { ...state }, true)), statePoint(expected));
    }
  }
  const spatial = LEVELS.find(candidate => candidate.id === 's01');
  const next = execute(parseBody(dafnyProgram(spatial).code), { x: 1, y: 1, z: 3, n: 2, m: 0 }, true);
  assert.deepEqual(statePoint(next), { x: 2, y: 4, z: 5 }, 'y uses the old z before z changes');
  assert.match(dafnyProgram(LEVELS.find(candidate => candidate.id === 's04')).code, /x := x \/ 2;/);
});

test('unsupported JavaScript source fails explicitly instead of producing misleading Dafny', () => {
  const base = { initializationCode: 'let x = 0;', code: 'while (x < 1) {\n  x = x + 1;\n}' };
  assert.throws(() => dafnyProgram({ ...base, code: 'while (x < 1) {\n  x++;\n}' }), /Unsupported authored statement/);
  assert.throws(() => dafnyProgram({ ...base, initializationCode: 'let x = Math.floor(a / -2);' }), /Unsupported authored expression/);
  assert.throws(() => dafnyProgram({ ...base, initializationCode: 'let x = Math.random();' }), /Unsupported authored expression/);
  assert.throws(() => dafnyProgram({ ...base, initializationCode: '' }), /source is required/);
});
