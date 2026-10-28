# kes beaux innovateisses

Учебный прототип для показа демонстрационных станций мониторинга, графиков, сценариев риска и журнала предупреждений. Сайт не обнаруживает реальные пожары и не предназначен для принятия решений о безопасности.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/firewatch-ai` — русскоязычный веб-интерфейс.
- `artifacts/api-server` — API и серверный пересчёт рисков.
- `lib/api-spec/openapi.yaml` — исходный контракт API.
- `data/firewatch.sqlite` — локальная SQLite-база с демонстрационными станциями, измерениями и предупреждениями.

## Architecture decisions

- Риск вычисляется на сервере по формуле из задания; интерфейс показывает полученный результат.
- Браузерный симулятор отправляет новые показания в Express API каждые 15 секунд; API проверяет диапазоны, записывает их в SQLite и рассчитывает риск.
- Начальные данные и сценарии полностью демонстрационные.

## Product

Панель показывает текущие показатели и риски станций, историю измерений и журнал предупреждений. Можно управлять станциями, отмечать предупреждения обработанными и запускать обычный, опасный, приостановленный или сброшенный сценарий.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
