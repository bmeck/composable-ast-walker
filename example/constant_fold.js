// consumes <stdin> and performs constant folding
// echo '"use strict";"_"[0],1+2;' | node constant_fold.js
'use strict';
const { NodePath } = require('../NodePath');
const { WalkCombinator } = require('../WalkCombinator');

const $CONSTEXPR = Symbol.for('$CONSTEXTR');
const $CONSTVALUE = Symbol.for('$CONSTVALUE');
const IS_EMPTY = path => {
  return (path.node.type === 'BlockStatement' && path.node.body.length === 0) ||
    path.node.type === 'EmptyStatement';
};
const IN_PRAGMA_POS = path => {
  if (path.parent && Array.isArray(path.parent.node)) {
    const siblings = path.parent.node;
    for (let i = 0; i < path.key; i++) {
      // preceded by non-pragma
      if (
        siblings[i].type !== 'ExpressionStatement' ||
        !IS_CONSTEXPR(siblings[i].expression) ||
        typeof CONSTVALUE(siblings[i].expression) !== 'string'
      ) {
        return false;
      }
    }
  }
  return true;
}
const IS_PRAGMA = path => {
  if (path.parent && Array.isArray(path.parent.node)) {
    const siblings = path.parent.node;
    for (let i = 0; i < path.key + 1; i++) {
      // preceded by non-pragma
      if (
        siblings[i].type !== 'ExpressionStatement' ||
        !IS_CONSTEXPR(siblings[i].expression) ||
        typeof CONSTVALUE(siblings[i].expression) !== 'string'
      ) {
        return false;
      }
    }
  }
  return true;
}
const REMOVE_IF_EMPTY = path => {
  if (IS_EMPTY(path)) REMOVE(path);
  return null;
};
const REPLACE_IF_EMPTY = (path, folded) => {
  if (IS_EMPTY(path)) return REPLACE(path, folded);
  return path;
};
const REMOVE = path => {
  console.log(path);
  if (Array.isArray(path.parent.node)) {
    path.parent.node.splice(path.key, 1);
  } else {
    path.parent.node[path.key] = null;
  }
  return null;
};
const REPLACE = (path, folded) => {
  const replacement = new NodePath(path.parent, folded, path.key);
  path.parent.node[path.key] = folded;
  return replacement;
};
// no mutation, this is an atomic value
const EMPTY = Object.freeze({
  [$CONSTEXPR]: true,
  type: 'EmptyStatement',
});
const NULL = Object.freeze({
  [$CONSTEXPR]: true,
  type: 'Literal',
  value: null,
});
const NAN = Object.freeze({
  [$CONSTEXPR]: true,
  type: 'UnaryExpression',
  operator: '+',
  argument: Object.freeze({
    [$CONSTEXPR]: true,
    type: 'Literal',
    value: '_',
  }),
});
const NEG_ZERO = Object.freeze({
  [$CONSTEXPR]: true,
  type: 'UnaryExpression',
  operator: '-',
  argument: Object.freeze({
    [$CONSTEXPR]: true,
    type: 'Literal',
    value: 0,
  }),
});
const UNDEFINED = Object.freeze({
  [$CONSTEXPR]: true,
  type: 'UnaryExpression',
  operator: 'void',
  argument: Object.freeze({
    [$CONSTEXPR]: true,
    type: 'Literal',
    value: 0,
  }),
});
// ESTree doesn't like negative numeric literals
// this also preserves -0
const IS_UNARY_NEGATIVE = node => {
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    typeof node.argument.value === 'number' &&
    node.argument.value === node.argument.value &&
    node.argument.type === 'Literal'
  ) {
    return true;
  }
  return false;
};
const IS_CONSTEXPR = node => {
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  // DONT CALCULATE THINGS MULTIPLE TIMES!!@!@#
  if (node[$CONSTEXPR]) return true;
  if (node.type === 'ArrayExpression') {
    for (let i = 0; i < node.elements.length; i++) {
      const element = node.elements[i];
      // hole == null
      if (element !== null && !IS_CONSTEXPR(element)) {
        return false;
      }
    }
    return true;
  }
  if (node.type === 'Literal' || IS_UNDEFINED(node) || IS_NAN(node)) {
    return true;
  }
  if (IS_UNARY_NEGATIVE(node)) {
    return true;
  }
  return false;
};
const IS_NAN = node => {
  return node === NAN;
};
const IS_UNDEFINED = node => {
  return node === UNDEFINED;
};
const CONSTVALUE = node => {
  if (node[$CONSTVALUE]) {
    return node[$CONSTVALUE];
  }
  if (IS_UNDEFINED(node)) return void 0;
  if (IS_NAN(node)) return +'_';
  if (!IS_CONSTEXPR(node)) throw new Error('Not a CONSTEXPR');
  if (node.type === 'ArrayExpression') {
    let ret = [];
    ret.length = node.elements.length;
    for (let i = 0; i < node.elements.length; i++) {
      if (node.elements[i] !== null) {
        ret[i] = CONSTVALUE(node.elements[i]);
      }
    }
    return ret;
  }
  if (IS_UNARY_NEGATIVE(node)) {
    return -node.argument.value;
  }
  if (node.regex !== void 0) {
    return new RegExp(node.regex.pattern, node.regex.flags);
  }
  return node.value;
};
const CONSTEXPRS = new Map();
CONSTEXPRS.set(void 0, UNDEFINED);
CONSTEXPRS.set(+'_', NAN);
CONSTEXPRS.set(null, NULL);
const TO_CONSTEXPR = value => {
  let is_neg_zero = 1 / value === -Infinity;
  if (is_neg_zero) return NEG_ZERO;
  if (CONSTEXPRS.has(value)) {
    return CONSTEXPRS.get(value);
  }
  if (typeof value === 'number') {
    if (value < 0) {
      const CONSTEXPR = Object.freeze({
        [$CONSTEXPR]: true,
        [$CONSTVALUE]: value,
        type: 'UnaryExpression',
        operator: '-',
        argument: Object.freeze({ type: 'Literal', value: -value }),
      });
      CONSTEXPRS.set(value, CONSTEXPR);
      return CONSTEXPR;
    }
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    const CONSTEXPR = Object.freeze({
      [$CONSTEXPR]: true,
      [$CONSTVALUE]: value,
      type: 'Literal',
      value,
    });
    CONSTEXPRS.set(value, CONSTEXPR);
    return CONSTEXPR;
  }
  // have to generate new one every time :-/
  if (Array.isArray(value)) {
    return Object.freeze({
      [$CONSTEXPR]: true,
      type: 'ArrayExpression',
      elements: Object.freeze(value.map(TO_CONSTEXPR)),
    });
  }
  throw Error('Not a CONSTVALUE (did you pass a RegExp?)');
};
// THIS DOES NOT HANDLE NODE SPECIFIC CASES LIKE IfStatement
const FOLD_EMPTY = function*(path) {
  if (
    path &&
    path.node &&
    path.parent &&
    Array.isArray(path.parent.node) &&
    IS_EMPTY(path)
  ) {
    REMOVE(path);
    return path.parent;
  }
  return yield path;
};
const FOLD_EXPR_STMT = function*(path) {
  foldable: if (path && path.node && path.node.type === 'ExpressionStatement') {
    let completion_check_path = path;
    while (true) {
      if (
        completion_check_path.parent &&
        Array.isArray(completion_check_path.parent.node)
      ) {
        // not last in block
        if (
          completion_check_path.key !==
          completion_check_path.parent.node.length - 1
        ) {
          break;
        }
      } else if (completion_check_path.node.type === 'Program') {
        break foldable;
      }
      completion_check_path = completion_check_path.parent;
    }
    // merge all the adjacent expression statements into sequences
    if (Array.isArray(path.parent.node)) {
      // could have nodes after it
      const siblings = path.parent.node;
      if (!IS_PRAGMA(path)) {
        if (path.key < siblings.length - 1) {
          const mergeable = [path.node];
          for (let needle = path.key + 1; needle < siblings.length; needle++) {
            if (siblings[needle].type !== 'ExpressionStatement') {
              break;
            }
            mergeable.push(siblings[needle]);
          }
          if (mergeable.length > 1) {
            siblings.splice(path.key, mergeable.length, {
              [$CONSTEXPR]: true,
              type: 'ExpressionStatement',
              expression: {
                [$CONSTEXPR]: true,
                type: 'SequenceExpression',
                expressions: mergeable.reduce(
                  (acc, es) => {
                    if (es.expression.type == 'SequenceExpression') {
                      return [...acc, ...es.expression.expressions];
                    } else {
                      return [...acc, es.expression];
                    }
                  },
                  []
                ),
              },
            });
            return path;
          }
        }
      }
    } else if (IS_CONSTEXPR(path.node.expression)) {
      return REPLACE(path, EMPTY);
    }
  }
  return yield path;
};
const FOLD_WHILE = function*(path) {
  if (path && path.node) {
    if (path.node.type === 'DoWhileStatement') {
      REPLACE_IF_EMPTY(path.get(['body']), EMPTY);
    }
    if (path.node.type === 'WhileStatement') {
      let { test, consequent, alternate } = path.node;
      if (IS_CONSTEXPR(test)) {
        test = CONSTVALUE(test);
        if (!test) {
          return REPLACE(path, EMPTY);
        }
      }
      REPLACE_IF_EMPTY(path.get(['body']), EMPTY);
    }
    if (path.node.type === 'ForStatement') {
      REPLACE_IF_EMPTY(path.get(['body']), EMPTY);
      let { init, test, update } = path.node;
      let updated = false;
      if (init && IS_CONSTEXPR(init)) {
        updated = true;
        REPLACE(path.get(['init']), null);
      }
      if (test && IS_CONSTEXPR(test)) {
        let current = CONSTVALUE(test);
        let coerced = Boolean(current);
        // remove the test if it is always true
        if (coerced === true) {
          updated = true;
          REPLACE(path.get(['test']), null);
        } else if (coerced !== current) {
          updated = true;
          REPLACE(path.get(['test']), TO_CONSTEXPR(coerced));
        }
      }
      if (update && IS_CONSTEXPR(update)) {
        updated = true;
        REPLACE(path.get(['update']), null);
      }
      if (updated) {
        return path;
      }
    }
  }
  return yield path;
};
const FOLD_IF = function*(path) {
  if (path && path.node && path.node.type === 'IfStatement') {
    let { test, consequent, alternate } = path.node;
    if (IS_CONSTEXPR(test)) {
      test = CONSTVALUE(test);
      if (test) {
        return REPLACE(path, consequent);
      }
      if (alternate) {
        return REPLACE(path, alternate);
      }
      return REPLACE(path, EMPTY);
    }
    consequent = path.get(['consequent']);
    if (consequent.node !== EMPTY) {
      REPLACE_IF_EMPTY(consequent, EMPTY);
      return path;
    }
    if (alternate) {
      alternate = path.get(['alternate']);
      REMOVE_IF_EMPTY(alternate);
      return alternate;
    }
  }
  return yield path;
};
const FOLD_SEQUENCE = function*(path) {
  if (path && path.node && path.node.type === 'SequenceExpression') {
    // never delete the last value
    for (let i = 0; i < path.node.expressions.length - 1; i++) {
      if (IS_CONSTEXPR(path.node.expressions[i])) {
        path.node.expressions.splice(i, 1);
        i--;
      }
    }
    if (path.node.expressions.length === 1) {
      return REPLACE(path, path.node.expressions[0]);
    }
  }
  return yield path;
};
const FOLD_LOGICAL = function*(path) {
  if (path && path.node && path.node.type === 'LogicalExpression') {
    let { left, right, operator } = path.node;
    if (IS_CONSTEXPR(left)) {
      left = CONSTVALUE(left);
      if (operator === '||') {
        if (left) {
          return REPLACE(path, TO_CONSTEXPR(left));
        }
        return REPLACE(path, right);
      } else if (operator === '&&') {
        if (!left) {
          return REPLACE(path, TO_CONSTEXPR(left));
        }
        return REPLACE(path, right);
      }
    }
  }
  return yield path;
};
const FOLD_CONDITIONAL = function*(path) {
  if (path && path.node && path.node.type === 'ConditionalExpression') {
    let { test, consequent, alternate } = path.node;
    if (IS_CONSTEXPR(test)) {
      test = CONSTVALUE(test);
      if (test) {
        return REPLACE(path, consequent);
      }
      return REPLACE(path, alternate);
    }
  }
  return yield path;
};
const FOLD_BINARY = function*(path) {
  if (path && path.node && path.node.type === 'BinaryExpression') {
    let { left, right, operator } = path.node;
    if (IS_CONSTEXPR(left) && IS_CONSTEXPR(right)) {
      left = CONSTVALUE(left);
      right = CONSTVALUE(right);
      if (operator === '+') {
        return REPLACE(path, TO_CONSTEXPR(left + right));
      } else if (operator === '-') {
        return REPLACE(path, TO_CONSTEXPR(left - right));
      } else if (operator === '*') {
        return REPLACE(path, TO_CONSTEXPR(left * right));
      } else if (operator === '/') {
        return REPLACE(path, TO_CONSTEXPR(left / right));
      } else if (operator === '%') {
        return REPLACE(path, TO_CONSTEXPR(left % right));
      } else if (operator === '==') {
        return REPLACE(path, TO_CONSTEXPR(left == right));
      } else if (operator === '!=') {
        return REPLACE(path, TO_CONSTEXPR(left != right));
      } else if (operator === '===') {
        return REPLACE(path, TO_CONSTEXPR(left === right));
      } else if (operator === '!==') {
        return REPLACE(path, TO_CONSTEXPR(left !== right));
      } else if (operator === '<') {
        return REPLACE(path, TO_CONSTEXPR(left < right));
      } else if (operator === '<=') {
        return REPLACE(path, TO_CONSTEXPR(left <= right));
      } else if (operator === '>') {
        return REPLACE(path, TO_CONSTEXPR(left > right));
      } else if (operator === '>=') {
        return REPLACE(path, TO_CONSTEXPR(left >= right));
      } else if (operator === '<<') {
        return REPLACE(path, TO_CONSTEXPR(left << right));
      } else if (operator === '>>') {
        return REPLACE(path, TO_CONSTEXPR(left >> right));
      } else if (operator === '>>>') {
        return REPLACE(path, TO_CONSTEXPR(left >>> right));
      } else if (operator === '|') {
        return REPLACE(path, TO_CONSTEXPR(left | right));
      } else if (operator === '&') {
        return REPLACE(path, TO_CONSTEXPR(left & right));
      } else if (operator === '^') {
        return REPLACE(path, TO_CONSTEXPR(left ^ right));
      }
    }
  }
  return yield path;
};
const FOLD_UNARY = function*(path) {
  if (path && path.node && path.node.type === 'UnaryExpression') {
    if (IS_CONSTEXPR(path.node)) {
      return yield path;
    }
    let { argument, operator } = path.node;
    if (IS_CONSTEXPR(argument)) {
      if (operator === 'void') {
        return REPLACE(path, UNDEFINED);
      }
      let value = CONSTVALUE(argument);
      if (operator === '-') {
        value = -value;
      } else if (operator === '+') {
        value = +value;
      } else if (operator === '~') {
        value = ~value;
      } else if (operator === '!') {
        value = !value;
      } else if (operator === 'typeof') {
        value = typeof value;
      } else if (operator === 'delete') {
        value = true;
      }
      return REPLACE(path, TO_CONSTEXPR(value));
    }
  }
  return yield path;
};
const FOLD_MEMBER = function*(path) {
  if (path && path.node && path.node.type === 'MemberExpression') {
    if (path.node.computed && path.node.property.type === 'Literal') {
      const current = `${CONSTVALUE(path.node.property)}`;
      if (typeof current === 'string' && /^[$_a-z][$_a-z\d]*$/i.test(current)) {
        path.node.computed = false;
        path.node.property = {
          type: 'Identifier',
          name: current,
        };
        return path;
      }
    }
    if (IS_CONSTEXPR(path.node.object)) {
      const value = CONSTVALUE(path.node.object);
      if (typeof value === 'string' || Array.isArray(value)) {
        if (!path.node.computed) {
          if (path.node.property.name === 'length') {
            return REPLACE(path, TO_CONSTEXPR(value.length));
          }
        } else if (IS_CONSTEXPR(path.node.property)) {
          const key = +`${CONSTVALUE(path.node.property)}`;
          if (key === key && key >= 0 && key < value.length) {
            const desc = Object.getOwnPropertyDescriptor(value, key);
            if (desc) {
              const folded = value[key];
              console.error('FOLDING', JSON.stringify(folded))
              if (IN_PRAGMA_POS(path) && typeof folded === 'string') {
                if (value.length > 1) {
                  REPLACE(
                    path.get(['object']), TO_CONSTEXPR(value.slice(key, key + 1)));
                  REPLACE(
                    path.get(['property']), TO_CONSTEXPR(0));
                  return path;
                }
              }
              else {
                return REPLACE(path, TO_CONSTEXPR(value[key]));
              }
            }
          }
        }
      }
    }
  }
  return yield path;
};
const WALKER = WalkCombinator.pipe(
  ...[
    WalkCombinator.DEPTH_FIRST,
    { inputs: FOLD_WHILE },
    { inputs: FOLD_IF },
    { inputs: FOLD_EXPR_STMT },
    { inputs: FOLD_EMPTY },
    { inputs: FOLD_CONDITIONAL },
    { inputs: FOLD_LOGICAL },
    { inputs: FOLD_BINARY },
    { inputs: FOLD_UNARY },
    { inputs: FOLD_SEQUENCE },
    { inputs: FOLD_MEMBER },
  ]
);

process.stdin.pipe(
  require('mississippi').concat(buff => {
    const ROOT = new NodePath(
      null,
      require('esprima').parse(`${buff}`, {
        // loc: true,
        // source: '<stdin>',
      }),
      null
    );
    const walk = WALKER.walk(ROOT);
    for (const _ of walk) {
    }
    console.log(
      '%s',
      require('util').inspect(ROOT.node, {
        depth: null,
        colors: true,
      })
    );
    const out = require('escodegen').generate(ROOT.node);
    console.log(out);
  })
);
