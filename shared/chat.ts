import type { Usage } from './billing'

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type ChatContent = string | (ChatTextPart | ChatImagePart)[]

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: ChatContent
}

/** What the web client sends to /api/chat: a subset of OpenAI chat completions. */
export interface ChatRequestBody {
  model: string
  messages: ChatMessage[]
  stream: true
  reasoning_effort?: string
  venice_parameters?: { enable_web_search: 'on' | 'off', enable_web_citations?: boolean }
}

export interface Citation {
  title: string
  url: string
}

/** Sent by /api/chat as `event: chatui-usage` after settlement, before [DONE]. */
export interface ChatUsageEvent {
  usage: Usage
  costMicro: string
}

export interface ApiErrorBody {
  error: { message: string, type: string, code: string }
}
