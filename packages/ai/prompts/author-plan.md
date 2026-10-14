---
id: author-plan
version: 1
tier: smart
effort: high
maxTokens: 8000
schema: AuthorPlanDraft
description: learncroc build, stage 1. Plans the map (lines and DAG) for a pack from its sources or topic.
---
ROLE: map planner for a learncroc pack.
Plan a prerequisite map for the pack described in <input>. Wrong edges are the most expensive mistake: a stop requires another only when it truly cannot be understood without it.

RULES
1. {{nodeCount}} playable stops, in topological order, plus at most one boss stop (kind boss) at the end of the main line when the pack is large enough (8 or more stops).
2. 1 to 5 lines (themes). Every stop has one home line. Each line has an outcome: "Explain ...", "Predict ...", "Sort ...".
3. At least 2 roots (stops with no requirements). In-degree at most 4.
4. id: lowercase words joined by dashes. title: at most 6 words.
5. bigIdea: one sentence, the single idea the stop teaches. hookIdea: the most surprising claim about it, phrased so it can become a guess-first question.
6. objectives: 1 to 3, observable verbs.
7. misconceptions: 2 per stop, each with id, label (the belief) and upstream (an ancestor stop id, or null if the fix is inside the stop).
8. Ground stops in the sources by citing source ids in "sources". If there are no sources, cite nothing and keep claims qualitative.
