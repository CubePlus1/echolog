# Schedule local review fixes implementation plan

1. Add Web surface-aware error routing and tests for day/overview API failures.
2. Align backend/Web timestamp regexes and add matching valid/invalid fixtures.
3. Append the composite-index migration and Drizzle schema declaration; assert
   migration order and SQL in tests.
4. Run focused Web/backend tests, explicit PostgreSQL integration, then full
   test/typecheck/build and diff review.
5. Update durable specs only if the fixes establish a new convention, commit,
   record the actual hash, and archive this Trellis task.
