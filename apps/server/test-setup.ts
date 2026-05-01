// Preloaded by bunfig.toml [test].preload — ensures env vars exist
// before any module that depends on @test-evals/env/server is evaluated
// (e.g. @test-evals/db).
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-1234567890-abcdef";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
process.env.CORS_ORIGIN ||= "http://localhost:3101";
process.env.ANTHROPIC_API_KEY ||= "sk-test";
// Tests never connect to a real Postgres — skip the startup migration so we
// don't try to spawn drizzle-kit or open a real connection.
process.env.AUTO_MIGRATE = "false";
