import { describe, it, expect } from 'vitest';
import { topologicalSort } from '../src/graph.js';

describe('topologicalSort', () => {
  it('sorts a linear chain', () => {
    const result = topologicalSort(['a', 'b', 'c'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted).toEqual(['a', 'b', 'c']);
  });

  it('sorts a diamond pattern (fan-out/fan-in)', () => {
    const result = topologicalSort(['a', 'b', 'c', 'd'], [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ]);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted[0]).toBe('a');
    expect(result.sorted[3]).toBe('d');
    // b and c can be in either order
    expect(result.sorted.slice(1, 3).sort()).toEqual(['b', 'c']);
  });

  it('detects a simple cycle', () => {
    const result = topologicalSort(['a', 'b', 'c'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ]);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('detects a self-loop', () => {
    const result = topologicalSort(['a', 'b'], [
      { from: 'a', to: 'a' },
      { from: 'a', to: 'b' },
    ]);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('a');
  });

  it('handles a single node with no edges', () => {
    const result = topologicalSort(['a'], []);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted).toEqual(['a']);
  });

  it('handles multiple disconnected nodes', () => {
    const result = topologicalSort(['a', 'b', 'c'], []);
    expect(result.hasCycle).toBe(false);
    expect(result.sorted.sort()).toEqual(['a', 'b', 'c']);
  });
});
