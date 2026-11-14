# Observer metadata migrations

The timestamped D5676 migration creates only independent batch/canary metadata. Apply it to the owner-approved observer database during its separate rollout. It is never applied to the main customer database by the site deployment. Add new immutable timestamp/issue migrations; do not edit an applied migration or infer an archive lifecycle from these tables.
