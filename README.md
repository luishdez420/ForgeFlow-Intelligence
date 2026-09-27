# ForgeFlow Intelligence

ForgeFlow Intelligence is a provenance-first company intelligence platform. Its
MVP accepts one US public-company ticker, runs a durable analysis workflow, and
publishes a report that separates retrieved facts, deterministic calculations,
AI-generated analysis, and unavailable information.

It is deliberately not an investment advisor, trading system, or general agent
platform yet. The product and engineering boundaries are defined in
[the MVP architecture](docs/architecture.md).

## Documentation

- [MVP architecture and scope](docs/architecture.md)
- [Workflow-engine design](docs/workflow-engine.md)
- [Data model](docs/data-model.md)
- [Architecture decision records](docs/adr/)

## Development status

The repository is in Phase 1: local foundations. GitHub issues
[#1](https://github.com/luishdez420/ForgeFlow-Intelligence/issues/1) through
[#4](https://github.com/luishdez420/ForgeFlow-Intelligence/issues/4) establish
the reviewed architecture, monorepo, and local dependencies.

## Local development

Prerequisites: Node.js 22+, Python 3.12+, and Docker Desktop.

```sh
npm install
npm run infra:up
npm run dev:api
```

The local API health endpoint is `http://localhost:3001/health`. PostgreSQL
(`15432`) and Redis (`16379`) are intentionally bound to loopback-only ports
and use development-only credentials defined in [`.env.example`](.env.example).
