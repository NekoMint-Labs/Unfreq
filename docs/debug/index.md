# Debug Playbooks

Short local notes for recurring investigation paths.

## Hot Paths

- [Provider config](./provider-config.md)
- [Signal send chain](./signal-send-chain.md)
- [Galaxy interaction](./galaxy-interaction.md)
- [AI provider fallback](./ai-provider-fallback.md)

## Rules

- Start from the route or UI entry listed in each playbook.
- Follow the state flow before changing code.
- Check structured logs for `action`, `requestId`, `targetId`, and AI failure fields.
- Do not paste API keys, seed text, expanded text, or raw provider payloads into notes or logs.
