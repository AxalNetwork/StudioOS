/** #3626: reviewed model purposes and module capability assignments. */
export default {
  "@cf/cloudflare/clef": {
    "operation": "decision",
    "kinds": [
      "reason",
      "synth",
      "plan"
    ],
    "purpose": "Classify evidence, urgency and next-step options with confidence scores"
  },
  "@cf/cloudflare/clef-flash": {
    "operation": "decision",
    "kinds": [
      "reason",
      "synth",
      "plan"
    ],
    "purpose": "Classify evidence, urgency and next-step options with confidence scores"
  },
  "@cf/cloudflare/clef-omni": {
    "operation": "decision",
    "kinds": [
      "reason",
      "synth",
      "plan"
    ],
    "purpose": "Classify evidence, urgency and next-step options with confidence scores"
  },
  "@cf/daily-co/phonellm-mini-alpha-2": {
    "operation": "chat",
    "kinds": [
      "chat",
      "speech"
    ],
    "purpose": "Short conversational replies for recorded-session and voice workflows"
  },
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": {
    "operation": "chat",
    "kinds": [
      "multi",
      "write",
      "chat"
    ],
    "purpose": "Southeast Asian language conversations and regional market copy"
  },
  "@cf/meta/llama-3.1-70b-instruct-fp8-fast": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth",
      "write"
    ],
    "purpose": "Summarise research, explain records and draft member communications"
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth",
      "write"
    ],
    "purpose": "Summarise research, explain records and draft member communications"
  },
  "@cf/meta/llama-3.1-8b-instruct-fp8": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth"
    ],
    "purpose": "Short summaries, labels and lightweight record explanations"
  },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth"
    ],
    "purpose": "Short summaries, labels and lightweight record explanations"
  },
  "@cf/meta/llama-3.2-1b-instruct": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth"
    ],
    "purpose": "Short summaries, labels and lightweight record explanations"
  },
  "@cf/meta/llama-3.2-3b-instruct": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth"
    ],
    "purpose": "Short summaries, labels and lightweight record explanations"
  },
  "@cf/ibm-granite/granite-4.0-h-micro": {
    "operation": "chat",
    "kinds": [
      "chat",
      "synth"
    ],
    "purpose": "Short summaries, labels and lightweight record explanations"
  },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {
    "operation": "chat",
    "kinds": [
      "write",
      "multi",
      "synth"
    ],
    "purpose": "Investor narratives, distribution copy and multilingual summaries"
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    "operation": "chat",
    "kinds": [
      "reason",
      "plan",
      "numbers"
    ],
    "purpose": "Compare evidence, work through scenarios and explain planning assumptions"
  },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": {
    "operation": "chat",
    "kinds": [
      "reason",
      "plan",
      "numbers"
    ],
    "purpose": "Compare evidence, work through scenarios and explain planning assumptions"
  },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    "operation": "chat",
    "kinds": [
      "reason",
      "plan",
      "numbers"
    ],
    "purpose": "Compare evidence, work through scenarios and explain planning assumptions"
  },
  "@cf/nvidia/nemotron-3-120b-a12b": {
    "operation": "chat",
    "kinds": [
      "reason",
      "plan",
      "numbers"
    ],
    "purpose": "Compare evidence, work through scenarios and explain planning assumptions"
  },
  "@cf/qwen/qwq-32b": {
    "operation": "chat",
    "kinds": [
      "reason",
      "plan",
      "numbers"
    ],
    "purpose": "Compare evidence, work through scenarios and explain planning assumptions"
  },
  "@cf/zai-org/glm-4.7-flash": {
    "operation": "chat",
    "kinds": [
      "chat",
      "reason",
      "plan"
    ],
    "purpose": "Interactive explanations, evidence summaries and planning drafts"
  },
  "@cf/openai/gpt-oss-20b": {
    "operation": "chat",
    "kinds": [
      "chat",
      "reason",
      "plan"
    ],
    "purpose": "Interactive explanations, evidence summaries and planning drafts"
  },
  "@cf/qwen/qwen3-30b-a3b-fp8": {
    "operation": "chat",
    "kinds": [
      "chat",
      "reason",
      "plan"
    ],
    "purpose": "Interactive explanations, evidence summaries and planning drafts"
  },
  "@cf/zai-org/glm-5.2": {
    "operation": "chat",
    "kinds": [
      "code",
      "reason",
      "plan"
    ],
    "purpose": "Prototype code, technical plans and multi-step problem solving"
  },
  "@cf/zai-org/glm-5.3": {
    "operation": "chat",
    "kinds": [
      "code",
      "reason",
      "plan"
    ],
    "purpose": "Prototype code, technical plans and multi-step problem solving"
  },
  "@cf/zai-org/glm-5.3-flash": {
    "operation": "chat",
    "kinds": [
      "code",
      "reason",
      "plan"
    ],
    "purpose": "Prototype code, technical plans and multi-step problem solving"
  },
  "@cf/qwen/qwen3.8-27b": {
    "operation": "chat",
    "kinds": [
      "code",
      "reason",
      "plan"
    ],
    "purpose": "Prototype code, technical plans and multi-step problem solving"
  },
  "@cf/openai/gpt-oss-120b": {
    "operation": "chat",
    "kinds": [
      "reason",
      "research",
      "plan"
    ],
    "purpose": "Research synthesis, evidence comparison and detailed planning"
  },
  "@cf/moonshotai/kimi-k2.6": {
    "operation": "chat",
    "kinds": [
      "research",
      "reason"
    ],
    "purpose": "Long-document research and cross-source synthesis"
  },
  "@cf/moonshotai/kimi-k2.7-code": {
    "operation": "chat",
    "kinds": [
      "code"
    ],
    "purpose": "Prototype code, implementation drafts and technical review"
  },
  "@cf/qwen/qwen2.5-coder-32b-instruct": {
    "operation": "chat",
    "kinds": [
      "code"
    ],
    "purpose": "Prototype code, implementation drafts and technical review"
  },
  "@cf/google/gemma-4-26b-a4b-it": {
    "operation": "chat",
    "kinds": [
      "vision"
    ],
    "purpose": "Read pitch-deck images, explain screenshots and extract visual evidence"
  },
  "@cf/meta/llama-4-scout-17b-16e-instruct": {
    "operation": "chat",
    "kinds": [
      "vision"
    ],
    "purpose": "Read pitch-deck images, explain screenshots and extract visual evidence"
  },
  "@cf/meta/llama-3.2-11b-vision-instruct": {
    "operation": "chat",
    "kinds": [
      "vision"
    ],
    "purpose": "Read pitch-deck images, explain screenshots and extract visual evidence"
  },
  "@cf/moondream/moondream3.1-9B-A2B": {
    "operation": "vision",
    "kinds": [
      "vision"
    ],
    "purpose": "Answer questions about document images and describe visual evidence"
  },
  "@cf/microsoft/resnet-50": {
    "operation": "image_labels",
    "kinds": [
      "vision"
    ],
    "purpose": "Suggest general object labels for uploaded images"
  },
  "@cf/baai/bge-base-en-v1.5": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "English retrieval and semantic similarity for research and relationship matching"
  },
  "@cf/baai/bge-large-en-v1.5": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "Detailed English semantic similarity for research and relationship matching"
  },
  "@cf/baai/bge-small-en-v1.5": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "Lightweight English semantic similarity for research and relationship matching"
  },
  "@cf/baai/bge-m3": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "Multilingual semantic similarity for research and relationship matching"
  },
  "@cf/pfnet/plamo-embedding-1b": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "Japanese semantic similarity for research and relationship matching"
  },
  "@cf/qwen/qwen3-embedding-0.6b": {
    "operation": "embed",
    "kinds": [
      "match",
      "multi",
      "research",
      "search"
    ],
    "purpose": "Multilingual semantic similarity for research and relationship matching"
  },
  "@cf/baai/bge-reranker-base": {
    "operation": "rerank",
    "kinds": [
      "research",
      "search",
      "match"
    ],
    "purpose": "Rank supplied research passages and relationship matches by relevance"
  },
  "@cf/huggingface/distilbert-sst-2-int8": {
    "operation": "sentiment",
    "kinds": [
      "speech",
      "synth"
    ],
    "purpose": "English positive and negative sentiment cues in customer and session feedback"
  },
  "@cf/meta/m2m100-1.2b": {
    "operation": "translate",
    "kinds": [
      "multi",
      "speech"
    ],
    "purpose": "Translate session excerpts and market-expansion material between supported languages"
  },
  "@cf/ai4bharat/indictrans2-en-indic-1B": {
    "operation": "translate",
    "kinds": [
      "multi",
      "speech"
    ],
    "purpose": "Translate session excerpts and market-expansion material from English into supported Indic languages"
  },
  "@cf/deepgram/flux": {
    "operation": "stream",
    "kinds": [
      "speech"
    ],
    "purpose": "Live conversational transcription in recorded sessions"
  },
  "@cf/deepgram/nova-3": {
    "operation": "transcribe",
    "kinds": [
      "speech"
    ],
    "purpose": "Transcribe member-supplied recordings and interview audio"
  },
  "@cf/openai/whisper": {
    "operation": "transcribe",
    "kinds": [
      "speech"
    ],
    "purpose": "Transcribe member-supplied recordings and interview audio"
  },
  "@cf/openai/whisper-large-v3-turbo": {
    "operation": "transcribe",
    "kinds": [
      "speech"
    ],
    "purpose": "Transcribe member-supplied recordings and interview audio"
  },
  "@cf/pipecat-ai/smart-turn-v2": {
    "operation": "turn",
    "kinds": [
      "speech"
    ],
    "purpose": "Detect whether a speaker has finished a turn in an audio excerpt"
  },
  "@cf/myshell-ai/melotts": {
    "operation": "voice",
    "kinds": [
      "speech",
      "chat"
    ],
    "purpose": "Read prepared session prompts and conversational replies aloud"
  },
  "@cf/deepgram/aura-1": {
    "operation": "voice",
    "kinds": [
      "speech",
      "chat"
    ],
    "purpose": "Read prepared session prompts and conversational replies aloud"
  },
  "@cf/deepgram/aura-2-en": {
    "operation": "voice",
    "kinds": [
      "speech",
      "chat"
    ],
    "purpose": "Read prepared session prompts and conversational replies aloud"
  },
  "@cf/deepgram/aura-2-es": {
    "operation": "voice",
    "kinds": [
      "speech",
      "chat"
    ],
    "purpose": "Read prepared session prompts and conversational replies aloud"
  },
  "@cf/black-forest-labs/flux-1-schnell": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/black-forest-labs/flux-2-dev": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/black-forest-labs/flux-2-klein-4b": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/black-forest-labs/flux-2-klein-9b": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/leonardo/lucid-origin": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/leonardo/phoenix-1.0": {
    "operation": "draw",
    "kinds": [
      "vision",
      "write"
    ],
    "purpose": "Generate pitch-deck visuals and brand-image drafts"
  },
  "@cf/meta/llama-guard-3-8b": {
    "operation": "guard",
    "kinds": [
      "*"
    ],
    "purpose": "Check member inputs and generated drafts for unsafe content"
  }
};
