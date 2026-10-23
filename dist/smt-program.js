/**
 * Pure compilation of the campaign's authored programs to unbounded integer
 * verification conditions. No JavaScript source is executed, sampled, or used
 * as an oracle here. The display/preview domains never become assumptions.
 *
 * Each stage supplies two complete SMT-LIB scripts, without check-sat:
 * definednessViolation asks whether an evaluated expression can divide by zero;
 * violation asks whether the corresponding Boolean obligation can be false.
 * UNSAT is a proof; SAT supplies a counterexample. The caller must preserve
 * UNKNOWN/timeouts as inconclusive rather than accepting an obligation.
 */

const INPUTS = ['a', 'b'];
const PARAMETERS = ['n', 'm'];
const AXES = ['x', 'y', 'z'];
const DEFAULT_NAMES = [...INPUTS, ...PARAMETERS, ...AXES];
const MAX_LENGTH = 4096;
const MAX_TOKENS = 1024;
const MAX_DEPTH = 128;
const RANK = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function fail(detail, code = 'smt-unsupported-program') {
  throw Object.assign(new SyntaxError(detail), { errorCode: code, errorParams: { detail } });
}

/** Same expression grammar/AST as engine.js, with exact decimal integer literals. */
export function parseSmtExpression(source, { variables = DEFAULT_NAMES } = {}) {
  if (typeof source !== 'string' || !source.trim()) fail('Expression missing.', 'missing-expression');
  if (source.length > MAX_LENGTH) fail('Expression length limit exceeded.', 'expression-too-long');
  const allowed = new Set(variables);
  const tokens = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { position += whitespace[0].length; continue; }
    const match = /^(?:\d+|[A-Za-z_][A-Za-z_0-9]*|&&|\|\||==|!=|<=|>=|[+*\/%<>()!\-])/.exec(rest);
    if (!match) fail(`Unsupported character at position ${position + 1}.`, 'smt-expression-error');
    tokens.push(match[0]);
    position += match[0].length;
    if (tokens.length > MAX_TOKENS) fail('Expression token limit exceeded.', 'too-many-tokens');
  }
  let cursor = 0;
  const requireType = (node, type) => {
    if (node.valueType !== type) fail(`Expected a ${type} expression.`, 'smt-expression-error');
  };
  function parse(minimum = 1, depth = 0) {
    if (depth > MAX_DEPTH) fail('Expression nesting limit exceeded.', 'nesting-too-deep');
    const token = tokens[cursor++];
    let node;
    if (token === '(') {
      node = parse(1, depth + 1);
      if (tokens[cursor++] !== ')') fail('Missing closing parenthesis.', 'smt-expression-error');
    } else if (['!', '-', '+'].includes(token)) {
      const argument = parse(7, depth + 1);
      const valueType = token === '!' ? 'boolean' : 'integer';
      requireType(argument, valueType);
      node = { kind: 'unary', op: token, argument, valueType };
    } else if (/^\d+$/.test(token ?? '')) {
      // Canonicalize text without ever converting an unbounded literal to Number.
      node = { kind: 'literal', value: token.replace(/^0+(?=\d)/, ''), valueType: 'integer' };
    } else if (token === 'true' || token === 'false') {
      node = { kind: 'literal', value: token === 'true', valueType: 'boolean' };
    } else if (allowed.has(token)) {
      node = { kind: 'variable', name: token, valueType: 'integer' };
    } else fail(`Unknown or missing operand '${token ?? '<end>'}'.`, 'smt-expression-error');
    while ((RANK[tokens[cursor]] ?? 0) >= minimum) {
      const op = tokens[cursor++];
      const right = parse(RANK[op] + 1, depth + 1);
      let valueType;
      if (op === '&&' || op === '||') {
        requireType(node, 'boolean'); requireType(right, 'boolean'); valueType = 'boolean';
      } else if (op === '==' || op === '!=') {
        if (node.valueType !== right.valueType) fail('Comparison type mismatch.', 'smt-expression-error');
        valueType = 'boolean';
      } else {
        requireType(node, 'integer'); requireType(right, 'integer');
        valueType = ['+', '-', '*', '/', '%'].includes(op) ? 'integer' : 'boolean';
      }
      node = { kind: 'binary', op, left: node, right, valueType };
    }
    return node;
  }
  const result = parse();
  if (cursor !== tokens.length) fail(`Unexpected token '${tokens[cursor]}'.`, 'smt-expression-error');
  return result;
}

const not = value => value === 'true' ? 'false' : value === 'false' ? 'true' : `(not ${value})`;
function join(operator, terms) {
  const identity = operator === 'and' ? 'true' : 'false';
  const absorbing = operator === 'and' ? 'false' : 'true';
  if (terms.includes(absorbing)) return absorbing;
  const kept = [...new Set(terms.filter(term => term !== identity))];
  return kept.length === 0 ? identity : kept.length === 1 ? kept[0] : `(${operator} ${kept.join(' ')})`;
}
const and = (...terms) => join('and', terms);
const or = (...terms) => join('or', terms);
const implies = (left, right) => or(not(left), right);
const ite = (condition, yes, no) => yes === no ? yes : `(ite ${condition} ${yes} ${no})`;
const binding = term => ({ term, defined: 'true', valueType: 'integer' });

function compileExpression(node, environment) {
  if (node.kind === 'literal') return { term: String(node.value), defined: 'true', valueType: node.valueType };
  if (node.kind === 'variable') {
    if (!Object.hasOwn(environment, node.name)) fail(`Unbound variable '${node.name}'.`);
    return environment[node.name];
  }
  if (node.kind === 'unary') {
    const value = compileExpression(node.argument, environment);
    return { ...value, term: node.op === '+' ? value.term : `(${node.op === '!' ? 'not' : '-'} ${value.term})` };
  }
  if (node.kind !== 'binary') fail('Unsupported expression tree.');
  const left = compileExpression(node.left, environment), right = compileExpression(node.right, environment);
  let defined = and(left.defined, right.defined);
  let term;
  if (node.op === '&&') {
    term = and(left.term, right.term);
    defined = and(left.defined, implies(left.term, right.defined));
  } else if (node.op === '||') {
    term = or(left.term, right.term);
    defined = and(left.defined, implies(not(left.term), right.defined));
  } else {
    const op = { '==': '=', '!=': 'distinct', '/': 'div', '%': 'mod' }[node.op] ?? node.op;
    term = `(${op} ${left.term} ${right.term})`;
    if (node.op === '/' || node.op === '%') defined = and(defined, `(distinct ${right.term} 0)`);
  }
  return { term, defined, valueType: node.valueType };
}

function authoredExpression(source, environment) {
  const absolute = /^Math\.abs\((.+)\)$/.exec(source);
  if (absolute) {
    const value = authoredExpression(absolute[1], environment);
    if (value.valueType !== 'integer') fail('Math.abs expects an integer.');
    return { ...value, term: ite(`(< ${value.term} 0)`, `(- ${value.term})`, value.term) };
  }
  const floor = /^Math\.floor\((.+)\)$/.exec(source);
  const ast = parseSmtExpression(floor ? floor[1] : source, { variables: Object.keys(environment) });
  if (floor && !(ast.kind === 'binary' && ast.op === '/' && ast.right.kind === 'literal'
      && ast.right.valueType === 'integer' && BigInt(ast.right.value) > 0n)) {
    fail('Authored Math.floor requires division by a positive integer literal.');
  }
  return compileExpression(ast, environment);
}

// Trusted campaign grammar: assignments, local declarations, and nested if/else.
// Reject every unsupported line. In particular, never fall back to JS functions.
function parseStatements(lines, cursor = { index: 0 }, nested = false) {
  const statements = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === '}' || line === '} else {') {
      if (!nested) fail('Unexpected closing brace.');
      return statements;
    }
    cursor.index++;
    const conditional = /^if \((.+)\) \{$/.exec(line);
    if (conditional) {
      const yes = parseStatements(lines, cursor, true);
      let no = [];
      if (lines[cursor.index] === '} else {') {
        cursor.index++;
        no = parseStatements(lines, cursor, true);
      }
      if (lines[cursor.index++] !== '}') fail('Missing closing brace for conditional.');
      statements.push({ kind: 'if', condition: conditional[1], yes, no });
      continue;
    }
    const assignment = /^(?:(const|let) )?([A-Za-z_][A-Za-z_0-9]*) = (.+);$/.exec(line);
    if (!assignment) fail(`Unsupported authored statement: ${line}`);
    statements.push({ kind: 'assign', declaration: assignment[1] ?? null, name: assignment[2], source: assignment[3] });
  }
  if (nested) fail('Unclosed conditional block.');
  return statements;
}

const sourceLines = source => {
  if (typeof source !== 'string' || !source.trim()) fail('An authored initialization and loop source are required; arbitrary JavaScript callbacks cannot be verified.');
  return source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
};

function executeSymbolically(statements, original, mutable) {
  const environment = { ...original };
  let defined = 'true';
  for (const statement of statements) {
    if (statement.kind === 'if') {
      const condition = authoredExpression(statement.condition, environment);
      if (condition.valueType !== 'boolean') fail('Conditional guard must be Boolean.');
      const yes = executeSymbolically(statement.yes, environment, mutable);
      const no = executeSymbolically(statement.no, environment, mutable);
      defined = and(defined, condition.defined, implies(condition.term, yes.defined), implies(not(condition.term), no.defined));
      for (const name of Object.keys(environment)) {
        environment[name] = binding(ite(condition.term, yes.environment[name].term, no.environment[name].term));
      }
    } else {
      const { name, declaration } = statement;
      if (INPUTS.includes(name) || (!declaration && !mutable.has(name))) fail(`Assignment to immutable or unknown variable '${name}'.`);
      if (declaration && Object.hasOwn(environment, name)) fail(`Duplicate or shadowed declaration '${name}'.`);
      if (!declaration && !Object.hasOwn(environment, name)) fail(`Assignment before declaration '${name}'.`);
      const value = authoredExpression(statement.source, environment);
      if (value.valueType !== 'integer') fail(`Integer assignment required for '${name}'.`);
      environment[name] = binding(value.term);
      defined = and(defined, value.defined);
      if (declaration === 'let') mutable = new Set([...mutable, name]);
    }
  }
  return { environment, defined };
}

function booleanExpression(source, environment, label) {
  const ast = parseSmtExpression(source, { variables: Object.keys(environment) });
  if (ast.valueType !== 'boolean') fail(`${label} must be a Boolean expression.`, 'smt-expression-error');
  return compileExpression(ast, environment);
}

/**
 * stages are lazy: malformed goal text cannot bypass/short-circuit earlier checks.
 * modelBindings and afterBindings contain declared integer symbols and preserve
 * arbitrary-precision counterexamples. No raw input or state window is asserted.
 */
export function compileVerificationProgram(level, invariantSource, goalSource) {
  const variables = level?.variables ?? ['x', 'y'];
  if (![2, 3].includes(variables.length) || variables.some((name, index) => name !== AXES[index])) fail('Expected state variables x, y, optionally z.');
  const modelVariables = [...INPUTS, ...PARAMETERS, ...variables];
  const initialProgram = parseStatements(sourceLines(level.initializationCode));
  const initial = executeSymbolically(initialProgram, Object.fromEntries(INPUTS.map(name => [name, binding(name)])), new Set());
  for (const name of [...PARAMETERS, ...variables]) {
    if (!Object.hasOwn(initial.environment, name)) fail(`Initialization does not define '${name}'.`);
  }
  const loopLines = sourceLines(level.code);
  const header = /^while \((.+)\) \{$/.exec(loopLines[0]);
  if (!header || loopLines.at(-1) !== '}') fail('Expected one authored while loop.');
  const loopBody = parseStatements(loopLines.slice(1, -1));
  const environment = Object.fromEntries(modelVariables.map(name => [name, binding(name)]));
  const guardAst = parseSmtExpression(level.guardSource, { variables: modelVariables });
  if (JSON.stringify(guardAst) !== JSON.stringify(parseSmtExpression(header[1], { variables: modelVariables }))) fail('Loop source and guardSource disagree.');
  const guard = booleanExpression(level.guardSource, environment, 'Guard');
  const invariantAst = parseSmtExpression(invariantSource, { variables: modelVariables });
  if (invariantAst.valueType !== 'boolean') fail('Invariant must be a Boolean expression.', 'smt-expression-error');
  const invariant = compileExpression(invariantAst, environment);
  const successor = executeSymbolically(loopBody, environment, new Set(variables));
  const afterEnvironment = { ...environment, ...Object.fromEntries(variables.map(name => [name, binding(`${name}_after`)])) };
  const invariantAfter = compileExpression(invariantAst, afterEnvironment);
  const modelBindings = Object.fromEntries(modelVariables.map(name => [name, name]));
  const afterBindings = Object.fromEntries(variables.map(name => [name, `${name}_after`]));
  const initializedBindings = [...PARAMETERS, ...variables].map(name => `(= ${name} ${initial.environment[name].term})`);
  const parameterBindings = PARAMETERS.map(name => `(= ${name} ${initial.environment[name].term})`);
  const successorBindings = variables.map(name => `(= ${name}_after ${successor.environment[name].term})`);
  const script = (assumptions, query, after = false) => [
    '(set-logic ALL)',
    ...[...modelVariables, ...(after ? Object.values(afterBindings) : [])].map(name => `(declare-const ${name} Int)`),
    ...assumptions.map(term => `(assert ${term})`),
    `(assert ${query})`,
  ].join('\n');
  const stage = (assumptions, invalid, undefinedExpression, after = false) => ({
    violation: script(assumptions, invalid, after),
    definednessViolation: script(assumptions, undefinedExpression, after),
    modelBindings: { ...modelBindings },
    ...(after ? { afterBindings: { ...afterBindings } } : {}),
  });
  const cached = {};
  const builders = {
    initial: () => stage(initializedBindings,
      and(initial.defined, invariant.defined, not(invariant.term)),
      or(not(initial.defined), and(initial.defined, not(invariant.defined)))),
    preservation: () => stage([initial.defined, ...parameterBindings, ...successorBindings],
      and(invariant.defined, invariant.term, guard.defined, guard.term, successor.defined, invariantAfter.defined, not(invariantAfter.term)),
      or(not(invariant.defined), and(invariant.term, or(not(guard.defined), and(guard.term, or(not(successor.defined), not(invariantAfter.defined)))))), true),
    goal: () => exitStage(goalSource),
    specification: () => exitStage(level.goalSolution ?? goalSource),
  };
  function exitStage(source) {
    const goal = booleanExpression(source, environment, 'Goal');
    return stage([initial.defined, ...parameterBindings],
      and(invariant.defined, invariant.term, guard.defined, not(guard.term), goal.defined, not(goal.term)),
      or(not(invariant.defined), and(invariant.term, or(not(guard.defined), and(not(guard.term), not(goal.defined))))));
  }
  const stages = {};
  for (const [name, build] of Object.entries(builders)) Object.defineProperty(stages, name, { enumerable: true, get: () => cached[name] ??= build() });
  return { variables: [...variables], modelVariables, stages };
}
