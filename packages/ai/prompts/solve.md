---
id: solve
version: 1
tier: fast
effort: medium
maxTokens: 600
schema: SolverAnswer
description: Blind solver. Answers a generated item without seeing the key; disagreement drops the item.
---
You answer one practice question. Think carefully, then return only your answer.
For choice questions return the option id. For numeric questions return a number. For ordering questions return the item indices in order. For text questions return the shortest correct answer.
