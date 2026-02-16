### Integrate CalibrationEngine into Scheduler for Adaptive Estimates
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** CalibrationEngine in src/analytics/calibration-engine.ts maintains per-project, per-model calibration factors in tc_calibration_factors. It learns from historical estimate-vs-actual data to produce multipliers that improve session estimates over time. Currently the Scheduler uses static estimated_sessions_opus/sonnet values from tc_tasks without adjustment. Integrating CalibrationEngine means the Scheduler's capacity calculations reflect real-world performance, leading to better scheduling decisions and more accurate cost estimates.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Scheduler receives CalibrationEngine instance via its config/constructor
- [ ] When evaluating task capacity requirements, Scheduler applies calibration factor to raw estimates (e.g., if calibration factor is 1.3x for opus, a 2-session estimate becomes 2.6 rounded to 3)
- [ ] Calibration factors are fetched per-project and per-model from tc_calibration_factors
- [ ] If no calibration data exists for a project/model pair, raw estimates are used unchanged (graceful fallback)
- [ ] After task completion, CalibrationEngine.recordActual() is called with actual session count to update factors
- [ ] Unit tests cover: calibration applied correctly, fallback when no factors exist, factor update on completion

#### Next steps
1. Read src/analytics/calibration-engine.ts to understand the getCalibrationFactor and recordActual interfaces
2. Read src/scheduler/ files to understand where capacity estimates are consumed
3. Add CalibrationEngine to Scheduler config and inject at construction
4. Apply calibration factor in TaskQueue.getNextTask() or wherever capacity is checked
5. Add recordActual call in MainLoop's task completion handler
6. Add unit tests for calibrated vs uncalibrated scheduling decisions
