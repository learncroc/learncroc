# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["torch>=2.2", "transformers>=4.40", "numpy>=1.26"]
# ///
"""Precompute the real model numbers used by the "How LLMs work" pack.

Maintainer-only. Learners never run this: the JSON it writes is committed under
packs/how-llms-work/data/ and inlined into the pack at compile time with
`{ $data: "data/<file>.json#/<pointer>" }`.

    ~/.local/bin/uv run scripts/precompute/precompute.py            # all files
    ~/.local/bin/uv run scripts/precompute/precompute.py --only traces
    ~/.local/bin/uv run scripts/precompute/precompute.py --check     # recompute, fail if anything changed

Model: GPT-2 small (124M parameters, OpenAI 2019, MIT licence), loaded from the Hugging Face
hub as "gpt2" in float32 on the CPU. Every file carries a `meta` block naming the model, its
revision, this script's version and the library versions, so the widgets can say
"computed with GPT-2" and a reader can reproduce the numbers.

Everything is deterministic: greedy decoding where we show "the model's pick", and a fixed
torch seed for the temperature samples. Probabilities are rounded to 4 decimals.
"""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import transformers
from transformers import GPT2LMHeadModel, GPT2TokenizerFast

SCRIPT_VERSION = "scripts/precompute@1"
MODEL_ID = "gpt2"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packs" / "how-llms-work" / "data"
SEED = 20261020

# ── model ────────────────────────────────────────────────────────────────────────

torch.manual_seed(SEED)
torch.set_grad_enabled(False)
tok = GPT2TokenizerFast.from_pretrained(MODEL_ID)
model = GPT2LMHeadModel.from_pretrained(MODEL_ID, attn_implementation="eager").eval()
VOCAB = model.config.vocab_size
N_CTX = model.config.n_positions
N_LAYER = model.config.n_layer
D_MODEL = model.config.n_embd
N_PARAMS = sum(p.numel() for p in model.parameters())


def _snapshot_revision() -> str:
    """The hub commit of the cached weights (…/snapshots/<commit>/config.json)."""
    try:
        from transformers.utils import cached_file

        path = Path(cached_file(MODEL_ID, "config.json"))
        return path.parent.name if path.parent.parent.name == "snapshots" else "unknown"
    except Exception:  # noqa: BLE001 - provenance is best effort; the numbers don't depend on it
        return "unknown"


def meta(about: str) -> dict:
    revision = getattr(model.config, "_commit_hash", None) or _snapshot_revision()
    return {
        "about": about,
        "model": "gpt2",
        "modelName": "GPT-2 small",
        "modelRevision": revision,
        "parameters": N_PARAMS,
        "vocabSize": VOCAB,
        "contextLength": N_CTX,
        "script": SCRIPT_VERSION,
        "seed": SEED,
        "libraries": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
        },
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Probabilities are GPT-2's softmax over its whole vocabulary, rounded to 4 decimals. "
        "Lists show a few tokens; the rest of the probability is 'everything else'.",
    }


def ids_of(text: str) -> torch.Tensor:
    return tok(text, return_tensors="pt").input_ids


def next_probs(context: str, temperature: float = 1.0) -> torch.Tensor:
    logits = model(ids_of(context)).logits[0, -1]
    return torch.softmax(logits / temperature, dim=-1)


def show(token_id: int) -> str:
    """Display text for a token: GPT-2 tokens usually start with a space; the widget shows the word."""
    text = tok.decode([token_id])
    return text.strip() or repr(text)


def single_token(word: str) -> int:
    """Id of " word" (with the leading space GPT-2 uses mid-sentence); must be exactly one token."""
    ids = tok(" " + word).input_ids
    if len(ids) != 1:
        raise SystemExit(f'"{word}" is {len(ids)} GPT-2 tokens; pick a single-token word')
    return ids[0]


def r4(x: float) -> float:
    return round(float(x), 4)


def bars(context: str, words: list[str]) -> list[dict]:
    p = next_probs(context)
    return [{"text": w, "p": r4(p[single_token(w)])} for w in words]


def top(context: str, k: int, temperature: float = 1.0) -> list[dict]:
    p = next_probs(context, temperature)
    v, i = p.topk(k)
    return [{"text": show(int(t)), "p": r4(x)} for x, t in zip(v.tolist(), i.tolist())]


def greedy_steps(context: str, n: int, k: int = 5) -> list[dict]:
    """The score → pick → append loop with the top pick each time: n successive distributions."""
    steps = []
    ctx = context
    for _ in range(n):
        p = next_probs(ctx)
        v, i = p.topk(k)
        steps.append(
            {"context": ctx, "tokens": [{"text": show(int(t)), "p": r4(x)} for x, t in zip(v.tolist(), i.tolist())]}
        )
        ctx = ctx + tok.decode([int(i[0])])
    return steps


def greedy_text(context: str, n: int) -> str:
    ids = ids_of(context)
    out = model.generate(ids, max_new_tokens=n, do_sample=False, pad_token_id=tok.eos_token_id)
    return tok.decode(out[0, ids.shape[1] :])


def sample_next(context: str, temperature: float, n: int) -> list[str]:
    gen = torch.Generator().manual_seed(SEED + int(temperature * 100))
    p = next_probs(context, temperature)
    picks = torch.multinomial(p, n, replacement=True, generator=gen)
    return [show(int(t)) for t in picks.tolist()]


# ── files ────────────────────────────────────────────────────────────────────────


def next_token() -> dict:
    cold = "I poured milk into my"
    cat = "The cat sat on the"
    cat_words = ["floor", "bed", "couch", "mat", "moon"]
    cat_bars = sorted(bars(cat, cat_words), key=lambda t: -t["p"])
    cold_bars = bars(cold, ["coffee", "tea", "cereal", "bowl"])
    # The probability-bars loop shows the props' own context and tokens for run 1 and loop.steps[i - 1]
    # for run i + 1, so the first distribution is written separately as loopStart.
    first, *rest = greedy_steps(cat, 4)
    return {
        "meta": meta("Next-token distributions for the next-token card (catSat, the loop) and its milk question (coldOpen)."),
        "coldOpen": {"context": cold, "tokens": cold_bars, "probs": [t["p"] for t in cold_bars], "top": top(cold, 5)},
        "catSat": {"context": cat, "tokens": cat_bars, "ranking": [t["text"] for t in cat_bars], "top": top(cat, 5)},
        "loopStart": first,
        "loop": {"steps": rest},
        "replyLengths": {"note": "Rule of thumb, not model output: about 1.3 GPT-style tokens per English word."},
    }


def sampling() -> dict:
    colour = "My favourite colour is"
    oz = "The capital of Australia is the city of"
    temps = [0.1, 0.5, 1.0, 1.5]
    return {
        "meta": meta("Temperature reshaping and seeded samples for the sampling and hallucination nodes."),
        "colour": {
            "context": colour,
            "tokens": top(colour, 6),
            "byTemperature": {str(t): top(colour, 6, t) for t in temps},
            "samples": [{"temperature": t, "outputs": sample_next(colour, t, 10)} for t in temps],
        },
        "australia": {
            "context": oz,
            "tokens": bars(oz, ["Sydney", "Canberra", "Melbourne", "Perth"]),
            "top": top(oz, 5),
            "greedy": greedy_text(oz, 1).strip(),
            "samples": [{"temperature": t, "outputs": sample_next(oz, t, 10)} for t in [0.1, 1.0]],
        },
    }


def hallucination() -> dict:
    prompts = [
        "The tallest mountain in Africa is Mount",
        "Albert Einstein was born in the year",
        "The capital of Australia is the city of",
    ]
    citation = "As the court held in"
    return {
        "meta": meta("Greedy (temperature 0) continuations: same input, same output, true or not."),
        "greedy": [{"context": c, "continuation": greedy_text(c, 6).strip()} for c in prompts],
        "everest": {"context": prompts[0], "tokens": top(prompts[0], 5)},
        "citation": {"steps": greedy_steps(citation, 6)},
        "citationText": citation + greedy_text(citation, 6),
    }


def pretraining() -> dict:
    qa = "Q: What is the capital of France?\nA:"
    water = "Water is made of hydrogen and"
    return {
        "meta": meta("What a base (pretrained-only) model knows and how it behaves: facts as next-token odds, "
                     "and a Q&A prompt continued as a document."),
        "water": {"context": water, "tokens": top(water, 5)},
        "qa": {"prompt": qa, "continuation": greedy_text(qa, 20)},
        "weights": {"parameters": N_PARAMS, "bytesFloat32": N_PARAMS * 4},
        "webText": {"gigabytes": 40, "documents": 8_000_000, "source": "Radford et al. 2019 (reported, not computed)"},
    }


EMBED_WORDS = {
    "animals": ["cat", "dog", "horse", "cow", "lion"],
    "food": ["bread", "cheese", "pizza", "soup", "rice"],
    "money": ["money", "cash", "loan", "bank", "profit"],
    "water": ["river", "lake", "ocean", "water", "shore"],
    "people": ["king", "queen", "man", "woman", "prince"],
}


def tsne(dist: np.ndarray, perplexity: float, seed: int, iters: int = 1500) -> np.ndarray:
    """Exact t-SNE for a few dozen points (van der Maaten & Hinton 2008), numpy only."""
    rng = np.random.default_rng(seed)
    n = dist.shape[0]
    p = np.zeros((n, n))
    for i in range(n):
        lo, hi = 1e-3, 1e3
        for _ in range(60):  # binary search for the precision that matches the perplexity
            beta = (lo + hi) / 2
            row = np.exp(-(dist[i] ** 2) * beta)
            row[i] = 0
            row /= row.sum()
            entropy = -(row[row > 0] * np.log(row[row > 0])).sum()
            lo, hi = (beta, hi) if entropy > np.log(perplexity) else (lo, beta)
        p[i] = row
    p = (p + p.T) / (2 * n)
    y = rng.normal(0, 1e-2, (n, 2))
    vel = np.zeros_like(y)
    for it in range(iters):
        sq = ((y[:, None] - y[None]) ** 2).sum(-1)
        q = 1 / (1 + sq)
        np.fill_diagonal(q, 0)
        qn = q / q.sum()
        exaggeration = 4 if it < 250 else 1
        grad = 4 * (((exaggeration * p - qn) * q)[:, :, None] * (y[:, None] - y[None])).sum(1)
        vel = (0.5 if it < 250 else 0.8) * vel - 100 * grad
        y = y + vel
    return y


def embeddings() -> dict:
    wte = model.transformer.wte.weight.detach().numpy().astype(np.float64)
    labels = [w for ws in EMBED_WORDS.values() for w in ws]
    clusters = [c for c, ws in EMBED_WORDS.items() for _ in ws]
    x = np.array([wte[single_token(w)] for w in labels])
    unit = x / np.linalg.norm(x, axis=1, keepdims=True)
    sim = unit @ unit.T  # cosine similarity in all 768 dimensions
    full_nearest = {w: [labels[j] for j in np.argsort(-sim[i]) if j != i][:3] for i, w in enumerate(labels)}
    idx = {w: i for i, w in enumerate(labels)}

    target = x[idx["king"]] - x[idx["man"]] + x[idx["woman"]]
    target_sim = unit @ (target / np.linalg.norm(target))
    analogy_rank = [
        (labels[j], float(target_sim[j])) for j in np.argsort(-target_sim) if labels[j] not in {"king", "man", "woman"}
    ]

    # A flat map for the widget. The widget measures neighbours and analogies in 2D, so the map must
    # keep them: t-SNE over cosine distance, with the seed (0-9) that agrees best with the full space.
    def score(xy: np.ndarray) -> tuple[int, bool]:
        d = np.linalg.norm(xy[:, None] - xy[None], axis=-1)
        agree = sum(labels[[j for j in np.argsort(d[i]) if j != i][0]] == full_nearest[w][0] for i, w in enumerate(labels))
        t = xy[idx["king"]] - xy[idx["man"]] + xy[idx["woman"]]
        order = [labels[j] for j in np.argsort(np.linalg.norm(xy - t, axis=1)) if labels[j] not in {"king", "man", "woman"}]
        return agree, order[0] == analogy_rank[0][0]

    best = None
    for seed in range(10):
        xy = tsne(1 - sim, perplexity=5, seed=seed)
        agree, analogy_ok = score(xy)
        key = (analogy_ok, agree)
        if best is None or key > best[0]:
            best = (key, seed, xy)
    assert best is not None
    (analogy_ok, agree), tsne_seed, xy = best
    lo, hi = xy.min(axis=0), xy.max(axis=0)
    xy = 0.08 + 0.84 * (xy - lo) / (hi - lo)

    def table_cos(a_word: str, b_word: str) -> float:
        a, b = wte[single_token(a_word)], wte[single_token(b_word)]
        return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))

    # Same token, two contexts: identical table row, different vectors after the stack.
    def bank_vec(sentence: str, layer: int) -> np.ndarray:
        ids = ids_of(sentence)
        pos = [i for i, t in enumerate(ids[0].tolist()) if t == single_token("bank")][0]
        hs = model(ids, output_hidden_states=True).hidden_states
        return hs[layer][0, pos].numpy().astype(np.float64)

    def cos(a: np.ndarray, b: np.ndarray) -> float:
        return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))

    a, b = "She sat on the river bank", "She robbed the bank"
    return {
        "meta": meta("GPT-2 input-embedding (wte) rows for 25 words, drawn as a flat t-SNE map."),
        "projection": {
            "method": "t-SNE (perplexity 5) over cosine distance between the 25 rows",
            "seed": tsne_seed,
            "nearestNeighbourAgreement": f"{agree}/{len(labels)}",
            "analogyHoldsOnMap": bool(analogy_ok),
            "note": "Seed picked from 0-9 to best keep each word's nearest neighbour and the king - man + woman "
            "result from the full 768 dimensions. Distances on the map are not to scale.",
        },
        "points": [
            {"id": w, "label": w, "xy": [r4(p[0]), r4(p[1])], "cluster": c} for w, p, c in zip(labels, xy.tolist(), clusters)
        ],
        "nearest": {w: full_nearest[w] for w in ["cat", "bank", "river", "money", "queen", "pizza"]},
        "catCompare": {w: r4(table_cos("cat", w)) for w in ["dog", "car", "cap", "catalog"]},
        "analogy": {"expr": "king - man + woman", "ranked": [[o, r4(v)] for o, v in analogy_rank[:5]]},
        "bank": {
            "sentences": [a, b],
            "sameTokenId": single_token("bank"),
            "cosineTableRow": 1.0,
            "cosineAfterLayer": {str(l): r4(cos(bank_vec(a, l), bank_vec(b, l))) for l in [1, 3, 6, 9, N_LAYER]},
            "note": "GPT-2's final-layer states share a few huge dimensions, so cosine there is close to 1 for almost "
            "any pair; the middle layers show the contextual drift.",
        },
    }


TRACE_INPUTS = [
    ("cat", "The cat sat on the"),
    ("milk", "I poured milk into my"),
    ("peanut", "Peanut butter and"),
    ("water", "Water is made of hydrogen and"),
    ("once", "Once upon a time, there was a"),
    ("everest", "The tallest mountain in Africa is Mount"),
]


def trace(text: str, index: int) -> dict:
    ids = ids_of(text)
    n = ids.shape[1]
    out = model(ids, output_hidden_states=True, output_attentions=True)
    pieces = [tok.decode([t]) for t in ids[0].tolist()]
    # Attention from the last token, last layer, heads averaged. GPT-2 parks much of its attention
    # on the first token (an "attention sink"), so we report the strongest link among the others.
    att = out.attentions[-1][0, :, -1, :].mean(dim=0)
    sink = float(att[0])
    others = att[1:-1] if n > 2 else att[:1]
    j = int(others.argmax()) + (1 if n > 2 else 0)
    # Logit lens: what the stack would predict halfway up, read through the final layer norm + head.
    # hidden_states[L] is the residual stream after L blocks (hidden_states[12] already has ln_f applied).
    def lens(layer: int) -> dict:
        h = out.hidden_states[layer][0, -1]
        logits = model.lm_head(h if layer == N_LAYER else model.transformer.ln_f(h))
        pr = torch.softmax(logits, -1)
        k = int(pr.argmax())
        return {"block": layer, "pick": show(k), "p": r4(pr[k])}

    lens_steps = [lens(layer) for layer in range(0, N_LAYER + 1, 2)]
    mid_pick = next(step["pick"] for step in lens_steps if step["block"] == N_LAYER // 2)
    p = torch.softmax(out.logits[0, -1], dim=-1)
    v, i = p.topk(5)
    top5 = [{"text": show(int(t)), "p": r4(x)} for x, t in zip(v.tolist(), i.tolist())]
    final_pick = top5[0]["text"]
    # Sampled the way products usually do: temperature 0.8 plus nucleus (top-p 0.9) truncation.
    gen = torch.Generator().manual_seed(SEED + 101 * (index + 1))
    probs = torch.softmax(out.logits[0, -1] / 0.8, -1)
    sorted_p, order = probs.sort(descending=True)
    keep = sorted_p.cumsum(0) - sorted_p < 0.9
    nucleus = torch.zeros_like(probs).scatter(0, order[keep], sorted_p[keep])
    sampled = show(int(torch.multinomial(nucleus / nucleus.sum(), 1, generator=gen)))
    return {
        "text": text,
        "tokens": [{"text": s, "id": t} for s, t in zip(pieces, ids[0].tolist())],
        "tokenCount": n,
        "attention": {
            "layer": N_LAYER,
            "from": pieces[-1].strip(),
            "strongest": pieces[j].strip(),
            "weight": r4(att[j]),
            "firstTokenShare": r4(sink),
        },
        "midStackPick": mid_pick,
        "lens": lens_steps,
        "finalPick": final_pick,
        "top": top5,
        "sampledAt08": sampled,
    }


def fmt_tokens(t: dict) -> str:
    return " | ".join(x["text"].replace(" ", "·") for x in t["tokens"])


def traces() -> dict:
    inputs = []
    for index, (key, text) in enumerate(TRACE_INPUTS):
        t = trace(text, index)
        t["id"] = key
        # Keys follow the data flow through the model: tokenizer, embedding rows, the job (score the
        # next slot), window, attention, the stack, then the sampler rolling over the final scores.
        t["steps"] = {
            "tokens": f"{t['tokenCount']} tokens: {fmt_tokens(t)}",
            "embeddings": f"each token becomes {D_MODEL} numbers",
            "next-token": f"the job: score all {VOCAB:,} tokens for slot {t['tokenCount'] + 1}",
            "context-window": f"{t['tokenCount']} of {N_CTX:,} slots used",
            # GPT-2 parks most attention on the first token (a "sink"); say so, then name the real link.
            "attention": f"\"{t['attention']['from']}\" looks hardest at \"{t['attention']['strongest']}\""
            + f" (after the {t['attention']['firstTokenShare'] * 100:.0f}% parked on \"{t['tokens'][0]['text'].strip()}\")",
            "transformer": f"block 6 guesses \"{t['midStackPick']}\", block {N_LAYER} says \"{t['finalPick']}\"",
            "sampling": ", ".join(f"{x['text']} {x['p'] * 100:.1f}%" for x in t["top"][:3])
            + f" → rolled at temperature 0.8, top-p 0.9: \"{t['sampledAt08']}\"",
        }
        inputs.append(t)
    return {
        "meta": meta(
            "Per-sentence traces through GPT-2. Attention: last layer, heads averaged, strongest link from the last "
            "token excluding the first token (which GPT-2 uses as an attention sink)."
        ),
        "model": {"layers": N_LAYER, "width": D_MODEL, "contextLength": N_CTX, "parameters": N_PARAMS},
        "inputs": inputs,
    }


FILES = {
    "next-token": next_token,
    "sampling": sampling,
    "hallucination": hallucination,
    "pretraining": pretraining,
    "embeddings": embeddings,
    "traces": traces,
}


def canonical(data: dict) -> dict:
    """Drop fields that change on every run (for --check)."""
    clean = json.loads(json.dumps(data))
    clean["meta"].pop("generatedAt", None)
    clean["meta"].pop("libraries", None)
    return clean


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=sorted(FILES), action="append")
    ap.add_argument("--check", action="store_true", help="recompute and fail if the committed numbers differ")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    names = args.only or list(FILES)
    args.out.mkdir(parents=True, exist_ok=True)
    changed = []
    written = []
    for name in names:
        data = FILES[name]()
        path = args.out / f"{name}.json"
        if args.check:
            old = json.loads(path.read_text()) if path.exists() else None
            if old is None or canonical(old) != canonical(data):
                changed.append(name)
            continue
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        written.append(str(path))
        print(f"wrote {path.relative_to(ROOT)}")
    if args.check:
        if changed:
            print("numbers differ from the committed data:", ", ".join(changed))
            return 1
        print("committed data matches GPT-2")
        return 0
    # Keep the committed JSON in the repo's formatter style (biome); skip quietly if bun is missing.
    try:
        subprocess.run(["bun", "x", "biome", "format", "--write", *written], cwd=ROOT, check=False, capture_output=True)
    except FileNotFoundError:
        print("bun not found: run `bun x biome format --write packs/how-llms-work/data` before committing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
