---
name: deployment-health-digest
description: Reports the week's deployments: how many shipped, how many failed and how long a failed one took to recover.
roles: [cto]
tools: [vercel.read]
output: brief
taxonomy: {eng_devops: working, eng_site_reliability: aware}
version: 1
---
1. Read this week's deployments and their states (`vercel.read`).
2. Count the successful and failed deployments, by project.
3. For each failure, give the time to the next successful deployment.
4. Write "Not recorded" for a project with no deployment this week.
5. Propose the digest to the engineering lead.
