"""Benchmark: how well does FreshCheck flag stale claims?
  python eval.py                 Gemini + Tavily (needs both keys)
  python eval.py --rules         no-AI baseline (rule extraction + keyword matching)
  python eval.py --out report.md also write a Markdown report (put the numbers in your README)
  python eval.py --sleep 5       seconds between items (free Gemini tiers are rate-limited; default 12 with AI, 0 without)
  python eval.py --limit 10      only the first N items per group (quick smoke run)
Labels are facts that are definitely stale, or definitely still true, as of late 2026. Re-verify any you edit.
Three groups, so the score cannot be won by flagging everything that looks time-sensitive:
  stale      claims that used to be true and are now wrong
  fresh-hard historical claims that LOOK time-sensitive (versions, leaders, laws) but are still correct
  fresh-easy stable facts"""
import sys, time, argparse, collections
import app

STALE = [
 ("Twitter is led by CEO Jack Dorsey.", "leadership"), ("The latest stable Python version is 3.11.", "version"),
 ("The EU AI Act has not yet come into force.", "law"), ("The UK is a member of the European Union.", "law"),
 ("The parent company of Instagram is called Facebook, Inc.", "current"), ("The latest iPhone is the iPhone 12.", "version"),
 ("Python 2.7 is the current recommended Python version.", "version"), ("Angela Merkel is the Chancellor of Germany.", "leadership"),
 ("Boris Johnson is the UK prime minister.", "leadership"), ("Windows 11 has not been released yet.", "version"),
 ("The latest Ubuntu LTS release is 22.04.", "version"), ("Node.js 18 is the current active LTS release of Node.js.", "version"),
 ("Queen Elizabeth II is the reigning monarch of the United Kingdom.", "leadership"),
 ("Pope Francis is the current head of the Catholic Church.", "leadership"), ("Bitcoin is trading below $10,000.", "pricing"),
 ("ChatGPT is powered by GPT-3.5.", "version"), ("The most recent Summer Olympics were held in Tokyo.", "current"),
 ("The latest Apple silicon chip for Macs is the M1.", "version"), ("Twitter is the name of the social network owned by Elon Musk.", "current"),
 ("The next FIFA men's World Cup will be held in Qatar.", "current"), ("Python 3.12 is the latest stable release of Python.", "version"),
 ("GPT-4 is OpenAI's newest model.", "version"), ("The iPhone 15 is Apple's newest iPhone.", "version"),
 ("Google Bard is Google's conversational AI assistant.", "current")]
FRESH_HARD = [
 ("The EU AI Act entered into force in August 2024.", "law"), ("Python 3.12 was released in October 2023.", "version"),
 ("Python 3.11 was released in October 2022.", "version"), ("Angela Merkel served as Chancellor of Germany from 2005 to 2021.", "leadership"),
 ("The UK left the European Union on 31 January 2020.", "law"), ("Elon Musk completed his acquisition of Twitter in October 2022.", "current"),
 ("Python 2 reached end of life on 1 January 2020.", "version"), ("Ubuntu 24.04 LTS was released in April 2024.", "version"),
 ("Queen Elizabeth II died in September 2022.", "leadership"), ("Pope Francis died in April 2025.", "leadership"),
 ("Node.js 18 reached end of life in April 2025.", "version"), ("The Tokyo Olympics were held in 2021 after a one-year delay.", "current"),
 ("Windows 11 was released in October 2021.", "version"), ("GDPR became enforceable in May 2018.", "law"),
 ("Boris Johnson resigned as UK prime minister in 2022.", "leadership")]
FRESH_EASY = [
 ("Tokyo is the capital of Japan.", "stable"), ("Mount Everest is the highest mountain above sea level.", "stable"),
 ("Meta Platforms is the parent company of Facebook and Instagram.", "current")]

ap = argparse.ArgumentParser()
ap.add_argument("--rules", action="store_true"); ap.add_argument("--sleep", type=int); ap.add_argument("--out"); ap.add_argument("--limit", type=int)
a = ap.parse_args()
if a.rules: app.GEMINI_KEY = ""   # baseline: rule-based extraction and keyword matching only
pause = a.sleep if a.sleep is not None else (12 if app.GEMINI_KEY else 0)
lim = lambda xs: xs[:a.limit] if a.limit else xs
DATA = [(t, True, c, "stale") for t, c in lim(STALE)] + [(t, False, c, "fresh-hard") for t, c in lim(FRESH_HARD)] + \
       [(t, False, c, "fresh-easy") for t, c in lim(FRESH_EASY)]

tp = fp = fn = tn = 0; misses = []; by_cat = collections.defaultdict(lambda: [0, 0]); by_grp = collections.defaultdict(lambda: [0, 0])
for text, is_stale, cat, grp in DATA:
    try: res = app.analyze_text(text, persist=False)
    except Exception as e: print("error:", e); continue
    pred = any(c["status"] == "stale" for c in res["claims"]); ok = pred == is_stale
    tp += pred and is_stale; fp += pred and not is_stale; fn += (not pred) and is_stale; tn += (not pred) and not is_stale
    by_cat[cat][0] += ok; by_cat[cat][1] += 1; by_grp[grp][0] += ok; by_grp[grp][1] += 1
    if not ok: misses.append((text, "flagged stale (false alarm)" if pred else "missed (still stale)"))
    print(("OK  " if ok else "MISS"), text); time.sleep(pause)
n = tp + fp + fn + tn; prec = tp / max(tp + fp, 1); rec = tp / max(tp + fn, 1); f1 = 2 * prec * rec / max(prec + rec, 1e-9)
mode = "Gemini + Tavily" if app.GEMINI_KEY else "rule-based baseline"
rows = [f"Mode: {mode} | items: {n}", f"Accuracy {(tp + tn) / max(n, 1):.0%} | stale precision {prec:.0%} | stale recall {rec:.0%} | F1 {f1:.0%}"]
rows += [f"  {g}: {s}/{m} correct" for g, (s, m) in by_grp.items()] + [f"  category {c}: {s}/{m} correct" for c, (s, m) in sorted(by_cat.items())]
rows += [f"  {m}: {t}" for t, m in misses]
print("\n" + "\n".join(rows))
if a.out:
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(f"# FreshCheck evaluation ({time.strftime('%Y-%m-%d')})\n\n```\n" + "\n".join(rows) + "\n```\n")
    print("wrote", a.out)
