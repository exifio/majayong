# Majayong Backend

Express 5, TypeScript, Prisma, and PostgreSQL application.

## Development

```bash
npm ci
cp .env.example .env
npm run db:generate
npm run db:validate
npm run build
npm start
```

Set local values in `.env` before starting the server. Use a dedicated test database for tests; never point destructive tests at a shared or production database.

## Checks

```bash
npm run test:typecheck
npm run typecheck
npm run build
npm run db:validate
```
