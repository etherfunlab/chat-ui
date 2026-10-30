# chat-ui

Self-hostable web3 LLM interface. A Solana wallet is the account: sign in with
a wallet signature, top up with USDC, and chat with upstream models whose API
key never leaves the server. Conversations live only in your browser. The same
deployment doubles as an OpenAI-compatible API.

> Work in progress. Design doc: `docs/superpowers/specs/2026-10-30-chat-ui-design.md`.

## Development

```bash
bun install
cp .env.example .env   # fill in the blanks
bun run migrate
bun run dev
```

## License

MIT © EtherFun Lab
