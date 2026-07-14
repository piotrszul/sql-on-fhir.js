-- Body-only flatquack template for the internal DuckDB-session benchmark
-- (design.md add-measurement-plans D7). Emits ONLY the SELECT: no macro block
-- (defined once per session from flatquack-macros.sql, untimed) and no COPY TO
-- wrapper, so the session hook can wrap it in
--   CREATE OR REPLACE TEMP TABLE _sink AS ( ... )
-- with load + execute inside the timed region and CSV serialization excluded
-- (extract, if used, is a separate untimed verb). Input is the exact flat
-- materializer layout <input dir>/<ResourceType>.ndjson; the input dir arrives
-- per compile via --param (constant across a run, so the SQL is memoized).
-- NOTE: flatquack substitutes its double-brace tokens everywhere, including
-- inside comments, so this prose names no such token literally.
WITH transformed AS (
	SELECT {{fq_sql_transform_expression}} AS result
	FROM read_json_auto(
		'{{fq_input_dir}}/{{fq_vd_resource}}.ndjson'
		{{fq_sql_input_schema}}
	)
	{{fq_where_filter}}
)
SELECT {{fq_sql_flattening_cols}}
FROM transformed
{{fq_sql_flattening_tables}}
