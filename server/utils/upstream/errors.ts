import type { ApiErrorBody } from '#shared/chat'

/** A request the relay refuses; mapped to an OpenAI-shaped error response. */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RelayError'
  }
}

const TYPE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  402: 'insufficient_quota',
  403: 'permission_error',
  413: 'invalid_request_error',
  429: 'rate_limit_error',
}

export function errorResponse(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { message, type: TYPE_BY_STATUS[status] ?? 'api_error', code } }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
