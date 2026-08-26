import { describe, it, expect } from 'vitest';
import { ProgressTracker } from '../../src/core/progress';

describe('ProgressTracker', () => {
  it('initializes with zero progress', () => {
    const tracker = new ProgressTracker('tx_123', 1000, 2);
    const p = tracker.getProgress();

    expect(p.totalBytes).toBe(1000);
    expect(p.totalBytesTransferred).toBe(0);
    expect(p.totalFiles).toBe(2);
    expect(p.percentage).toBe(0);
  });

  it('updates progress accurately per chunk', () => {
    const tracker = new ProgressTracker('tx_123', 1000, 2);
    tracker.startFile(0, 'f_1', 'first.txt', 400);

    let p = tracker.recordBytes(200);
    expect(p.currentFileName).toBe('first.txt');
    expect(p.currentFileBytesTransferred).toBe(200);
    expect(p.totalBytesTransferred).toBe(200);
    expect(p.percentage).toBe(20);

    p = tracker.recordBytes(200);
    expect(p.currentFileBytesTransferred).toBe(400);
    expect(p.totalBytesTransferred).toBe(400);
    expect(p.percentage).toBe(40);

    // Switch to second file
    tracker.startFile(1, 'f_2', 'second.txt', 600);
    p = tracker.recordBytes(300);
    expect(p.currentFileName).toBe('second.txt');
    expect(p.currentFileBytesTransferred).toBe(300);
    expect(p.totalBytesTransferred).toBe(700);
    expect(p.percentage).toBe(70);
  });

  it('completes accurately without exceeding 100%', () => {
    const tracker = new ProgressTracker('tx_123', 500, 1);
    tracker.startFile(0, 'f_1', 'single.txt', 500);
    tracker.recordBytes(600); // Exceeds slightly due to chunk bounds

    const p = tracker.complete();
    expect(p.percentage).toBe(100);
    expect(p.totalBytesTransferred).toBe(500);
  });
});
