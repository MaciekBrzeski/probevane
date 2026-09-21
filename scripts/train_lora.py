#!/usr/bin/env python
"""LoRA fine-tune a local coder model on probevane's accepted-test traces.

Scaffold — DO NOT assume a GPU is free. Run only when the RDNA4 is idle.

RDNA4 / ROCm notes (hard-won):
  - Use a venv with a ROCm build of torch + peft (system torch may not match your GPU)
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


def vram_free_gb():
    """(free, total) GB on the active AMD GPU via sysfs; (None, None) if unknown."""
    import glob
    best = None
    for used in glob.glob("/sys/class/drm/card*/device/mem_info_vram_used"):
        total = used.replace("_used", "_total")
        try:
            t = int(open(total).read()) / 2**30
            u = int(open(used).read()) / 2**30
        except OSError:
            continue
        if best is None or t > best[1]:  # the dGPU is the biggest-VRAM card
            best = (t - u, t)
    return best if best else (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    ap.add_argument("--data", required=True)
    ap.add_argument("--val", default=None)
    ap.add_argument("--out", default="adapter")
    ap.add_argument("--epochs", type=int, default=5)  # fourier-nca: 5 epochs converged on a small clean set
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--load-4bit", action="store_true",
                    help="QLoRA: load the base in 4-bit (smallest VRAM — use when sharing the GPU)")
    ap.add_argument("--max-vram-frac", type=float, default=0.0,
                    help="cap this process to a fraction of total VRAM (e.g. 0.55 when another job runs)")
    ap.add_argument("--min-free-gb", type=float, default=8.0,
                    help="refuse to start if less than this much VRAM is free (co-run guard)")
    ap.add_argument("--allow-shared-gpu", action="store_true",
                    help="proceed even if the GPU is busy / low on free VRAM (you accept the freeze risk)")
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

    # --- GPU path (runs only when explicitly invoked) ---
    if "HSA_OVERRIDE_GFX_VERSION" in os.environ:
        sys.exit("[train] refuse: HSA_OVERRIDE_GFX_VERSION set — breaks RDNA4. unset it.")
    os.environ.setdefault("HIP_VISIBLE_DEVICES", "0")
    os.environ.setdefault("PYTORCH_HIP_ALLOC_CONF", "expandable_segments:True")

    # Co-run guard — the GPU is single-tenant on this box; heavy co-load has
    # frozen it before. Refuse to start if VRAM is tight unless told otherwise.
    free_gb, total_gb = vram_free_gb()
    if free_gb is not None:
        print(f"[train] VRAM: {free_gb:.1f}GB free / {total_gb:.1f}GB total")
        if free_gb < args.min_free_gb and not args.allow_shared_gpu:
            sys.exit(f"[train] refuse: only {free_gb:.1f}GB free (< --min-free-gb {args.min_free_gb}). "
                     f"Another job is likely training. Wait, or re-run with --load-4bit --max-vram-frac 0.5 --allow-shared-gpu "
                     f"(accepts slower + freeze risk). 7B bf16 needs ~14GB; prefer the 3B base + --load-4bit when sharing.")

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

    # Per-process VRAM cap — keep this job inside its lane when sharing the GPU.
    if args.max_vram_frac > 0 and torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(args.max_vram_frac, 0)
        print(f"[train] capped to {args.max_vram_frac:.0%} of VRAM")

    load_kw = dict(device_map="auto")
    if args.load_4bit:
        from transformers import BitsAndBytesConfig  # noqa: E402
        load_kw["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True)  # 4-bit-within-4-bit → more VRAM headroom (fourier-nca lesson)
        print("[train] QLoRA: base in 4-bit (double-quant)")
    else:
        load_kw["torch_dtype"] = torch.bfloat16
    model = AutoModelForCausalLM.from_pretrained(args.base, **load_kw)
    if args.load_4bit:
        from peft import prepare_model_for_kbit_training  # noqa: E402
        model = prepare_model_for_kbit_training(model)
    model.gradient_checkpointing_enable()
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05,
        # All linear layers incl the MLP (gate/up/down), not just attention — more
        # capacity to learn the test-writing CONVENTION (fourier-nca measured lesson).
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=args.out, num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.grad_accum,
            # cosine schedule + brief warmup — fourier-nca's proven LoRA recipe.
            learning_rate=args.lr, lr_scheduler_type="cosine", warmup_ratio=0.05,
            bf16=True, logging_steps=5, save_strategy="epoch", report_to=[]),
        train_dataset=ds,
    ).train()
    model.save_pretrained(args.out)
    print(f"[train] LoRA adapter saved → {args.out}")
    print("[train] serve: load base+adapter in vLLM/llama.cpp OpenAI server, then "
          "probevane generate --model local:<served-name>")


if __name__ == "__main__":
    main()
