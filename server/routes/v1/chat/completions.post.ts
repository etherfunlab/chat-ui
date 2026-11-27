import { relayChat } from '#server/utils/relay'
import { relayV1 } from '#server/utils/v1'

/** OpenAI chat completions, metered against the key's wallet. */
export default defineEventHandler(event => relayV1(event, relayChat))
