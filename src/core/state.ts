import { EventEmitter } from 'events';
import { TransferState, ErrorCode } from './types';

export interface StateChangeEvent {
  previousState: TransferState;
  currentState: TransferState;
  reason?: string;
  errorCode?: ErrorCode;
  timestamp: number;
}

// Valid transitions mapping
const VALID_TRANSITIONS: Record<TransferState, TransferState[]> = {
  IDLE: ['FILES_SELECTED', 'SERVER_STARTING'],
  FILES_SELECTED: ['IDLE', 'SERVER_STARTING'],
  SERVER_STARTING: ['WAITING_FOR_RECEIVER', 'FAILED', 'CANCELLED', 'SHUTDOWN'],
  WAITING_FOR_RECEIVER: ['RECEIVER_CONNECTED', 'EXPIRED', 'CANCELLED', 'FAILED', 'SHUTDOWN'],
  RECEIVER_CONNECTED: ['RECEIVER_CONFIRMED', 'TRANSFERRING', 'CANCELLED', 'FAILED', 'SHUTDOWN'],
  RECEIVER_CONFIRMED: ['TRANSFERRING', 'CANCELLED', 'FAILED', 'SHUTDOWN'],
  TRANSFERRING: ['COMPLETED', 'CANCELLED', 'FAILED', 'SHUTDOWN'],
  COMPLETED: ['SHUTDOWN', 'IDLE'],
  CANCELLED: ['SHUTDOWN', 'IDLE'],
  FAILED: ['SHUTDOWN', 'IDLE'],
  EXPIRED: ['SHUTDOWN', 'IDLE'],
  SHUTDOWN: ['IDLE']
};

export class TransferStateMachine extends EventEmitter {
  private _state: TransferState = 'IDLE';
  private _lastError?: { code: ErrorCode; message: string };

  constructor(initialState: TransferState = 'IDLE') {
    super();
    this._state = initialState;
  }

  public get state(): TransferState {
    return this._state;
  }

  public get lastError(): { code: ErrorCode; message: string } | undefined {
    return this._lastError;
  }

  /**
   * Checks if a transition to the target state is allowed
   */
  public canTransitionTo(targetState: TransferState): boolean {
    if (this._state === targetState) {
      return true; // No-op transition
    }
    const allowed = VALID_TRANSITIONS[this._state];
    return allowed ? allowed.includes(targetState) : false;
  }

  /**
   * Transitions to a new state and emits an event
   */
  public transitionTo(
    targetState: TransferState,
    opts?: { reason?: string; errorCode?: ErrorCode }
  ): boolean {
    if (this._state === targetState) {
      return true;
    }

    if (!this.canTransitionTo(targetState)) {
      const err = new Error(
        `Invalid state transition from '${this._state}' to '${targetState}'`
      );
      this.emit('error', err);
      return false;
    }

    const previousState = this._state;
    this._state = targetState;

    if (opts?.errorCode) {
      this._lastError = {
        code: opts.errorCode,
        message: opts.reason || opts.errorCode
      };
    } else if (targetState === 'IDLE' || targetState === 'SERVER_STARTING') {
      this._lastError = undefined;
    }

    const event: StateChangeEvent = {
      previousState,
      currentState: targetState,
      reason: opts?.reason,
      errorCode: opts?.errorCode,
      timestamp: Date.now()
    };

    this.emit('stateChange', event);
    this.emit(targetState.toLowerCase(), event);

    return true;
  }

  public reset(): void {
    this._state = 'IDLE';
    this._lastError = undefined;
    this.emit('reset');
  }
}
