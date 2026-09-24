export class PolicyDeniedError extends Error {
  constructor(
    message: string,
    readonly decision: unknown
  ) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

export class ApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly decision: unknown
  ) {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

export class ConcurrentExecutionError extends Error {
  constructor(message = 'Another execution of this plan is already in progress') {
    super(message);
    this.name = 'ConcurrentExecutionError';
  }
}

export class DuplicateExecutionError extends Error {
  constructor(message = 'This execution key has already completed') {
    super(message);
    this.name = 'DuplicateExecutionError';
  }
}
