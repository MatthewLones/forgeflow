/* ── Layout Tree Types & Utilities ──────────────────────── */

export type SplitDirection = 'horizontal' | 'vertical';

export interface LayoutLeaf {
  type: 'leaf';
  groupId: string;
}

export interface LayoutSplit {
  type: 'split';
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

/* ── Query helpers ──────────────────────────────────────── */

/** Collect every groupId referenced in the tree. */
export function getAllGroupIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') return [node.groupId];
  return node.children.flatMap(getAllGroupIds);
}

/** Find the parent split + child index for a given groupId. Returns null if root is a leaf. */
export function findParent(
  root: LayoutNode,
  groupId: string,
): { parent: LayoutSplit; index: number } | null {
  if (root.type === 'leaf') return null;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.type === 'leaf' && child.groupId === groupId) {
      return { parent: root, index: i };
    }
    if (child.type === 'split') {
      const found = findParent(child, groupId);
      if (found) return found;
    }
  }
  return null;
}

/** Navigate to a split node by a path of child indices from the root. */
export function findSplitByPath(root: LayoutNode, path: number[]): LayoutSplit | null {
  let node: LayoutNode = root;
  for (const idx of path) {
    if (node.type !== 'split') return null;
    node = node.children[idx];
  }
  return node.type === 'split' ? node : null;
}

/** Get the path (array of child indices) from root to the split that contains groupId as a direct child. */
export function getPathToParent(root: LayoutNode, groupId: string, path: number[] = []): number[] | null {
  if (root.type === 'leaf') return null;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.type === 'leaf' && child.groupId === groupId) {
      return path;
    }
    if (child.type === 'split') {
      const found = getPathToParent(child, groupId, [...path, i]);
      if (found) return found;
    }
  }
  return null;
}

/* ── Mutation helpers (immutable — return new trees) ───── */

/**
 * Replace a leaf node (identified by groupId) with an arbitrary replacement node.
 * Used for splitting: replace leaf with a new split containing the old leaf + new leaf.
 */
export function replaceLeaf(root: LayoutNode, groupId: string, replacement: LayoutNode): LayoutNode {
  if (root.type === 'leaf') {
    return root.groupId === groupId ? replacement : root;
  }
  return {
    ...root,
    children: root.children.map((child) => replaceLeaf(child, groupId, replacement)),
  };
}

/**
 * Remove a leaf from the tree. The parent split adjusts its children/sizes.
 * Returns the simplified tree.
 */
export function removeLeaf(root: LayoutNode, groupId: string): LayoutNode {
  if (root.type === 'leaf') return root; // can't remove the root leaf

  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  let removedSize = 0;

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.type === 'leaf' && child.groupId === groupId) {
      removedSize = root.sizes[i];
      continue;
    }
    newChildren.push(child.type === 'split' ? removeLeaf(child, groupId) : child);
    newSizes.push(root.sizes[i]);
  }

  // Redistribute removed space proportionally
  if (removedSize > 0 && newSizes.length > 0) {
    const totalRemaining = newSizes.reduce((a, b) => a + b, 0);
    for (let i = 0; i < newSizes.length; i++) {
      newSizes[i] = newSizes[i] / totalRemaining;
    }
  }

  return simplifyTree({ ...root, children: newChildren, sizes: newSizes });
}

/**
 * Collapse single-child splits and flatten nested splits with the same direction.
 */
export function simplifyTree(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node;

  // Recursively simplify children first
  let children = node.children.map(simplifyTree);
  let sizes = [...node.sizes];

  // Flatten same-direction nested splits
  const flatChildren: LayoutNode[] = [];
  const flatSizes: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'split' && child.direction === node.direction) {
      // Absorb child's children, scaling their sizes
      for (let j = 0; j < child.children.length; j++) {
        flatChildren.push(child.children[j]);
        flatSizes.push(child.sizes[j] * sizes[i]);
      }
    } else {
      flatChildren.push(child);
      flatSizes.push(sizes[i]);
    }
  }
  children = flatChildren;
  sizes = flatSizes;

  // Single child: unwrap the split
  if (children.length === 1) return children[0];

  // No children (shouldn't happen, but guard)
  if (children.length === 0) return node;

  return { ...node, children, sizes };
}

/**
 * Update the sizes array of the split that is the direct parent of a given groupId.
 */
export function resizeSplitForGroup(
  root: LayoutNode,
  path: number[],
  newSizes: number[],
): LayoutNode {
  if (path.length === 0) {
    if (root.type === 'split') {
      return { ...root, sizes: newSizes };
    }
    return root;
  }

  if (root.type !== 'split') return root;

  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child, i) =>
      i === head ? resizeSplitForGroup(child, rest, newSizes) : child,
    ),
  };
}
