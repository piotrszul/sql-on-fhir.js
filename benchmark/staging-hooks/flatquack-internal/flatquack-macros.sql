-- Macros-only flatquack template: emits just flatquack's macro block
-- (as_list, ifnull2, as_value, ...). The session hook compiles this ONCE at
-- start-up and runs the resulting CREATE OR REPLACE MACRO statements untimed, so
-- the per-sample timed region never pays macro-definition cost. View-independent,
-- but flatquack requires a view path, so the hook compiles it against the case's
-- own view. NOTE: flatquack substitutes its double-brace tokens everywhere,
-- including inside comments, so this prose names no such token literally.
{{fq_sql_macros}}
