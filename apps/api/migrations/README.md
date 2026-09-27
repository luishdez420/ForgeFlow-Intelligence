# Database migrations

Migration files are immutable, ordered SQL files. They run transactionally
against PostgreSQL and are recorded by the migration runner introduced with the
workflow persistence implementation. Until then, validate a clean database
locally with:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/001_initial_schema.sql
```

Never edit an applied migration. Add a new, ordered file for every schema
change, including indexes and constraints.
