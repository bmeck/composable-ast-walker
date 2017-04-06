'use strict';
/**
 * Simple class to be able to generate a path from root to a specific node.
 */
class NodePath {
  constructor(parent = null, node, key = null) {
    this.node = node;
    this.parent = parent;
    this.key = key;
    // Object.freeze(this);
  }
  get(keys) {
    let needle = this;
    for (const key of keys) {
      needle = new NodePath(needle, needle.node[key], key);
    }
    return needle;
  }
  static from(node) {
    return new NodePath(null, node, null);
  }
}
Object.freeze(NodePath);
Object.freeze(NodePath.prototype);
exports.NodePath = NodePath;
