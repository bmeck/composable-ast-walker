'use strict';
const {NodePath} = require('./NodePath');

// An immutable walk combinator.
// Instances are referred to as "walkers".
//
// It can perform a walk on a value:
//   generating multiple inputs for inner combinators
//   generating multiple outputs
//
// A default walker over objects is available at WalkCombinator.DEPTH_FIRST
// This transforms a value into a series of NodePath inputs
// It has a passthrough for all outputs
const GUARD = Symbol();
class WalkCombinator {
  //
  // WARNING: Not user usable, use WalkCombinator.pipe()
  //
  constructor(visitor = EMPTY, key) {
    if (key !== GUARD) throw Error(`use .pipe`);
    let into = visitor != null ? visitor.inputs : void 0;
    let from = typeof visitor === 'function'
      ? visitor
      : visitor != null ? visitor.outputs : void 0;

    this.visitor = Object.freeze(
      Object.create(null, {
        inputs: {
          value: toIter(into),
          enumerable: true,
        },
        outputs: {
          value: toIter(from),
          enumerable: true,
        },
      })
    );
    Object.freeze(this);
  }
  //
  // Creates a pipe of combinators:
  // input from .walk(input) is passed to the combinators in order
  // output from combinators is propagated in reverse order
  //
  static pipe(...combinators) {
    let walker = new WalkCombinator(void 0, GUARD);
    for (const {inputs, outputs} of combinators) {
      const outer = walker;
      // inner stuff
      const into = toIter(inputs);
      const from = toIter(outputs);
      walker = new WalkCombinator({
        *inputs(path) {
          let iter = outer.visitor.inputs(path);
          let cmd;
          while (true) {
            let {value, done} = iter.next(cmd);
            if (done) return value;
            cmd = yield* into(value);
          }
        },
        *outputs(path) {
          let iter = from(path);
          let cmd;
          while (true) {
            let {value, done} = iter.next(cmd);
            if (done) return value;
            cmd = yield* outer.visitor.outputs(value);
          }
        }
      }, GUARD);
    }
    return walker;
  }
  *walk(input) {
    if (input instanceof NodePath !== true) {
      throw TypeError(`input must be a NodePath`);
    }
    let iter = this.visitor.inputs(input);
    let cmd;
    while (true) {
      let {value, done} = iter.next(cmd);
      if (done) return value;
      cmd = yield* this.visitor.outputs(value);
    }
  }
};
exports.WalkCombinator = WalkCombinator;

////////
// utils
///////
const PASSTHROUGH = Object.freeze(function* passthrough(_) {
  return yield _;
});
const EMPTY = Object.freeze(Object.create(null));
const toIter = (match, def = PASSTHROUGH) => {
  if (typeof match === 'function') {
    return path => match(path);
  }
  return def;
};

//
// The default walker takes all inputs and visits all Array and Object keys
// It visits all indices of an Array up to .length
// It only checks own enumerable keys for Objects
// 
// It outputs every node it receives
// @param {any} path
//
const SIMPLE_WALK = (depth_first = true) => {
  return function* DEFAULT_WALKER(path) {
      const node = path.node;
      if (typeof node !== 'object' || !node) return;
      if (!depth_first) {
        const cmd = yield path;
        if (cmd === WalkCombinator.SKIP) return;
      };
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          let retry = path.get([i]);
          do {
            retry = yield* DEFAULT_WALKER(retry);
          } while (retry !== void 0);
        }
      }
      else {
        for (const fieldName of Object.keys(node).sort()) {
          let retry = path.get([fieldName]);
          do {
            retry = yield* DEFAULT_WALKER(retry);
          } while (retry !== void 0);
        }
      }
      if (depth_first) yield path;
    }
}
WalkCombinator.DEPTH_FIRST = Object.freeze(
  Object.create(null, {
    inputs: Object.freeze({
      value: Object.freeze(SIMPLE_WALK(true)),
      enumerable: true,
    }),
    outputs: Object.freeze({
      value: Object.freeze(PASSTHROUGH),
      enumerable: true,
    }),
  })
);
WalkCombinator.BREADTH_FIRST = Object.freeze(
  Object.create(null, {
    inputs: {
      value: SIMPLE_WALK(false),
      enumerable: true,
    },
    outputs: {
      value: PASSTHROUGH,
      enumerable: true,
    },
  })
)
WalkCombinator.SKIP = Symbol();
Object.freeze(WalkCombinator);
Object.freeze(WalkCombinator.prototype);
