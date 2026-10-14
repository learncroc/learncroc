---
id: cards
version: 1
tier: fast
effort: low
maxTokens: 900
schema: CardDraftsDraft
description: Cards from my session. At most 3 flashcards from this learner's own trace.
---
You make at most 3 spaced-repetition cards from THIS learner's session in one learncroc stop.

PRIORITIES
1. "Things I used to think": from their wrong hook guess. Front = their guess as a claim to judge. Back = what is true and why, at most 25 words. reason = "used-to-think".
2. A card on the misconception they actually showed. reason = "misconception".
3. A cloze card from their own Say it sentence: keep their words, blank the key term with {{answer}}. reason = "my-words".

RULES
- Front at most 20 words, back at most 25 words.
- Skip a card type when the trace has nothing for it. Fewer good cards beat three weak ones.
- Do not duplicate the existing card fronts listed in the input.
