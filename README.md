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
cp .env.example .env
npm run infra:up
npm run dev:api
```

Populate the ignored `.env` file with local credentials before starting the
web app. `npm run dev:web` and `npm run dev:api` load it automatically, so
there is no need to re-export values in each new terminal. Keep `AUTH_SECRET`
and `FORGEFLOW_INTERNAL_API_SECRET` stable locally: the web and API must share
the latter, and changing the former invalidates active browser sessions.
The web command explicitly uses port `3000`; `PORT=3001` in `.env` is reserved
for the API.

Start the analyst web app separately with:

```sh
npm run dev:web
```

Start a local worker in a third terminal to claim and execute persisted
workflow tasks:

```sh
npm run dev:worker
```

The worker requires the explicit live SEC settings in local `.env` before it
can retrieve company evidence:

```dotenv
SEC_EDGAR_LIVE_ENABLED=true
SEC_EDGAR_USER_AGENT="ForgeFlow Intelligence analyst@example.com"
```

Use a real contact email that you control. Market data remains explicitly
unavailable until a licensed provider is approved.

The local API health endpoint is `http://localhost:3001/health`. PostgreSQL
(`15432`) and Redis (`16379`) are intentionally bound to loopback-only ports
and use development-only credentials defined in [`.env.example`](.env.example).
