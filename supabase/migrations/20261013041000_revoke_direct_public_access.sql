-- Minimal API table grants for a clean install.
-- Anon clients use authenticated RPCs; app writes stay on RPCs except for
-- safe profile edits and owner-scoped portfolio items.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM authenticated;

GRANT UPDATE ON TABLE public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.portfolio_items TO authenticated;

-- New tables and functions must receive explicit grants in their migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
