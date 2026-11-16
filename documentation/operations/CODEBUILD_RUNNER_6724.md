# Configure and benchmark AWS CodeBuild runners for StudioOS

The initial lane sends the nine suite shards of an approved benchmark to disposable Linux x86 CodeBuild runners. The planner and final gate stay on GitHub and their timings belong in the comparison. Pull requests, production deployments and ordinary CI continue on their existing runners. Production merge-group routing is tracked in [#6677](https://github.com/AxalNetwork/StudioOS/issues/6677). The [CloudFormation template](CODEBUILD_RUNNER_6724.yml) prepares the AWS project with its webhook disabled.

## Choose the account and capacity

Use an isolated CI member account and a role that cannot administer production. EU (Frankfurt), `eu-central-1`, is the example region. An organization management account has additional privileges and is a poor place to execute repository code. A new member account requires a unique account email and billing-owner authorization. Keep account identifiers, connection ARNs and spend thresholds in private operations records.

Run these commands in the selected CI account. Quotas belong to an account, region and compute class. A quota read in the management account does not establish the new member's quota.

```sh
export AWS_REGION=eu-central-1
aws sts get-caller-identity
aws service-quotas get-service-quota --region "$AWS_REGION" \
  --service-code codebuild --quota-code L-4DDC4A99 \
  --query 'Quota.{Class:QuotaName,Applied:Value,Adjustable:Adjustable}'
aws codebuild list-projects --region "$AWS_REGION"
```

Nine available Linux/Large slots fit one fully parallel suite. Five candidates can offer 45 suite jobs. If five-way operation is approved and the target account needs more slots, request 60 Linux/Large slots for that region, leaving 15 for overlap. Other projects on that compute class share the quota; a different compute size has a different quota. Check existing quota requests first. The project's initial concurrency cap is nine. For a wider rollout increase project capacity as well as the regional quota and coordinate admission. A saturated project cap can reject a request. It cannot redirect it to GitHub.

```sh
aws service-quotas list-requested-service-quota-change-history-by-quota \
  --region "$AWS_REGION" --service-code codebuild --quota-code L-4DDC4A99 \
  --query 'RequestedQuotas[].{Requested:DesiredValue,State:Status}'
# Run only when the CI account is selected, the increase is needed and approved.
aws service-quotas request-service-quota-increase --region "$AWS_REGION" \
  --service-code codebuild --quota-code L-4DDC4A99 --desired-value 60
```

## Prepare the project before connecting job events

1. In the selected account and region, open **Developer Tools → Settings → Connections → Create connection**. Select GitHub, authorize the AWS Connector for GitHub, and use an installation scoped to **AxalNetwork/StudioOS**. Complete the GitHub authorization and confirm that the connection is **Available**. A connection created through an API can remain pending until an authorized person completes that step. Review the app installation's permissions and existing repository access before using it.
2. In a private shell, set `CODEBUILD_CONNECTION_ARN` to the connection returned by that console. The stack creates one on-demand Linux/Large project, a service role limited to that connection and its log streams, and a 14-day log group. It creates no public webhook. EC2 Linux/Large uses 8 vCPU and 16 GiB RAM. The nine-shard and 45-minute per-build limits give the pilot a known maximum concurrent load. An AWS Budget alert can arrive after charges accrue. Agree a trial amount and limit the number of admitted run IDs and attempts at the event ingress.
3. Prepare and inspect a CloudFormation change set. The following command stops before execution. Review the project, generated IAM role, log group, region, account and repository before executing the selected change set in CloudFormation.

```sh
aws cloudformation deploy --region "$AWS_REGION" \
  --template-file documentation/operations/CODEBUILD_RUNNER_6724.yml \
  --stack-name studioos-queue-suite-benchmark --capabilities CAPABILITY_IAM \
  --parameter-overrides ConnectionArn="$CODEBUILD_CONNECTION_ARN" ProjectConcurrency=9 \
  --no-execute-changeset
```

## Authorize the AWS job before allocating compute

StudioOS is public. CodeBuild's `WORKFLOW_JOB_QUEUED` webhook and an exact workflow-name filter provide routing. A pull-request workflow can request labels and supply its own workflow name. A YAML event condition, a runner label or a workflow-name filter alone does not establish authorization to spend on AWS.

A workable design is a trusted webhook receiver in front of a **manual** CodeBuild webhook. This change supplies the runner project and benchmark integration. The admission receiver, dedicated credentials and webhook installation require implementation and verification in the selected account before enabling the benchmark. A native/manual webhook connected directly from the public repository does not perform the independent checks below.

- Verify the GitHub delivery signature and immutable repository ID. Fetch the job and run attempt using GitHub's API. Bind the project label to the returned run ID, attempt, workflow identity and job. Accept only expected suite jobs; reject optional image, group, size and buildspec-override labels. Deduplicate deliveries per job and attempt.
- For a benchmark, authorize the exact reviewed commit and one of the three approved trial branches. Verify the trusted benchmark workflow at that commit. For a later merge canary, require the `merge_group` event, the current queue ref and matching combined SHA for the approved PR. Keep release credentials and secret-bearing jobs on GitHub. Separate the credentials that authenticate webhook deliveries from the CodeBuild service role.
- Forward only authorized deliveries using CodeBuild's manual-webhook protocol. Preserve the delivery identity and validate the signing arrangement end-to-end. Keep the CodeBuild destination URL and secret private. In a sandboxed trial, demonstrate that an ordinary PR request produces **zero** AWS builds, that duplicate delivery produces a single job, and that the intended benchmark job receives exactly one runner. Limit runner registration to the intended repository and verify which workflows can pick up the runner.

## Measure and decide

Follow [#6676](https://github.com/AxalNetwork/StudioOS/issues/6676) for post-draft queue measurement and [D5611](../architecture/decisions/D5611.md) for the existing benchmark constraints. First record three free-lane controls at the same reviewed commit, with other paid providers disabled. Use an actual post-rollout peak baseline before deciding to change the merge queue. The target on #6676 is p90 first-runner pickup within five minutes. Its clock starts when GitHub creates the candidate CI run. Track time from queue entry to candidate creation separately.

Use distinct GitHub control refs such as `bench/runners-github-1`, `bench/runners-github-2` and `bench/runners-github-3`. Keep the other paid-lane flags off for those controls. After the budget, connection, authorization and capacity checks pass, enable the **benchmark-only** CodeBuild readiness and spending flags for the approved trial branches. The existing `RUNNER_BENCHMARK_EPHEMERAL_READY` switch specifically selects WarpBuild. For the AWS trial use `RUNNER_BENCHMARK_CODEBUILD_READY=true` and `RUNNER_BENCHMARK_SPENDING_CAP_VERIFIED=true`. Point the three refs `bench/runners-codebuild-1`, `bench/runners-codebuild-2`, and `bench/runners-codebuild-3` at the same reviewed commit. Run the trials one at a time. A new attempt gets a new per-runner label. Never push a trial ref to force a load test while the repository's backlog rule is in effect.

Collect planner wait and execution, the last shard to finish, final required/gate outcome, queueing and provisioning time, and build IDs. Join the AWS builds for the approved run/attempt to the billed duration and the selected account/region's actual rate. Keep missing billing evidence unknown. GitHub job start-to-finish minutes omit provider provisioning and cannot establish AWS charges. The Frankfurt catalogue lists general1.large at USD 0.020 per build-minute as checked 15 November 2026. An illustrative 124 billed minutes would be USD 2.48 for compute, if the 124 minutes already include per-build rounding, before logging and other services. Three passing trials are a comparison, not a guarantee of peak throughput.

For each trial, open the benchmark run, record its numeric run ID and nine corresponding CodeBuild build IDs, and run the report from the identical tested commit. Keep AWS build records and account identifiers in the private operations record.

```sh
# Set TRIAL_RUN_ID to the GitHub run ID and BUILD_ID to a matched shard build ID.
GH_REPO=AxalNetwork/StudioOS node scripts/runner-benchmark-report.mjs "$TRIAL_RUN_ID"
aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$BUILD_ID" \
  --query 'builds[].{Status:buildStatus,Compute:environment.computeType,Image:environment.image,Start:startTime,End:endTime,Phases:phases[].{Stage:phaseType,Seconds:durationInSeconds}}'
```

The queue switch in #6677 comes after the benchmark. Route only the chosen queue jobs, use a positive allowlist for the CodeBuild lane, and generate the label at evaluation time:

```yaml
runs-on: ${{ github.event_name == 'merge_group' && vars.CI_QUEUE_RUNNER == 'codebuild' && format('codebuild-studioos-queue-suite-{0}-{1}', github.run_id, github.run_attempt) || 'ubuntu-latest' }}
```

The snippet illustrates the future production suite selector. An Actions variable is a string; expressions embedded in its value are not expanded a second time. Verify a single candidate against the six required contexts on its exact SHA. Clear the selector to route newly evaluated jobs back to GitHub. Disable AWS admission, inspect any jobs queued for their existing labels, and confirm an authorized new attempt uses GitHub. Deleting a variable cannot transfer an in-flight job. Protect separate small control jobs from contention later if the measured planner or gate is still waiting.

[AWS runner setup](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html) · [CodeConnections for GitHub](https://docs.aws.amazon.com/codebuild/latest/userguide/connections-github-app.html) · [AWS manual webhooks](https://docs.aws.amazon.com/codebuild/latest/userguide/github-manual-webhook.html) · [AWS concurrency model](https://docs.aws.amazon.com/codebuild/latest/userguide/builds-working.html) · [Regional CodeBuild pricing](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/CodeBuild/current/eu-central-1/index.json)
