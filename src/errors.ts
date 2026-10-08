export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorPayload(error: unknown) {
  const object = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof object.code === 'string' ? object.code : 'internal_error',
    message: error instanceof Error ? error.message : 'Operation failed',
  };
}
