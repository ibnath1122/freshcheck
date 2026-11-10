"""Client for FreshCheck. Usage:
    from freshcheck_sdk import FreshCheck
    fc = FreshCheck()                       # FRESHCHECK_URL / FRESHCHECK_API_KEY env vars, or pass base= and api_key=
    report = fc.check(llm_text)             # full report: trust score, claims, corrected_answer, security
    safe_text = fc.fix(llm_text)            # corrected answer (or the original if nothing was stale)
    @fc.guard                               # wrap any function that returns LLM text
    def answer(question): ...
    # Through the gateway (FreshCheck in front of Bifrost):
    reply = fc.chat([{"role": "user", "content": "Latest Python?"}], model="openai/gpt-4o-mini", autofix=True)
    job = fc.chat(..., mode="async"); result = fc.wait(job["freshness"]["job_id"])
"""
import functools, os, time, requests

class FreshCheck:
    def __init__(self, base=None, api_key=None, timeout=180):
        self.base = (base or os.getenv("FRESHCHECK_URL", "http://localhost:5000")).rstrip("/")
        self.headers = {"X-API-Key": api_key or os.getenv("FRESHCHECK_API_KEY", "")}; self.timeout = timeout

    def _post(self, path, body, extra=None):
        r = requests.post(self.base + path, json=body, headers={**self.headers, **(extra or {})}, timeout=self.timeout)
        r.raise_for_status(); return r.json()

    def check(self, text): return self._post("/api/analyze", {"answer": text})
    def fix(self, text): return self.check(text).get("corrected_answer") or text

    def guard(self, fn):
        @functools.wraps(fn)
        def wrapper(*a, **k): return self.fix(fn(*a, **k))
        return wrapper

    def chat(self, messages, model, autofix=False, mode="inline", min_score=None, authorization=None, **extra):
        """OpenAI-style call through the FreshCheck gateway. mode: inline | async | off. Streaming is passed through unchecked."""
        body = {"model": model, "messages": messages, "freshcheck": mode, **extra}
        if autofix: body["freshcheck_autofix"] = True
        if min_score is not None: body["freshcheck_min_score"] = min_score
        return self._post("/v1/chat/completions", body, {"Authorization": authorization} if authorization else None)

    def wait(self, job_id, every=2, max_wait=180):
        """Poll an async gateway job until it finishes; returns the full report."""
        end = time.time() + max_wait
        while time.time() < end:
            r = requests.get(f"{self.base}/api/jobs/{job_id}", headers=self.headers, timeout=30); r.raise_for_status(); j = r.json()
            if j["status"] != "pending": return j.get("result") or j
            time.sleep(every)
        raise TimeoutError("job still running")
