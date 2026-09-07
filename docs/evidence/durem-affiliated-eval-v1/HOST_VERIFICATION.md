# Measurement-Host Verification — attempt 1

**Result: FAILED. This host is not the Sutainbuyant measurement host.**
**Date:** 2026-08-29
**Contract commit at time of attempt:** `e7f08e6`
**Consequence:** host data collection, fixture construction, and contract freeze did **not** proceed.
No values were recorded for any pending field in `PREREGISTRATION.md` section 14.

This document is negative evidence and is retained deliberately. A preregistration whose provenance
rows were filled in without a record of where the numbers came from would not be auditable.

---

## 1. What was checked

Verification ran against `PREREGISTRATION.md` section 4, which requires a host with the Lemonade
runtime, the Qwen3 model files, and hardware capable of serving them.

| Check | Method | Result |
|---|---|---|
| Hostname | `$env:COMPUTERNAME` | `BEBE` |
| Machine | `Win32_ComputerSystem` | TOSHIBA dynabook Satellite T652/W4UGB |
| CPU | `Win32_Processor` | Intel Core i7-3630QM @ 2.40 GHz (Ivy Bridge, 2012), 4 physical / 8 logical |
| RAM | `Win32_ComputerSystem` | 7.89 GB |
| GPU | `Win32_VideoController` | Intel HD Graphics 4000 (integrated, 2012) |
| **NPU** | `Win32_PnPEntity` matched against `NPU\|Neural\|AI Boost\|IPU\|Ryzen AI\|XDNA` | **none present** — the only matches were USB input devices |
| OS | `Win32_OperatingSystem` | Windows 11 Pro 10.0.26200, build 26200 |
| Lemonade process | `Get-Process` matched against `lemonade\|llama\|ollama` | **no process** |
| Lemonade package | `winget list --name lemonade` | **not installed** |
| Lemonade install paths | 5 standard locations probed | **all absent** |
| Lemonade Python packages | `pip list` filtered for `lemonade\|llama\|onnx\|torch` | **none** |
| Runtime endpoint | `GET http://127.0.0.1:13305/v1/models` | **connection actively refused** |
| Listening ports | `Get-NetTCPConnection` on 13305, 11434, 8080, 5000 | **nothing listening** |
| Model files | recursive `*.gguf` search across the user profile and `D:\` | **none found** |
| DUREM database | recursive `durem.db` search across the user profile, `D:\`, `C:\ProgramData` | **none found** |

## 2. Why this is a hard failure, not a slow host

The host is the same machine already disqualified in `PREREGISTRATION.md` section 4.1. Re-verification
confirms it and adds two findings that were not previously established:

1. **No NPU of any kind is present.** Lemonade is AMD's Ryzen AI runtime and DUREM ships
   `setup-amd-windows.ps1` for it. There is no Ryzen AI, XDNA, or Intel AI Boost device here, so the
   accelerated path DUREM is built around does not exist on this machine.
2. **No DUREM deployment data is present.** There is no `durem.db` anywhere on the searched volumes.
   The real audit history — the input to step 2 of the collection task — is not on this machine.

Together these mean that **none** of the six collection steps could be completed truthfully:

| Step | Blocked because |
|---|---|
| 1. Host / runtime / model identity | no runtime, no model files, no NPU; hardware is the disqualified host |
| 2. Audit-log frequencies | no `durem.db` on this machine |
| 3. R1 sanitized fixtures | the real corpus lives on the deployment host, alongside the database |
| 4. Cost / runtime inputs | nothing to measure; no runtime to exercise |
| 5. Fill pending preregistration fields | every pending field depends on steps 1–4 |
| 6. Freeze the contract | a freeze over fabricated provenance would be worthless |

## 3. What was not done, and why

No values were invented for any field. Specifically, the following were **left empty** rather than
estimated, defaulted, or inferred from the repository:

- Lemonade version, `/v1/models` response, model file names, quantization, and file hashes;
- host CPU/NPU/GPU/RAM/storage for the *measurement* host (the values above describe the
  **inspection** host and are recorded as a disqualification record, not as host provenance);
- observed audit window, answer-row count, and category frequencies;
- corpus and case hashes;
- any dollar figure or power measurement.

Reporting the inspection host's specifications in the provenance rows would have produced a
preregistration that looked complete and described the wrong machine. That is the specific failure
mode this evaluation exists to avoid.

## 4. What was produced instead

Two collection tools, so that the next attempt on the correct host is a single command each. Both
were syntax-checked here; neither has been executed against real data.

| Tool | Purpose | Privacy property |
|---|---|---|
| `tools/collect_host_provenance.ps1` | hardware, OS, storage, NPU detection, Lemonade version, verbatim `/v1/models`, SHA-256 of every `.gguf` found, platform power telemetry if exposed | emits no company data, no credentials, no user content |
| `tools/measure_audit_distribution.py` | opens `durem.db` **read-only**; emits the UTC window, answer-row count, routing-setting stability, admin/test exclusions, and the eight observable category frequencies | an allow-list restricts which `metadata_json` keys may be read; `question` and `sources` values are excluded in code, not by convention |

`collect_host_provenance.ps1` computes `qualifies_as_measurement_host` itself — Lemonade reachable,
at least one model file hashed, and RAM at least 16 GB — so the next host is checked against a stated
criterion rather than an impression.

`measure_audit_distribution.py` evaluates the preregistered validity conditions and prints
`FALL_BACK_TO_PREREGISTERED_ASSUMED_MIX` when they are not met. It does not blend a marginal window
with assumptions.

## 5. Next attempt

Run on the real Sutainbuyant measurement host:

```powershell
.\collect_host_provenance.ps1 -Out host_provenance.json
```

```bash
python measure_audit_distribution.py --db <path>\durem.db --out observed_distribution.json
```

Both outputs are safe to commit. `host_provenance.json` fills section 14's host, runtime and model
rows; `observed_distribution.json` fills section 14.1's observed rows or triggers the documented
fallback. Fixture construction (step 3) and the freeze (steps 5–6) follow once both exist.
