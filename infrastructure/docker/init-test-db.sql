-- Runs once when the local Postgres container is first created.
-- Creates a separate database for automated integration tests.
CREATE DATABASE gameverse_test OWNER gameverse;
