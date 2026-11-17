-- Bank facets distinguish a missing assignment inside a run from questions never included.
CREATE INDEX enrichment_run_items_bank_lookup_idx
  ON bank_enrichment_run_items(tenant_id, scheme_id, question_id);
