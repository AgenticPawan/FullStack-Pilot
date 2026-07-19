---
id: always-agent-routing
title: Agent Routing & Tool Order
appliesTo: always
severity: enforce
standard: InternalPolicy
---

## MCP-First Tool Order

Always prefer MCP tools before file reads.

| Need | MCP Tool | Fallback |
|------|----------|---------|
| Microsoft / Azure docs | `microsoft_docs_search` → `microsoft_docs_fetch` | — |
| Code samples | `microsoft_code_sample_search` | — |
| Any codebase context | MCP read → Grep → Glob → Read (narrowest scope first) | — |

Never scan entire directories to find a single symbol when a targeted Grep can do it in one call.

## Subagent Routing Policy

- Use subagents for **parallel independent research** and **context isolation** (keeping the main window clean).
- Do NOT spawn a subagent for a single-step lookup — a direct tool call is faster.
- Assign **one task per subagent**. Mixed-task subagents produce unfocused results.
- Route to the specialist listed in AGENTS.md; do not use a generalist when a domain expert is available.
- After spawning, do not also perform the same search yourself — trust the agent's result.

## Skill Load Order

Load skills before starting any implementation or review:
1. Check `.claude/pilot/stack-profile.json` to know which stacks are active.
2. Load domain skill(s) for the task at hand.
3. Load `api-design-standards` if the work touches a REST or gRPC boundary.
4. Load `architecture-decision-records` before overriding a default that may have an ADR.

Never start implementation without checking whether a relevant skill exists.

## Autonomous Loop Cap

Any autonomous fix or build loop is capped at **10 iterations**. At cap:
- Stop immediately.
- Report: what was fixed, what remains, next recommended action.
- Write `.claude/loop-stopped.md` with iteration count and remaining issues.
- Do not retry without a new user instruction.

## Hard Safety Rules

1. Never force-push (`git push --force`). The bash-guard hook blocks it; do not attempt bypass.
2. Never change live environments. All changes produce a branch; deployment requires human approval.
3. Never silently return a degraded result when a read budget is exhausted — stop and state what is needed.
4. Pipeline artifacts (specs, plans, QA reports) are files under `.claude/pilot/`, never chat content.
