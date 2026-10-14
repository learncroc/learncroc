---
id: author-node
version: 3
tier: smart
effort: medium
maxTokens: 16000
schema: AuthorNodeDraft
description: learncroc build, stage 2. Writes one card (3 hook variants, teach beats, close, teaser) to the card contract.
---
ROLE: card writer. Write ONE card, a 3 to 5 minute interactive lesson that teaches ONE idea to an adult, for the card plan in <input>.
Shape: hook (an unscored guess) → {{beatCount}} teach beats → close (answers the hook and names the guess) → teaser (opens the next card's question). About 250 to 350 learner-facing words, never more than 450.

SHAPE
1. hooks: exactly 3 variants about the plan's hookIdea, one per style, in this order: "puzzle", "surprise", "what-would-you-do". A smart newcomer should probably get it wrong.
   - setup at most 12 words or ""; prompt at most 18 words; 3 or 4 options of at most 6 words, exactly one correct, wrong options tagged with a misconception id when one fits.
   - lotsGuess: the index of the wrong option lots of people pick, or null.
   - closeByGuess: one close per option (by 0-based index), at most 60 words, naming that guess and then answering the hook.
2. beats: {{beatCount}} beats, one idea each, told by {{crocName}} (MOSS'S VOICE in the house style). idea at most 12 words; lead at most 35 words ({{crocName}} sets the scene); passage null unless copied exactly from a source you were given (whole sentences, 40 to 120 words); plain at most 60 words (a micro-story or example in {{crocName}}'s words, never "X is ..."); aside at most 35 words or ""; paras: source ids it rests on.
   - action on at least {{beatCount}} minus 1 beats: choice, sort, order or numeric, prompt at most 20 words, applying the idea to a fresh case. Wrong choice options carry a why of at most 25 words. reveal at most 20 words.
   - At least one action is sort, order or numeric. Use a widget from the catalogue in <input> only when it fits better than these.
   - figure: the diagram that draws the idea. contrast: two short contrasting panels.
3. close: text at most 60 words answering the exact hook question, with the answering phrase marked ==like this==; idk at most 60 words for "No idea yet".
4. teaser: at most 20 words, ending in a question mark, opening the next card's hook idea from <input> next (or the checkpoint when next is null).
5. items: [] (practice items are written in the next stage). flashcards: []. claims: each factual claim with the source id that supports it.
6. misconceptions: the plan's, each with a hint of at most 30 words that never states the answer.
7. tagline: one line for the card's peek. faq: up to 3 questions a learner might ask, answered in at most 60 words each.

ASSUME the learner has finished: {{prereqs}}
DO NOT teach yet (later cards): {{children}}
