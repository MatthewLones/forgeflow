import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dirname, '..', 'dist', 'index.js');
const EXAMPLES_DIR = join(import.meta.dirname, '..', '..', '..', 'examples');

function runCli(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? '') + (err.stderr ?? ''),
      exitCode: err.status ?? 1,
    };
  }
}

describe('CLI', () => {
  it('shows help with no args', () => {
    const { stdout, exitCode } = runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ForgeFlow CLI');
    expect(stdout).toContain('forgeflow run');
    expect(stdout).toContain('forgeflow resume');
  });

  it('shows help with --help', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ForgeFlow CLI');
  });

  it('errors on unknown command', () => {
    const { stdout, exitCode } = runCli(['unknown']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown command');
  });

  it('errors on missing flow-dir', () => {
    const { stdout, exitCode } = runCli(['run']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing required argument');
  });

  it('errors on nonexistent flow-dir', () => {
    const { stdout, exitCode } = runCli(['run', '/nonexistent/path']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Cannot read');
  });

  it('runs simple-summary with --mock', () => {
    const { stdout, exitCode } = runCli([
      'run',
      join(EXAMPLES_DIR, 'simple-summary'),
      '--mock',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Simple Document Summary');
    expect(stdout).toContain('Status: completed');
    expect(stdout).toContain('Success: true');
  });

  it('runs paper-summary with --mock', () => {
    const { stdout, exitCode } = runCli([
      'run',
      join(EXAMPLES_DIR, 'paper-summary'),
      '--mock',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Research Paper Summary');
    expect(stdout).toContain('Status: completed');
  });

  it('runs insurance-claim with --mock and stops at checkpoint', () => {
    const { stdout, exitCode } = runCli([
      'run',
      join(EXAMPLES_DIR, 'insurance-claim'),
      '--mock',
    ]);
    // Should pause at checkpoint (awaiting_input is still success=true)
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Insurance Claim Analysis');
  });

  it('resume errors on missing flow-dir', () => {
    const { stdout, exitCode } = runCli(['resume']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing required argument');
  });

  it('resume errors on missing run-id', () => {
    const { stdout, exitCode } = runCli([
      'resume',
      join(EXAMPLES_DIR, 'insurance-claim'),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing required argument');
  });

  it('resume errors on missing --input', () => {
    const { stdout, exitCode } = runCli([
      'resume',
      join(EXAMPLES_DIR, 'insurance-claim'),
      'fake-run-id',
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing required argument');
  });
});
