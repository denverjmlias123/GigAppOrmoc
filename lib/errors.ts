import { strings, mapSqlErrorToFriendlyMessage } from '../constants/strings';
import * as Crypto from 'expo-crypto';

type AppErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation'
  | 'server'
  | 'unknown';

export interface AppError {
  kind: AppErrorKind;
  title: string;
  message: string;
  retryable: boolean;
  requestId: string;
  field?: string;
  action?: 'login' | 'resend_confirmation' | 'switch_mode' | 'refresh' | 'retry';
  retryAfterSeconds?: number;
  alreadyDone?: boolean;
}

export function createRequestId(): string {
  return Crypto.randomUUID();
}

/**
 * Classifies any thrown error (Supabase PostgREST, Auth, Storage, Fetch/Abort, or validation Error)
 * into a structured AppError with a safe, human-readable message from constants/strings.ts.
 */
export function toAppError(err: unknown, fallbackMessage: string = strings.errors.generic): AppError {
  if (err && typeof err === 'object' && 'kind' in err && 'requestId' in err && 'retryable' in err) {
    return err as AppError;
  }

  const requestId =
    typeof (err as any)?.requestId === 'string' && (err as any).requestId
      ? (err as any).requestId
      : createRequestId();

  const rawMessage =
    typeof err === 'string'
      ? err
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : '';
  const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
  const status = typeof (err as any)?.status === 'number' ? (err as any).status : 0;
  const name = typeof (err as any)?.name === 'string' ? (err as any).name : '';
  const field = typeof (err as any)?.field === 'string' ? (err as any).field : undefined;
  const lower = rawMessage.toLowerCase();

  const message = mapSqlErrorToFriendlyMessage(err, fallbackMessage);

  // 1. Offline
  if (
    code === 'OFFLINE' ||
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('networkerror') ||
    lower.includes('offline') ||
    lower.includes('internet connection')
  ) {
    return {
      kind: 'offline',
      title: 'No Internet Connection',
      message: lower.includes('offline') && rawMessage.includes("Changes can't")
        ? rawMessage
        : strings.errors.network,
      retryable: true,
      requestId,
      action: 'retry',
    };
  }

  // 2. Timeout
  if (
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'TIMEOUT' ||
    code === '57014' ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return {
      kind: 'timeout',
      title: 'Request Timed Out',
      message: strings.errors.timeout,
      retryable: true,
      requestId,
      action: 'retry',
    };
  }

  // 3. Session expired
  if (
    code === 'SESSION_EXPIRED' ||
    code === 'PGRST301' ||
    status === 401 ||
    lower.includes('jwt expired') ||
    lower.includes('invalid jwt') ||
    lower.includes('refresh_token_not_found') ||
    lower.includes('session_not_found') ||
    lower.includes('session expired')
  ) {
    return {
      kind: 'session_expired',
      title: 'Session Expired',
      message: strings.errors.sessionExpired,
      retryable: false,
      requestId,
      action: 'login',
    };
  }

  // 4. Unauthorized / Login credentials / Email not confirmed
  if (
    code === 'EMAIL_NOT_CONFIRMED' ||
    code === 'email_not_confirmed' ||
    lower.includes('email not confirmed') ||
    lower.includes('confirm your email')
  ) {
    return {
      kind: 'unauthorized',
      title: 'Email Not Confirmed',
      message: strings.errors.emailNotConfirmed,
      retryable: false,
      requestId,
      field: 'email',
      action: 'resend_confirmation',
    };
  }

  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid_credentials') ||
    lower.includes('wrong password') ||
    lower.includes('incorrect email or password') ||
    lower.includes('not authenticated') ||
    lower.includes('authentication required')
  ) {
    return {
      kind: 'unauthorized',
      title: 'Sign-In Required',
      message,
      retryable: false,
      requestId,
      action: lower.includes('not authenticated') ? 'login' : undefined,
    };
  }

  // 5. Rate limited (429 / RPC limit / cooldown)
  if (
    status === 429 ||
    code === 'RATE_LIMITED' ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('too many attempts') ||
    lower.includes('too many tries') ||
    lower.includes('for security purposes, you can only request this after') ||
    lower.includes('per 24 hours') ||
    lower.includes('per hour')
  ) {
    const waitMatch = rawMessage.match(/(\d+)\s*second/i);
    const retryAfterSeconds = waitMatch
      ? parseInt(waitMatch[1], 10)
      : typeof (err as any)?.retryAfterSeconds === 'number'
      ? (err as any).retryAfterSeconds
      : 30;
    return {
      kind: 'rate_limited',
      title: 'Too Many Attempts',
      message,
      retryable: true,
      requestId,
      retryAfterSeconds,
    };
  }

  // 6. Forbidden / Wrong Mode / Suspended Account
  if (
    status === 403 ||
    code === '42501' ||
    code === 'FORBIDDEN' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('access denied') ||
    lower.includes('account is not active') ||
    lower.includes('suspended') ||
    lower.includes('deactivated') ||
    lower.includes('must be in hire') ||
    lower.includes('must be in find work') ||
    lower.includes('only be added in find work') ||
    lower.includes('only be modified in find work') ||
    lower.includes('only be saved in hire') ||
    lower.includes('only the ')
  ) {
    const isModeError =
      lower.includes('hire') || lower.includes('find work') || lower.includes('mode');
    return {
      kind: 'forbidden',
      title: 'Action Not Allowed',
      message,
      retryable: false,
      requestId,
      action: isModeError ? 'switch_mode' : undefined,
    };
  }

  // 7. Not Found
  if (
    status === 404 ||
    code === 'PGRST116' ||
    code === 'NOT_FOUND' ||
    lower.includes('not found') ||
    lower.includes('no rows')
  ) {
    return {
      kind: 'not_found',
      title: 'Not Found',
      message,
      retryable: false,
      requestId,
    };
  }

  // 8. Conflict / Stale State / Already Done
  if (
    status === 409 ||
    code === '23505' ||
    code === 'CONFLICT' ||
    code === 'ALREADY_DONE' ||
    Boolean((err as any)?.alreadyDone) ||
    lower.includes('duplicate key value') ||
    lower.includes('unique constraint') ||
    lower.includes('already_done') ||
    lower.includes('already updated') ||
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('already submitted') ||
    lower.includes('already been')
  ) {
    const alreadyDone =
      code === 'ALREADY_DONE' ||
      Boolean((err as any)?.alreadyDone) ||
      lower.includes('already_done') ||
      lower.includes('other device');
    return {
      kind: 'conflict',
      title: alreadyDone ? 'Already Completed' : 'Already Updated',
      message: alreadyDone ? strings.errors.alreadyDoneOtherDevice : message,
      retryable: false,
      requestId,
      alreadyDone,
      action: 'refresh',
    };
  }

  // 9. Server Error
  if (
    status >= 500 ||
    code === 'SERVER_ERROR' ||
    /^PGRST\d+/i.test(code) ||
    /^(53|54|55|57|58|XX)\w{3}$/i.test(code) ||
    lower.includes('internal server error') ||
    lower.includes('syntax error at or near') ||
    lower.includes('relation "') ||
    lower.includes('column "')
  ) {
    return {
      kind: 'server',
      title: 'Server Error',
      message: strings.errors.serverError,
      retryable: true,
      requestId,
      action: 'retry',
    };
  }

  // 10. Validation Error
  if (
    field ||
    code === 'VALIDATION_ERROR' ||
    code === '23514' ||
    code === '22P02' ||
    lower.includes('must be') ||
    lower.includes('required') ||
    lower.includes('invalid') ||
    lower.includes('cannot') ||
    lower.includes('at least') ||
    lower.includes('between') ||
    lower.includes('maximum') ||
    lower.includes('minimum') ||
    lower.includes('too large') ||
    lower.includes('unsupported file')
  ) {
    return {
      kind: 'validation',
      title: 'Check Your Input',
      message,
      retryable: false,
      requestId,
      field,
    };
  }

  return {
    kind: 'unknown',
    title: 'Something Went Wrong',
    message,
    retryable: true,
    requestId,
  };
}
