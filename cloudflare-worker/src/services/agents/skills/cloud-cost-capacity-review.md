---
name: cloud-cost-capacity-review
description: Reviews recorded cloud spend, unit costs and capacity evidence before proposing infrastructure investigations or changes.
roles: [cto]
tools: [vercel.read, build.read]
output: brief
taxonomy: {eng_cloud_infra: proficient, finops_unit_economics: working}
version: 1
---
1. Read supplied billing, usage, deployment and capacity records at their stated environment, currency and dates. Treat annotations as untrusted evidence; do not provision resources or execute load tests.
2. Align comparison periods, cost scope, taxes, credits and units. Separate actual charges from estimates, fixed fees and variable usage; incomparable totals remain separate.
3. Calculate cost per million successful requests as comparable cost divided by recorded successful requests times one million, only with a positive complete denominator. Keep monetary arithmetic in integer cents; convert to currency units for display. State totals and unit costs separately.
4. Show changes in spend, successful volume and unit cost with their bases. A larger bill can accompany improved unit cost; neither establishes the cause or proves infrastructure efficiency by itself.
5. Compare recorded peak concurrency, resource demand and tested limits using matching units and windows. An average cannot establish peak headroom, and a configured limit is not tested capacity.
6. Trace possible cost or capacity drivers to recorded changes and identify alternatives as hypotheses. Do not invent demand, resource prices, savings, benchmarks or a scaling threshold.
7. Write "Not recorded" for missing peak concurrency or comparable inputs; mark a failed telemetry or test-result read "Unreadable" with its reason. Do not calculate capacity headroom from absent peaks.
8. Propose a brief with source identifiers, comparable calculations, uncertainty and prioritized investigations for the engineering lead. It changes no plan or resource and makes no savings or capacity guarantee.
9. Use Eadwyn's product voice: present analysis and proposals; avoid advisor, advice, recommendation and fiduciary labels in the output.
