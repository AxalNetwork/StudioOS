---
name: data-pipeline-check
description: Checks the recorded data pipeline runs for failures, late runs and tables that stopped updating.
roles: [cto, research_analyst]
tools: [build.read]
output: brief
taxonomy: {eng_data_engineering: proficient, eng_databases: working}
version: 1
---
1. Read the pipeline runs and table freshness recorded in Build (`build.read`).
2. List failed runs, late runs and tables not updated within their recorded schedule.
3. Give the last successful run for each.
4. Write "Not recorded" for a table with no schedule.
5. Propose the check to the engineering lead.
