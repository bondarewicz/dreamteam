https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents

What you already do well

- Hybrid grading (Coach K automated + human override) -- matches the recommended layered approach
- Environment isolation -- fresh Agent session per scenario, parallel execution
- Crash resilience -- three-layer durability (raw output, JSONL checkpoint, final JSON)
- Calibration tracking -- calibration_gap metric measures Coach K confidence vs actual performance
- Regression vs capability distinction -- is_complete_baseline flag separates baseline runs from targeted runs
- Structured rubrics -- every scenario has expected_behavior, failure_modes, scoring_rubric
- Human review as final arbiter -- HTML report with override capability
- Transcript capture -- raw outputs saved, observations mapped to rubric criteria

Gaps worth addressing

1. No pass@k / pass^k (multiple trials per scenario)

The blog emphasizes this heavily. You run each scenario once per eval run. For agents with non-deterministic behavior, a single trial can mislead -- a "pass" might be a lucky run, a "fail" might be an unlucky
one.

Recommendation: Add a --trials N flag to /eval. Run each scenario N times, then report both pass@k (at least one success in k attempts) and pass^k (all succeed). This is especially useful for distinguishing  
 "flaky partial" from "reliably partial."

2. No negative/adversarial scenarios

The blog stresses balanced problem sets -- testing both positive cases (agent should act) and negative cases (agent should NOT act). Your 3 scenarios per agent cover happy path, edge case, and escalation --  
 but none test "the agent should refuse" or "the agent should do nothing."

Recommendation: Add scenario-04 type: negative cases where the correct behavior is to not produce the typical output (e.g., Bird receives a prompt with no domain rules to extract and should say so, not  
 hallucinate rules).

3. No code-based graders

Coach K is purely model-based. The blog recommends deterministic graders first, model-based second. Some of your rubric criteria are objective enough for code-based checking (e.g., "output must contain  
 exactly 5 rules", "must include Given/When/Then format", "JSON must be valid").

Recommendation: Add a graders field to scenario files with simple assertions (regex match, JSON schema validation, keyword presence/absence). Run these before Coach K. Code-based graders are faster, cheaper,
and reproducible -- they catch obvious failures without burning model tokens.

4. Only 3 scenarios per agent (18 total)

The blog recommends 20-50 tasks minimum for meaningful signal. With 3 scenarios per agent, a single flaky result swings pass_rate by 33%.

Recommendation: Grow to at least 8-10 scenarios per agent. Prioritize by converting real failures from team usage into new scenarios (the blog's "user-reported failures" approach).

5. No reference solutions

The blog recommends reference solutions -- a known-good output that proves the task is solvable and validates grader configuration. If Coach K scores a reference solution as "fail", the grader is broken.

Recommendation: Add an optional reference_output field to scenarios. Use it to validate Coach K's grading logic. If Coach K fails a reference solution, flag a grader bug before trusting any other scores.

6. No pairwise comparison between runs

The blog mentions pairwise comparison as a grading method. Your current system compares runs by pass_rate, but doesn't do head-to-head "is run B's output better than run A's for scenario X?"

Recommendation: When testing prompt changes or model upgrades, add a pairwise comparison mode where Coach K judges output A vs output B side-by-side rather than scoring each in isolation.

7. No saturation monitoring

The blog warns about eval saturation -- when pass rates hit 100%, you get no improvement signal. You have 5 agents at 1.0 pass_rate already.

Recommendation: Track saturation explicitly. When an agent hits 100% across N consecutive baseline runs, flag it and prioritize adding harder scenarios for that agent. The current easy wins mask whether  
 agents are actually improving.

8. No production monitoring integration

The blog emphasizes evals are one piece -- production monitoring, user feedback, and A/B testing complete the picture. Your evals are synthetic-only.

Recommendation: Create a lightweight mechanism to convert real /team session outcomes (where an agent underperformed) into new eval scenarios. This closes the loop between production usage and eval coverage.

9. No transcript-level grading beyond output

The blog distinguishes outcome grading (did the right thing happen?) from transcript grading (did the agent take a good path?). You grade final output only. An agent could produce correct output through a  
 terrible process (excessive tool calls, wrong turns, etc.).

Recommendation: For Shaq especially, consider adding transcript-level graders that assess efficiency (tool call count, token usage relative to task complexity).

Priority order

I'd focus on these three first -- they give the most signal improvement per effort:

1. pass@k trials -- eliminates noise from non-determinism
2. More scenarios (20+ total per agent) -- statistical significance
3. Code-based graders for objective criteria -- faster, cheaper, catches grader bugs
