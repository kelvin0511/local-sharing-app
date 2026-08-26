import { describe, it, expect } from 'vitest';
import { TransferStateMachine } from '../../src/core/state';

describe('TransferStateMachine', () => {
  it('initializes with default IDLE state', () => {
    const fsm = new TransferStateMachine();
    expect(fsm.state).toBe('IDLE');
  });

  it('handles valid state transitions smoothly', () => {
    const fsm = new TransferStateMachine();
    const transitions: string[] = [];

    fsm.on('stateChange', (e) => {
      transitions.push(`${e.previousState} -> ${e.currentState}`);
    });

    expect(fsm.transitionTo('FILES_SELECTED')).toBe(true);
    expect(fsm.transitionTo('SERVER_STARTING')).toBe(true);
    expect(fsm.transitionTo('WAITING_FOR_RECEIVER')).toBe(true);
    expect(fsm.transitionTo('RECEIVER_CONNECTED')).toBe(true);
    expect(fsm.transitionTo('RECEIVER_CONFIRMED')).toBe(true);
    expect(fsm.transitionTo('TRANSFERRING')).toBe(true);
    expect(fsm.transitionTo('COMPLETED')).toBe(true);
    expect(fsm.transitionTo('SHUTDOWN')).toBe(true);

    expect(transitions).toEqual([
      'IDLE -> FILES_SELECTED',
      'FILES_SELECTED -> SERVER_STARTING',
      'SERVER_STARTING -> WAITING_FOR_RECEIVER',
      'WAITING_FOR_RECEIVER -> RECEIVER_CONNECTED',
      'RECEIVER_CONNECTED -> RECEIVER_CONFIRMED',
      'RECEIVER_CONFIRMED -> TRANSFERRING',
      'TRANSFERRING -> COMPLETED',
      'COMPLETED -> SHUTDOWN'
    ]);
  });

  it('rejects invalid state transitions and records error', () => {
    const fsm = new TransferStateMachine('IDLE');
    let errorEmitted = false;

    fsm.on('error', () => {
      errorEmitted = true;
    });

    // IDLE cannot directly jump to COMPLETED
    expect(fsm.canTransitionTo('COMPLETED')).toBe(false);
    expect(fsm.transitionTo('COMPLETED')).toBe(false);
    expect(errorEmitted).toBe(true);
    expect(fsm.state).toBe('IDLE');
  });

  it('supports error transitions with reason and code', () => {
    const fsm = new TransferStateMachine('TRANSFERRING');
    const result = fsm.transitionTo('FAILED', {
      reason: 'Disk full on receiver',
      errorCode: 'DISK_FULL'
    });

    expect(result).toBe(true);
    expect(fsm.state).toBe('FAILED');
    expect(fsm.lastError).toEqual({
      code: 'DISK_FULL',
      message: 'Disk full on receiver'
    });
  });
});
