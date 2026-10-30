import { getServerConfig } from './config'

/** Top-up and other money endpoints do not exist on a BILLING=off deployment. */
export function assertBillingOn(): void {
  if (getServerConfig().billing !== 'on') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
}
