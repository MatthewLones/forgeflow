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

  it('handles multiple interrupts sequentially', async () => {
    const watcher = new InterruptWatcher();
    const receivedIds: string[] = [];
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    await watcher.start({
      workspacePath,
      onInterrupt: async (interrupt) => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        receivedIds.push(interrupt.interrupt_id);
        // Small delay to simulate real handler work
        await new Promise((r) => setTimeout(r, 50));
        concurrentCalls--;
        return { decision: 'approve' } as InterruptAnswer;
      },
    });

    // Write two interrupt files with a delay between them
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__multi_1.json'),
      createInterruptFile(makeApprovalInterrupt('multi_1')),
    );

    await new Promise((r) => setTimeout(r, 400));

    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__multi_2.json'),
      createInterruptFile(makeApprovalInterrupt('multi_2')),
    );

    // Give enough time for chokidar's awaitWriteFinish + queue processing
    await new Promise((r) => setTimeout(r, 800));

    expect(receivedIds).toContain('multi_1');
    expect(receivedIds).toContain('multi_2');

    // Verify sequential processing (never more than 1 concurrent handler)
    expect(maxConcurrentCalls).toBe(1);

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

  it('detects child start marker and emits event', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
    });

    await writeFile(
      join(workspacePath, 'output', '__CHILD_START__analyze_coverage.json'),
      JSON.stringify({
        childId: 'analyze_coverage',
        childName: 'Coverage Analysis',
        parentPath: ['coverage_check'],
      }),
    );

    await new Promise((r) => setTimeout(r, 500));

    const startEvent = events.find((e) => e.type === 'child_started');
    expect(startEvent).toBeDefined();
    if (startEvent?.type === 'child_started') {
      expect(startEvent.childId).toBe('analyze_coverage');
      expect(startEvent.childName).toBe('Coverage Analysis');
      expect(startEvent.parentPath).toEqual(['coverage_check']);
    }

    await watcher.stop();
  });

  it('detects child done marker and emits event', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
    });

    await writeFile(
      join(workspacePath, 'output', '__CHILD_DONE__analyze_coverage.json'),
      JSON.stringify({
        childId: 'analyze_coverage',
        childName: 'Coverage Analysis',
        parentPath: ['coverage_check'],
        outputFiles: ['coverage_analysis.json'],
      }),
    );

    await new Promise((r) => setTimeout(r, 500));

    const doneEvent = events.find((e) => e.type === 'child_completed');
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === 'child_completed') {
      expect(doneEvent.childId).toBe('analyze_coverage');
      expect(doneEvent.outputFiles).toEqual(['coverage_analysis.json']);
    }

    await watcher.stop();
  });

  it('emits file_written for regular output files', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
      nodeId: 'test_node',
    });

    // Write a regular JSON output file
    await writeFile(
      join(workspacePath, 'output', 'results.json'),
      '{"data": "test"}',
    );

    await new Promise((r) => setTimeout(r, 500));

    const fileEvent = events.find((e) => e.type === 'file_written');
    expect(fileEvent).toBeDefined();
    if (fileEvent?.type === 'file_written') {
      expect(fileEvent.fileName).toBe('results.json');
      expect(fileEvent.fileSize).toBeGreaterThan(0);
      expect(fileEvent.nodeId).toBe('test_node');
    }

    await watcher.stop();
  });

  it('emits file_written for non-json files', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
      nodeId: 'test_node',
    });

    await writeFile(
      join(workspacePath, 'output', 'report.md'),
      '# Report\n\nThis is a test report.',
    );

    await new Promise((r) => setTimeout(r, 500));

    const fileEvent = events.find((e) => e.type === 'file_written');
    expect(fileEvent).toBeDefined();
    if (fileEvent?.type === 'file_written') {
      expect(fileEvent.fileName).toBe('report.md');
    }

    await watcher.stop();
  });

  it('does not emit file_written for __ANSWER__ files', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => ({ decision: 'approve' } as InterruptAnswer),
      onProgress: (event) => events.push(event),
      nodeId: 'test_node',
    });

    await writeFile(
      join(workspacePath, 'output', '__ANSWER__test_1.json'),
      '{"decision":"approve"}',
    );

    await new Promise((r) => setTimeout(r, 500));

    const fileEvents = events.filter((e) => e.type === 'file_written');
    expect(fileEvents).toHaveLength(0);

    await watcher.stop();
  });

  it('escalates inline interrupt on handler timeout', async () => {
    const watcher = new InterruptWatcher();
    const events: ProgressEvent[] = [];

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        // Simulate a very slow handler (will be timed out)
        await new Promise((r) => setTimeout(r, 5000));
        return { decision: 'approve' } as InterruptAnswer;
      },
      onProgress: (event) => events.push(event),
      nodeId: 'test_node',
      escalateTimeoutMs: 200, // Very short timeout for testing
    });

    const interrupt = makeApprovalInterrupt('escalate_1');
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__escalate_1.json'),
      createInterruptFile(interrupt),
    );

    await new Promise((r) => setTimeout(r, 800));

    // Should be escalated
    expect(watcher.escalated).toBe(true);
    expect(watcher.escalatedInterrupt).not.toBeNull();
    expect(watcher.escalatedInterrupt!.interrupt_id).toBe('escalate_1');

    // Should have written escalated answer
    const answerContent = await readFile(
      join(workspacePath, 'output', '__ANSWER__escalate_1.json'),
      'utf-8',
    );
    const parsedAnswer = JSON.parse(answerContent);
    expect(parsedAnswer.decision).toBe('escalated');
    expect(parsedAnswer.originalInterruptId).toBe('escalate_1');
    expect(parsedAnswer.reason).toBe('timeout');

    // Should have emitted escalation_timeout event
    const escalationEvent = events.find((e) => e.type === 'escalation_timeout');
    expect(escalationEvent).toBeDefined();

    await watcher.stop();
  });

  it('does not escalate when handler responds before timeout', async () => {
    const watcher = new InterruptWatcher();

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        // Fast handler
        return { decision: 'approve' } as InterruptAnswer;
      },
      nodeId: 'test_node',
      escalateTimeoutMs: 5000, // Long timeout
    });

    const interrupt = makeApprovalInterrupt('no_escalate_1');
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__no_escalate_1.json'),
      createInterruptFile(interrupt),
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(watcher.escalated).toBe(false);
    expect(watcher.escalatedInterrupt).toBeNull();

    // Normal answer should be written
    const answerContent = await readFile(
      join(workspacePath, 'output', '__ANSWER__no_escalate_1.json'),
      'utf-8',
    );
    const parsedAnswer = JSON.parse(answerContent);
    expect(parsedAnswer.decision).toBe('approve');

    await watcher.stop();
  });

  it('does not escalate checkpoint-mode interrupts even with timeout', async () => {
    const watcher = new InterruptWatcher();

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { decision: 'approve' } as InterruptAnswer;
      },
      nodeId: 'test_node',
      escalateTimeoutMs: 50, // Very short — but should not trigger for checkpoint mode
    });

    // Create a checkpoint-mode interrupt
    const interrupt: Interrupt = {
      interrupt_id: 'checkpoint_no_escalate',
      type: 'approval',
      source: { agentPath: ['test'], depth: 0 },
      mode: 'checkpoint',
      title: 'Checkpoint Approval',
      context: 'Testing',
      proposal: 'Do something',
      options: ['approve', 'reject'],
    } as Interrupt;

    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__checkpoint_no_escalate.json'),
      createInterruptFile(interrupt),
    );

    await new Promise((r) => setTimeout(r, 500));

    expect(watcher.escalated).toBe(false);

    await watcher.stop();
  });

  it('resets escalation state on stop', async () => {
    const watcher = new InterruptWatcher();

    await watcher.start({
      workspacePath,
      onInterrupt: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { decision: 'approve' } as InterruptAnswer;
      },
      nodeId: 'test_node',
      escalateTimeoutMs: 100,
    });

    const interrupt = makeApprovalInterrupt('reset_test');
    await writeFile(
      join(workspacePath, 'output', '__INTERRUPT__reset_test.json'),
      createInterruptFile(interrupt),
    );

    await new Promise((r) => setTimeout(r, 500));
    expect(watcher.escalated).toBe(true);

    await watcher.stop();

    // After stop, state should be reset
    expect(watcher.escalated).toBe(false);
    expect(watcher.escalatedInterrupt).toBeNull();
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
