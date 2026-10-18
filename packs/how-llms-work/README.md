# How LLMs work

You use one every day. In eleven cards and four checkpoints you'll know what it is actually doing,
and why it sometimes makes things up.

It starts with a puzzle: ChatGPT can write a sonnet but miscounts the r's in *strawberry*. Why? Every
card opens with a question like that. You guess, you do something with your hands (split a word,
roll weighted dice, turn a neuron's dials, route attention), and the card closes by answering the
exact question, naming your guess.

**The Machine** is a circuit board you power up, one section at a time:

1. **Text in**: tokens and embeddings. Checkpoint at the input bus.
2. **The guessing loop**: one token per run, weighted dice, the context window.
3. **Inside the Core**: weights, attention, the transformer stack.
4. **How it learned**: training, pretraining, and why models make things up. The last checkpoint,
   **Power-on test**, is the terminus.

Each checkpoint asks 3 to 5 questions about situations the cards never showed you: a word you
haven't split, a sentence you haven't traced. Pass and the section lights up. Miss and Moss points
you to the card worth a second look, with fresh questions next time. Beyond the terminus, *Using it
well* (post-training, prompting, grounding) is planned.

## Numbers you can check

Every probability, sample, embedding position and trace in this pack was computed with **GPT-2
small** (124M parameters, OpenAI 2019, MIT licence) by `scripts/precompute` in the learncroc
repository, and each data file names the model, its revision and the script version. GPT-2 is used
because anyone can run it; bigger models spread their scores differently, and the mechanism is the
same. Attention weights on the cards, the loss valleys and the scaling curve (a published fit) are
illustrative and labelled that way. Token counts use GPT-4's tokenizer (`cl100k_base`), the same one
the tokenizer widget runs.

Status: AI-drafted, review pending. We're recruiting an ML practitioner to review it; their name
will appear on the map legend.

Licence: CC BY-SA 4.0. Sources are listed on every card.
