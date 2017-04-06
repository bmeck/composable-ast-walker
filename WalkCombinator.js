'use strict';

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
  *walk(input, { visitor } = this) {
    let iter = visitor.inputs(input);
    let cmd;
    while (true) {
      let {value, done} = iter.next(cmd);
      if (done) return value;
      cmd = yield* visitor.outputs(value);
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
WalkCombinator.DEPTH_FIRST = Object.freeze(
  Object.create(null, {
    inputs: {
      value: function* DEFAULT_WALKER(path) {
        const node = path.node;
        if (typeof node !== 'object' || !node) return;
        let returns = [];
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i++) {
            let retry;
            do {
              retry = yield* DEFAULT_WALKER(path.get([i]));
            } while (retry !== void 0);
          }
        }
        else {
          for (const fieldName of Object.keys(node).sort()) {
            let retry;
            do {
              retry = yield* DEFAULT_WALKER(path.get([fieldName]));
            } while (retry !== void 0);
          }
        }
        return yield path;
      },
      enumerable: true,
    },
    outputs: {
      value: PASSTHROUGH,
      enumerable: true,
    },
  })
)
Object.freeze(WalkCombinator);
Object.freeze(WalkCombinator.prototype);
