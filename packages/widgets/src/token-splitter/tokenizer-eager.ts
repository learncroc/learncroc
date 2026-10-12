/**
 * Installs the cl100k_base encoder synchronously. Imported for its side effect by
 * "@learncroc/widgets/spec" so the server, the CLI and the static demo can grade token-splitter
 * goals without an async step.
 */
import { decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import { installTokenizer } from "./tokenize";

installTokenizer({ encode, decode });
