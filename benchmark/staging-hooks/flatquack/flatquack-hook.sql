-- Benchmark-hook template for flatquack (modeled on flatquack's
-- templates/csv.sql). Differences from @csv, both driven by the hook
-- contract (benchmark-hook-format CLI mode):
--
--   * input is the exact materializer layout <dataDir>/<ResourceType>.ndjson
--     (no '**' glob — the dataset directory is flat and authoritative);
--   * output goes to the exact file the harness names (via {{fq_out_csv}}),
--     not flatquack's default <output dir>/<view name>.csv.
--
-- fq_input_dir and fq_out_csv arrive per run via --param from the manifest's
-- argv template ({dataDir} / {outCsv}); see hook.json.
{{fq_sql_macros}}

COPY (
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
)

TO '{{fq_out_csv}}'
(FORMAT CSV, DELIMITER ',', HEADER);
