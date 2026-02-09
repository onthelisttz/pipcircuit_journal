/**
 * Retry Logic Utilities
 *
 * Implements exponential backoff retry strategy for failed operations
 */

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Multiplier for exponential backoff */
  multiplier?: number;
  /** Whether to retry on specific error types */
  retryCondition?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  multiplier: 2,
  retryCondition: () => true, // Retry on all errors by default
};

/**
 * Calculate delay for retry attempt using exponential backoff
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const delay = options.initialDelay * Math.pow(options.multiplier, attempt - 1);
  return Math.min(delay, options.maxDelay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry this error
      if (!opts.retryCondition(lastError)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt,
        };
      }

      // Don't wait after last attempt
      if (attempt < opts.maxAttempts) {
        const delay = calculateDelay(attempt, opts);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
  };
}

/**
 * Retry condition for network errors (retry on network failures)
 */
export function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    "network",
    "fetch",
    "timeout",
    "connection",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
  ];
  const message = error.message.toLowerCase();
  return networkErrorMessages.some((keyword) => message.includes(keyword));
}

/**
 * Retry condition for rate limit errors (retry after delay)
 */
export function isRateLimitError(error: Error): boolean {
  const rateLimitMessages = ["rate limit", "429", "too many requests"];
  const message = error.message.toLowerCase();
  return rateLimitMessages.some((keyword) => message.includes(keyword));
}

/**
 * Retry condition for server errors (5xx) - retry
 */
export function isServerError(error: Error): boolean {
  const serverErrorMessages = ["500", "502", "503", "504", "server error"];
  const message = error.message.toLowerCase();
  return serverErrorMessages.some((keyword) => message.includes(keyword));
}

/**
 * Default retry condition: retry on network, rate limit, and server errors
 */
export function defaultRetryCondition(error: Error): boolean {
  return isNetworkError(error) || isRateLimitError(error) || isServerError(error);
}
