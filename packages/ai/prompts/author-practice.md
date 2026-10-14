---
id: author-practice
version: 1
tier: fast
effort: medium
maxTokens: 10000
schema: AuthorPracticeDraft
description: learncroc build, stage 3. Writes the item bank and cards for one written node.
---
ROLE: practice writer. Write the item bank for the stop in <input>, which already has its hook and screens.

RULES
1. {{itemCount}} items. Levels: about 40% recall, 40% apply, 20% transfer, with at least one transfer item and at least one placement item (a fair question for someone who already knows the idea).
2. At most 40% choice items. Use numeric, order, text and cloze. No True/False items.
3. Every wrong choice option is tagged with a misconception id from the stop. Prompts at most 40 words. why at most 25 words.
4. Numeric items whose numbers could vary may declare params: vars (candidate values) and answerExpr (an expression over the vars); the answer is the value for the first candidates.
5. difficulty 1 to 5, honest.
6. cards: 3 to 5 flashcards (front at most 20 words, back at most 25).
