# Workers AI pricing, as Cloudflare publishes it (page last updated 2026-10-15)

Copied by S1 on 2026-10-19 from https://developers.cloudflare.com/workers-ai/platform/pricing/, through the
Cloudflare documentation connector. Sessions without that connector are refused by the host, so D760 (#2017)
builds the catalogue's prices from this file. Values are as published, with nothing rounded or added.

**Billing.** Cloudflare bills in neurons, at **$0.011 per 1,000 neurons**. Workers Paid includes 10,000 neurons a
day. The "Price" column is the neuron column converted and rounded for display. The exact price of a unit is
`neurons × 0.011 / 1000`. For example, Whisper is 41.14 neurons a minute: $0.00045254, which the model's own page
shows as $0.000453 and this table as $0.0005. The catalogue prices from the neuron column.

**Paid billing only:** `@cf/moonshotai/kimi-k2.6`, `@cf/moonshotai/kimi-k2.7-code`, `@cf/zai-org/glm-5.2`,
`@cf/zai-org/glm-5.3`, `@cf/zai-org/glm-5.3-flash`, `@cf/deepseek-ai/deepseek-v4-flash-0731` and
`@cf/deepseek-ai/deepseek-v4-pro-0813` need the Workers Paid plan or prepaid AI Gateway credits.

## LLM model pricing (per million tokens)

| Model | Input | Cached input | Output | Neurons in | Neurons cached | Neurons out |
|---|---|---|---|---|---|---|
| `@cf/meta/llama-3.2-1b-instruct` | $0.027 | | $0.201 | 2457 | | 18252 |
| `@cf/meta/llama-3.2-3b-instruct` | $0.051 | | $0.335 | 4625 | | 30475 |
| `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | $0.045 | | $0.384 | 4119 | | 34868 |
| `@cf/meta/llama-3.2-11b-vision-instruct` | $0.049 | | $0.676 | 4410 | | 61493 |
| `@cf/meta/llama-3.1-70b-instruct-fp8-fast` | $0.293 | | $2.253 | 26668 | | 204805 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | $0.293 | | $2.253 | 26668 | | 204805 |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | $0.497 | | $4.881 | 45170 | | 443756 |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | $0.440 | $0.014 | $1.320 | 40000 | 1273 | 120000 |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | $1.320 | $0.044 | $3.960 | 120000 | 4000 | 360000 |
| `@cf/mistral/mistral-7b-instruct-v0.1` | $0.110 | | $0.190 | 10000 | | 17300 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | $0.351 | | $0.555 | 31876 | | 50488 |
| `@cf/meta/llama-3.1-8b-instruct` | $0.282 | | $0.827 | 25608 | | 75147 |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | $0.152 | | $0.287 | 13778 | | 26128 |
| `@cf/meta/llama-3.1-8b-instruct-awq` | $0.123 | | $0.266 | 11161 | | 24215 |
| `@cf/meta/llama-3-8b-instruct` | $0.282 | | $0.827 | 25608 | | 75147 |
| `@cf/meta/llama-3-8b-instruct-awq` | $0.123 | | $0.266 | 11161 | | 24215 |
| `@cf/meta/llama-2-7b-chat-fp16` | $0.556 | | $6.667 | 50505 | | 606061 |
| `@cf/meta/llama-guard-3-8b` | $0.484 | | $0.030 | 44003 | | 2730 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | $0.270 | | $0.850 | 24545 | | 77273 |
| `@cf/google/gemma-3-12b-it` | $0.345 | | $0.556 | 31371 | | 50560 |
| `@cf/qwen/qwq-32b` | $0.660 | | $1.000 | 60000 | | 90909 |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | $0.660 | | $1.000 | 60000 | | 90909 |
| `@cf/qwen/qwen3-30b-a3b-fp8` | $0.051 | | $0.335 | 4625 | | 30475 |
| `@cf/qwen/qwen3.8-27b` | $0.450 | | $3.200 | 40909 | | 290909 |
| `@cf/openai/gpt-oss-120b` | $0.350 | | $0.750 | 31818 | | 68182 |
| `@cf/openai/gpt-oss-20b` | $0.200 | | $0.300 | 18182 | | 27273 |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | $0.351 | | $0.555 | 31876 | | 50488 |
| `@cf/ibm-granite/granite-4.0-h-micro` | $0.017 | | $0.112 | 1542 | | 10158 |
| `@cf/zai-org/glm-4.7-flash` | $0.060 | | $0.400 | 5500 | | 36400 |
| `@cf/zai-org/glm-5.2` | $1.400 | $0.260 | $4.400 | 127273 | 23636 | 400000 |
| `@cf/zai-org/glm-5.3` | $1.400 | $0.260 | $4.400 | 127273 | 23636 | 400000 |
| `@cf/zai-org/glm-5.3-flash` | $0.150 | $0.030 | $0.500 | 13636 | 2727 | 45455 |
| `@cf/nvidia/nemotron-3-120b-a12b` | $0.500 | | $1.500 | 45455 | | 136364 |
| `@cf/moonshotai/kimi-k2.5` | $0.600 | $0.100 | $3.000 | 54545 | 9091 | 272727 |
| `@cf/moonshotai/kimi-k2.6` | $0.950 | $0.160 | $4.000 | 86364 | 14545 | 363636 |
| `@cf/moonshotai/kimi-k2.7-code` | $0.950 | $0.190 | $4.000 | 86364 | 17273 | 363636 |
| `@cf/google/gemma-4-26b-a4b-it` | $0.100 | | $0.300 | 9091 | | 27273 |
| `@cf/daily-co/phonellm-mini-alpha-2` | $0.060 | | $0.240 | 5455 | | 21818 |

## Embeddings model pricing (per million input tokens)

| Model | Input | Neurons in |
|---|---|---|
| `@cf/baai/bge-small-en-v1.5` | $0.020 | 1841 |
| `@cf/baai/bge-base-en-v1.5` | $0.067 | 6058 |
| `@cf/baai/bge-large-en-v1.5` | $0.204 | 18582 |
| `@cf/baai/bge-m3` | $0.012 | 1075 |
| `@cf/pfnet/plamo-embedding-1b` | $0.019 | 1689 |
| `@cf/qwen/qwen3-embedding-0.6b` | $0.012 | 1075 |

## Other model pricing

| Model | Price | Neurons |
|---|---|---|
| `@cf/huggingface/distilbert-sst-2-int8` | $0.026 per M input tokens | 2394 per M input tokens |
| `@cf/baai/bge-reranker-base` | $0.003 per M input tokens | 283 per M input tokens |
| `@cf/meta/m2m100-1.2b` | $0.342 per M input tokens, $0.342 per M output tokens | 31050 in, 31050 out |
| `@cf/microsoft/resnet-50` | $2.51 per M images | 228055 per M images |
| `@cf/ai4bharat/indictrans2-en-indic-1B` | $0.342 per M input tokens, $0.342 per M output tokens | 31050 in, 31050 out |
| `@cf/moondream/moondream3.1-9B-A2B` | $0.300 per M input tokens, $1.000 per M output tokens | 27273 in, 90909 out |
| `@cf/cloudflare/clef` | $0.240 per M input tokens | 21818 per M input tokens |
| `@cf/cloudflare/clef-omni` | $0.150 per M input tokens | 13636 per M input tokens |
| `@cf/cloudflare/clef-flash` | $0.038 per M input tokens | 3455 per M input tokens |

## Image model pricing

| Model | Price | Neurons |
|---|---|---|
| `@cf/black-forest-labs/flux-1-schnell` | $0.0000528 per 512x512 tile, $0.0001056 per step | 4.80 per tile, 9.60 per step |
| `@cf/leonardo/lucid-origin` | $0.006996 per 512x512 tile, $0.000132 per step | 636.00 per tile, 12.00 per step |
| `@cf/leonardo/phoenix-1.0` | $0.005830 per 512x512 tile, $0.000110 per step | 530.00 per tile, 10.00 per step |
| `@cf/black-forest-labs/flux-2-dev` | $0.00021 per input 512x512 tile, per step; $0.00041 per output 512x512 tile, per step | 18.75 per input tile per step, 37.50 per output tile per step |
| `@cf/black-forest-labs/flux-2-klein-4b` | $0.000059 per input 512x512 tile, $0.000287 per output 512x512 tile | 5.37 per input tile, 26.05 per output tile |
| `@cf/black-forest-labs/flux-2-klein-9b` | $0.015 per first MP (1024x1024), $0.002 per subsequent MP, $0.002 per input image MP | 1363.64 first MP, 181.82 per subsequent MP, 181.82 per input image MP |

## Audio model pricing

| Model | Price | Neurons |
|---|---|---|
| `@cf/openai/whisper` | $0.0005 per audio minute | 41.14 per audio minute |
| `@cf/openai/whisper-large-v3-turbo` | $0.0005 per audio minute | 46.63 per audio minute |
| `@cf/myshell-ai/melotts` | $0.0002 per audio minute | 18.63 per audio minute |
| `@cf/deepgram/aura-1` | $0.015 per 1k characters input | 1,363.64 per 1k characters input |
| `@cf/deepgram/nova-3` | $0.0052 per audio minute input | 472.73 per audio minute input |
| `@cf/deepgram/nova-3` (WebSocket) | $0.0092 per audio minute input | 836.36 per audio minute input |
| `@cf/pipecat-ai/smart-turn-v2` | $0.00033795 per audio minute input | 0.51 per audio minute input |
| `@cf/deepgram/aura-2-en` | $0.030 per 1k characters input | 2727.27 per 1k characters input |
| `@cf/deepgram/aura-2-es` | $0.030 per 1k characters input | 2727.27 per 1k characters input |
| `@cf/deepgram/flux` (WebSocket) | $0.0077 per audio minute | 700.00 per audio minute |
