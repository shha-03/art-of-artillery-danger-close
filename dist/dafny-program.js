// Display the authored program as Dafny 4 method-body fragments. This adapter
// accepts only the small, trusted statement subset used by the campaign; it is
// neither a JavaScript evaluator nor a general-purpose source translator.
// Dafny local declarations use var (const is a member declaration). n and m
// remain unchanged because the authored loops never assign to them.
// Reference: https://dafny.org/dafny/OnlineTutorial/guide
// Integer semantics: https://dafny.org/dafny/DafnyRef/DafnyRef.html#sec-numeric-types

function expression(source) {
  const absolute = /^Math\.abs\(([A-Za-z_][A-Za-z_0-9]*)\)$/.exec(source);
  if (absolute) {
    const name = absolute[1];
    return `if ${name} < 0 then -${name} else ${name}`;
  }
  const floor = /^Math\.floor\((.+) \/ ([1-9][0-9]*)\)$/.exec(source);
  if (floor) {
    // Positive-divisor Euclidean integer division is floor division, including
    // negative numerators. Both authored uses have divisor 2.
    return `${expression(floor[1])} / ${floor[2]}`;
  }
  if (!/^[A-Za-z_0-9\s+*%<>=!&|()\-]+$/.test(source)
    || /===|!==|\+\+|--|=>/.test(source)) {
    throw new TypeError(`Unsupported authored expression for Dafny display: ${source}`);
  }
  return source;
}

function statements(source) {
  if (typeof source !== 'string' || !source.trim()) throw new TypeError('Authored program source is required.');
  return source.split(/\r?\n/).map(line => {
    const declaration = /^(\s*)(?:const|let) ([A-Za-z_][A-Za-z_0-9]*) = (.+);$/.exec(line);
    if (declaration) return `${declaration[1]}var ${declaration[2]}: int := ${expression(declaration[3])};`;
    const assignment = /^(\s*)([A-Za-z_][A-Za-z_0-9]*) = (.+);$/.exec(line);
    if (assignment) return `${assignment[1]}${assignment[2]} := ${expression(assignment[3])};`;
    const guard = /^(\s*)(while|if) \((.+)\) \{$/.exec(line);
    if (guard) return `${guard[1]}${guard[2]} ${expression(guard[3])} {`;
    if (/^\s*(?:}|} else \{)?\s*$/.test(line)) return line;
    throw new TypeError(`Unsupported authored statement for Dafny display: ${line.trim()}`);
  }).join('\n');
}

export function dafnyProgram(level) {
  return {
    initializationCode: statements(level.initializationCode),
    code: statements(level.code),
  };
}
