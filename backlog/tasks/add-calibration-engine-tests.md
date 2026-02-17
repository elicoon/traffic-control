### Add Unit Tests for CalibrationEngine to Reach 80%+ Coverage
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** CalibrationEngine (src/analytics/calibration-engine.ts) improves estimation accuracy by learning from actual vs. estimated session usage. It has 72.3% statement coverage with lines 234-277 completely uncovered. These uncovered lines likely contain calibration factor calculation logic, per-project accuracy tracking, and estimation adjustment algorithms - core functionality that should be tested to prevent estimation drift or incorrect budget predictions.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test file exists at `src/analytics/calibration-engine.test.ts`
- [ ] Tests cover calibration factor calculation from actual vs estimated sessions
- [ ] Tests verify per-project calibration tracking (separate factors per project)
- [ ] Tests verify estimation adjustments based on calibration factors
- [ ] Tests cover edge cases (zero estimates, zero actuals, first-time projects)
- [ ] Tests verify database persistence of calibration factors via CalibrationRepository
- [ ] Coverage for calibration-engine.ts reaches ≥80% statements
- [ ] All existing tests still pass (`npm run test`)

#### Next steps
1. Read `src/analytics/calibration-engine.ts` focusing on lines 234-277 (uncovered)
2. Review `src/db/repositories/calibration-factors.ts` to understand persistence interface
3. Create test file with vitest, mock CalibrationRepository
4. Write test suite for updateCalibration method (actual vs estimated logic)
5. Write test suite for getAdjustedEstimate method (factor application)
6. Write tests for edge cases (division by zero, negative values, missing factors)
7. Run `npm run test:coverage` to verify 80%+ coverage target met
