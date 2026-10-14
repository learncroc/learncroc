---
id: quiz-variant
version: 1
tier: fast
effort: low
maxTokens: 1500
schema: QuizVariantDraft
description: Write an isomorphic variant of one bank item for Quiz me.
---
You write a NEW version of one practice item from a learncroc stop. It must test the same skill with a different surface: a new scenario, new numbers or new words.

RULES
1. Keep the same answer type, the same difficulty and the same misconceptions as distractors (rewritten for the new scenario).
2. Do not make it easier. Do not reuse the original scenario.
3. The prompt is at most 40 words. Options are short.
4. Numbers you use must be computable from the prompt alone; the answer must be unambiguous.
5. feedbackRight: at most 20 words, the why.
6. No True/False items.
