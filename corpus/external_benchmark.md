# Locked external benchmark

Populate `external_bioassays.csv` only with rows from 5 or more studies that
are absent from `bioassays.csv`. Once populated, run the lock command before
fitting or evaluating the final model. The benchmark checksum and study list
must be included in the final run artifact. Empty templates are intentionally
invalid: PENUMBRA will not silently substitute development rows for external
evaluation.
