// consumes <stdin> and performs constant folding
// echo '0,1+2;' | node constant_fold.js
'use strict';
const { NodePath } = require('../NodePath');
const { WalkCombinator } = require('../WalkCombinator');

const REPLACE = (path, folded) => {
  const replacement = new NodePath(
    path.parent,
    folded,
    path.key
  )
  path.parent.node[path.key] = folded;
  return replacement;
}
// no mutation, this is an atomic value
const EMPTY = Object.freeze({
  type: 'EmptyStatement'
});
const NAN = Object.freeze({
  type: 'UnaryExpression',
  operator: '+',
  argument: Object.freeze({type: 'Literal', value: '_'})
});
const UNDEFINED = Object.freeze({
  type: 'UnaryExpression',
  operator: 'void',
  argument: Object.freeze({type: 'Literal', value: 0})
});
// ESTree doesn't like negative numeric literals
// this also preserves -0
const IS_UNARY_NEGATIVE = node => {
  if (node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    typeof node.argument.value === 'number' &&
    node.argument.value === node.argument.value &&
    node.argument.type === 'Literal') {
    return true;
  }
  return false;
}
const IS_CONSTEXPR = node => {
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  if (node.type === 'Literal' || IS_UNDEFINED(node) || IS_NAN(node)) {
    return true;
  }
  if (IS_UNARY_NEGATIVE(node)) {
    return true;
  }
  return false;
}
const IS_NAN = node => {
  return node === NAN;
}
const IS_UNDEFINED = node => {
  return node === UNDEFINED;
}
const CONSTVALUE = node => {
  if (IS_UNDEFINED(node)) return void 0;
  if (IS_NAN(node)) return +'_';
  if (!IS_CONSTEXPR(node)) throw new Error('Not a CONSTEXPR');
  if (IS_UNARY_NEGATIVE(node)) {
    return -(node.argument.value);
  }
  if (node.regex !== void 0) {
    return new RegExp(node.regex.pattern, node.regex.flags);
  }
  return node.value;
}
const TO_CONSTEXPR = value => {
  if (value !== value) return NAN;
  if (value === void 0) return UNDEFINED;
  if (typeof value === 'number') {
    if (value < 0 || 1/value === -Infinity) {
      return {
        type: 'UnaryExpression',
        operator: '-',
        argument: {type: 'Literal', value: -value}
      };
    }
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return {type: 'Literal', value};
  }
  throw Error('Not a CONSTVALUE (did you pass a RegExp?)');
}
const FOLD_EMPTY = function* (path) {
  if (path && path.node) {
    if (path.node.type === 'EmptyStatement') {
      if (Array.isArray(path.parent.node)) {
        path.parent.node.splice(path.key, 1);
        return path.parent;
      }
    }
    if (path.node.type === 'BlockStatement' && path.node.body.length === 0) {
      return REPLACE(path, EMPTY);
    }
  }
  return yield path;
}
const FOLD_EXPR_STMT = function* (path) {
  if (path && path.node && path.node.type === 'ExpressionStatement') {
    if (
        path.parent.parent.node.type === 'Program' &&
        path.key === path.parent.node.length - 1
      ) {
      // do nothing
    }
    // merge all the adjacent expression statements into sequences
    else if (Array.isArray(path.parent.node)) {
      // could have nodes after it
      const siblings = path.parent.node;
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
            type: 'ExpressionStatement',
            expression: {
              type: 'SequenceExpression',
              expressions: mergeable.reduce(
                (acc, es) => {
                  if (es.expression.type == 'SequenceExpression') {
                    return [...acc, ...es.expression.expressions];
                  }
                  else {
                    return [...acc, es.expression];
                  }
                }, []
              )
            }
          });
          return path;
        }
      }
    }
    else if(IS_CONSTEXPR(path.node.expression)) {
      return REPLACE(path, EMPTY);
    }
  }
  return yield path;
}
const FOLD_WHILE = function* (path) {
  if (path && path.node) {
    if (path.node.type === 'WhileStatement') {
      let {test, consequent, alternate} = path.node;
      if (IS_CONSTEXPR(test)) {
        test = CONSTVALUE(test);
        if (!test) {
          return REPLACE(path, EMPTY);
        }
      }
    }
    if (path.node.type === 'ForStatement') {
      let {init, test, update} = path.node;
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
        }
        else if (coerced !== current) {
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
}
const FOLD_IF = function* (path) {
  if (path && path.node && path.node.type === 'IfStatement') {
    let {test, consequent, alternate} = path.node;
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
  }
  return yield path;
}
const FOLD_SEQUENCE = function* (path) {
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
}
const FOLD_LOGICAL = function* (path) {
  if (path && path.node && path.node.type === 'LogicalExpression') {
    let {left, right, operator} = path.node;
    if (IS_CONSTEXPR(left)) {
      left = CONSTVALUE(left);
      if (operator === '||') {
        if (left) {
          return REPLACE(path, TO_CONSTEXPR(left));
        }
        return REPLACE(path, right);
      }
      else if (operator === '&&') {
        if (!left) {
          return REPLACE(path, TO_CONSTEXPR(left));
        }
        return REPLACE(path, right);
      }
    }
  }
  return yield path;
}
const FOLD_CONDITIONAL = function* (path) {
  if (path && path.node && path.node.type === 'ConditionalExpression') {
    let {test, consequent, alternate} = path.node;
    if (IS_CONSTEXPR(test)) {
      test = CONSTVALUE(test);
      if (test) {
        return REPLACE(path, consequent);
      }
      return REPLACE(path, alternate);
    }
  }
  return yield path;
}
const FOLD_BINARY = function* (path) {
  if (path && path.node && path.node.type === 'BinaryExpression') {
    let {left, right, operator} = path.node;
    if (IS_CONSTEXPR(left) && IS_CONSTEXPR(right)) {
      left = CONSTVALUE(left);
      right = CONSTVALUE(right);
      if (operator === '+') {
        return REPLACE(path, TO_CONSTEXPR(left + right));
      }
      else if (operator === '-') {
        return REPLACE(path, TO_CONSTEXPR(left - right));
      }
      else if (operator === '*') {
        return REPLACE(path, TO_CONSTEXPR(left * right));
      }
      else if (operator === '/') {
        return REPLACE(path, TO_CONSTEXPR(left / right));
      }
      else if (operator === '%') {
        return REPLACE(path, TO_CONSTEXPR(left % right));
      }
      else if (operator === '==') {
        return REPLACE(path, TO_CONSTEXPR(left == right));
      }
      else if (operator === '!=') {
        return REPLACE(path, TO_CONSTEXPR(left != right));
      }
      else if (operator === '===') {
        return REPLACE(path, TO_CONSTEXPR(left === right));
      }
      else if (operator === '!==') {
        return REPLACE(path, TO_CONSTEXPR(left !== right));
      }
      else if (operator === '<') {
        return REPLACE(path, TO_CONSTEXPR(left < right));
      }
      else if (operator === '<=') {
        return REPLACE(path, TO_CONSTEXPR(left <= right));
      }
      else if (operator === '>') {
        return REPLACE(path, TO_CONSTEXPR(left > right));
      }
      else if (operator === '>=') {
        return REPLACE(path, TO_CONSTEXPR(left >= right));
      }
      else if (operator === '<<') {
        return REPLACE(path, TO_CONSTEXPR(left << right));
      }
      else if (operator === '>>') {
        return REPLACE(path, TO_CONSTEXPR(left >> right));
      }
      else if (operator === '>>>') {
        return REPLACE(path, TO_CONSTEXPR(left >>> right));
      }
      else if (operator === '|') {
        return REPLACE(path, TO_CONSTEXPR(left | right));
      }
      else if (operator === '&') {
        return REPLACE(path, TO_CONSTEXPR(left & right));
      }
      else if (operator === '^') {
        return REPLACE(path, TO_CONSTEXPR(left ^ right));
      }
    }
  }
  return yield path;
}
const FOLD_UNARY = function* (path) {
  if (path && path.node && path.node.type === 'UnaryExpression') {
    if (IS_CONSTEXPR(path.node)) {
      return yield path;
    }
    let {argument, operator} = path.node;
    if (IS_CONSTEXPR(argument)) {
      if (operator === 'void') {
        return REPLACE(path, UNDEFINED);
      }
      let value = CONSTVALUE(argument);
      if (operator === '-') {
        value = -value;
      }
      else if (operator === '+') {
        value = +value;
      }
      if (IS_UNARY_NEGATIVE) {

      }
      return REPLACE(path, TO_CONSTEXPR(value));
    }
  }
  return yield path;
}
const WALKER = WalkCombinator.pipe(...[
  WalkCombinator.DEPTH_FIRST,
  {inputs: FOLD_BINARY},
  {inputs: FOLD_UNARY},
  {inputs: FOLD_SEQUENCE},
  {inputs: FOLD_LOGICAL},
  {inputs: FOLD_EMPTY},
  {inputs: FOLD_IF},
  {inputs: FOLD_CONDITIONAL},
  {inputs: FOLD_EXPR_STMT},
  {inputs: FOLD_WHILE},
])

process.stdin.pipe(require('mississippi').concat(buff => {
  const ROOT = new NodePath(null, require('esprima').parse(`${buff}`, {
    loc: true,
    source: '<stdin>'
  }), null);
  const walk = WALKER.walk(ROOT);
  for (const _ of walk) {
  }
  const out = require('escodegen').generate(ROOT.node);
  console.log(out);
}));