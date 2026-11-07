import { prepareResponses } from './prepareResponses'
import type { Protocol } from './protocol'
import { citationsFromResponses, outputTextFromResponses, reportedCostFromResponses, responsesEnd, usageFromResponses } from './responsesUsage'

/** OpenAI Responses API, as served by the upstream. Usage rides in the completed event, so every payload is forwarded. */
export const responsesProtocol: Protocol = {
  endpoint: 'responses',
  upstreamPath: '/responses',
  prepare: prepareResponses,
  setMaxOutput: (body, n) => { body.max_output_tokens = n },
  usage: usageFromResponses,
  reportedCost: reportedCostFromResponses,
  citations: citationsFromResponses,
  outputText: outputTextFromResponses,
  end: responsesEnd,
  isUsageOnly: () => false,
}
