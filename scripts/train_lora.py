#!/usr/bin/env python
"""LoRA fine-tune a local coder model on probevane's accepted-test traces.

Scaffold — DO NOT assume a GPU is free. Run only when the RDNA4 is idle.

RDNA4 / ROCm notes (hard-won, see workspace memory feedback_rdna4_rocm_lora_train):
  - Use the working venv:  ~/Dokumenty/100-monkeys/.lora-venv
  - export HIP_VISIBLE_DEVICES=0
  - export PYTORCH_HIP_ALLOC_CONF=expandable_segments:True
  - DO NOT set HSA_OVERRIDE_GFX_VERSION (breaks RDNA4)
  - GPU is single-tenant — heavy work freezes the desktop; don't co-run a game.

Distill the DISCIPLINE, not facts (facts stay in RAG/context) — so keep the base
small (1.5B–7B coder), LoRA rank modest, and the dataset tight (~200 good traces).

Usage:
  python scripts/train_lora.py --base Qwen/Qwen2.5-Coder-7B-Instruct \
      --data ~/.local/share/probevane/distill/train.jsonl \
      --val  ~/.local/share/probevane/distill/val.jsonl \
      --out  ~/.local/share/probevane/distill/adapter
"""
import argparse
import json
import os
import sys


def load_chat_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    ap.add_argument("--data", required=True)
    ap.add_argument("--val", default=None)
    ap.add_argument("--out", default="adapter")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--validate-only", action="store_true",
                    help="parse the dataset + print the plan, then exit (no GPU)")
    args = ap.parse_args()

    data = load_chat_jsonl(args.data)
    print(f"[train] {len(data)} training example(s) from {args.data}")
    if len(data) < 50:
        print("[train] WARNING: <50 examples — collect more traces (PROBEVANE_TRACES=1) before training.")

    if args.validate_only:
        print("[train] validate-only: dataset parses. Plan:")
        print(f"  base={args.base} rank={args.rank} epochs={args.epochs} "
              f"batch={args.batch}x{args.grad_accum} lr={args.lr} max_len={args.max_len}")
        return

    # --- GPU path (runs only when explicitly invoked on an idle RDNA4) ---
    if "HSA_OVERRIDE_GFX_VERSION" in os.environ:
        sys.exit("[train] refuse: HSA_OVERRIDE_GFX_VERSION set — breaks RDNA4. unset it.")
    os.environ.setdefault("HIP_VISIBLE_DEVICES", "0")
    os.environ.setdefault("PYTORCH_HIP_ALLOC_CONF", "expandable_segments:True")

    import torch  # noqa: E402  (deferred — avoids import cost on validate-only)
    from datasets import Dataset  # noqa: E402
    from peft import LoraConfig, get_peft_model  # noqa: E402
    from transformers import (AutoModelForCausalLM, AutoTokenizer,  # noqa: E402
                              TrainingArguments, Trainer)

    tok = AutoTokenizer.from_pretrained(args.base)
    tok.pad_token = tok.pad_token or tok.eos_token

    def fmt(ex):
        text = tok.apply_chat_template(ex["messages"], tokenize=False)
        enc = tok(text, truncation=True, max_length=args.max_len, padding="max_length")
        enc["labels"] = enc["input_ids"].copy()
        return enc

    ds = Dataset.from_list(data).map(fmt, remove_columns=["messages"])
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.bfloat16, device_map="auto")
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"], task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=args.out, num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.grad_accum,
            learning_rate=args.lr, bf16=True, logging_steps=5, save_strategy="epoch",
            report_to=[]),
        train_dataset=ds,
    ).train()
    model.save_pretrained(args.out)
    print(f"[train] LoRA adapter saved → {args.out}")
    print("[train] serve: load base+adapter in vLLM/llama.cpp OpenAI server, then "
          "probevane generate --model local:<served-name>")


if __name__ == "__main__":
    main()
