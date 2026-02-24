import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Interrupt, InterruptAnswer, ProgressEvent } from '../../types/src/index.js';
import { InterruptWatcher } from '../src/interrupt-watcher.js';

let workspacePath: string;

beforeEach(async () => {
  workspacePath = join(tmpdir(), `forgeflow-interrupt-test-${randomUUID()}`);
  await mkdir(join(workspacePath, 'output'), { recursive: true });
});

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

function createInterruptFile(interrupt: Interrupt): string {
  return JSON.stringify(interrupt, null, 2);
}

function makeApprovalInterrupt(id: string): Interrupt {
  return {
    interrupt_id: id,
    type: 'approval',
    source: { agentPath: ['test_agent'], depth: 0 },
    mode: 'inline',
    title: 'Test Approval',
    context: 'Testing interrupt watcher',
    proposal: 'Do something',
    options: ['approve', 'reject'],
  } as Interrupt;
}

describe('InterruptWatcher', () => {
  it('detects an interrupt file and calls handler', async () => {
    const watcher = new InterruptWatcher();
    const interrupt = makeApprovalInterrupt('test_1');
    const answer: InterruptAnswer = { decision: 'approve' };

    let handlerCalled = false;

    await watcher.start({
      workspacePath,
      onInterrupt: async (received) => {
        handlerCalled = true;
        expect(received.interrupt_id).toBe('test_1');
        expect(received.type).toBe('approval');
        return answer;
      },
    });

    // Write interrupt file
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__test_1.json'),
      createInterruptFile(interrupt),
    );

    // Wait for watcher to process
    await new Promise((r) => setTimeout(r, 500));

    expect(handlerCalled).toBe(true);

    // Verify answer file was written
    const answerContent = await readFile(
      join(workspacePath, 'output', '__ANSWER__test_1.json'),
      'utf-8',
    );
    const parsedAnswer = JSON.parse(answerContent);
    expect(parsedAnswer.decision).toBe('approve');

    await watcher.stop();
  });

  it('emits interrupt progress event', async () => {
    const watcher = new InterruptWatcher();
    const interrupt = makeApprovalInterrupt('test_2');
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
    });

    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__test_2.json'),
      createInterruptFile(interrupt),
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(events.some((e) => e.type === 'interrupt')).toBe(true);
    const interruptEvent = events.find((e) => e.type === 'interrupt');
    if (interruptEvent?.type === 'interrupt') {
      expect(interruptEvent.interrupt.interrupt_id).toBe('test_2');
    }

    await watcher.stop();
  });

  it('ignores non-interrupt files', async () => {
    const watcher = new InterruptWatcher();
    let handlerCalled = false;

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        handlerCalled = true;
        return { decision: 'approve' } as InterruptAnswer;
      },
    });

    // Write a normal output file
    await writeFile(
      join(workspacePath, 'output', 'results.json'),
      '{"data": "test"}',
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(handlerCalled).toBe(false);

    await watcher.stop();
  });

  it('ignores non-json interrupt files', async () => {
    const watcher = new InterruptWatcher();
    let handlerCalled = false;

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        handlerCalled = true;
        return { decision: 'approve' } as InterruptAnswer;
      },
    });

    // Write an interrupt file that's not JSON
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__test.txt'),
      'not json',
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(handlerCalled).toBe(false);

    await watcher.stop();
  });

  it('handles multiple interrupts', async () => {
    const watcher = new InterruptWatcher();
    const receivedIds: string[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async (interrupt) => {
        receivedIds.push(interrupt.interrupt_id);
        return { decision: 'approve' } as InterruptAnswer;
      },
    });

    // Write two interrupt files with a small delay between them
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__multi_1.json'),
      createInterruptFile(makeApprovalInterrupt('multi_1')),
    );

    await new Promise((r) => setTimeout(r, 400));

    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__multi_2.json'),
      createInterruptFile(makeApprovalInterrupt('multi_2')),
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(receivedIds).toContain('multi_1');
    expect(receivedIds).toContain('multi_2');

    // Verify both answer files exist
    const answer1 = await readFile(
      join(workspacePath, 'output', '__ANSWER__multi_1.json'),
      'utf-8',
    );
    const answer2 = await readFile(
      join(workspacePath, 'output', '__ANSWER__multi_2.json'),
      'utf-8',
    );
    expect(JSON.parse(answer1).decision).toBe('approve');
    expect(JSON.parse(answer2).decision).toBe('approve');

    await watcher.stop();
  });

  it('handles malformed JSON gracefully', async () => {
    const watcher = new InterruptWatcher();
    let handlerCalled = false;

    // Suppress console.error for this test
    const originalError = console.error;
    console.error = () => {};

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        handlerCalled = true;
        return { decision: 'approve' } as InterruptAnswer;
      },
    });

    // Write a malformed JSON interrupt file
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__bad.json'),
      '{not valid json',
    );

    await new Promise((r) => setTimeout(r, 500));

    // Handler should not have been called (error caught before handler)
    expect(handlerCalled).toBe(false);

    console.error = originalError;
    await watcher.stop();
  });

  it('stops cleanly', async () => {
    const watcher = new InterruptWatcher();

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
    });

    await watcher.stop();

    // Write interrupt after stop — should not be processed
    let handlerCalled = false;
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__after_stop.json'),
      createInterruptFile(makeApprovalInterrupt('after_stop')),
    );

    await new Promise((r) => setTimeout(r, 300));
    expect(handlerCalled).toBe(false);
  });
});
