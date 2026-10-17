# Cha Waves: from an editable room to an explainable result

Cha Waves explores a product question: can a browser make simplified propagation models understandable while keeping the inputs, assumptions and computed consequences inspectable?

The implemented result is an editable local workspace for sound and RF experiments, plus a separate acoustic acquisition testbed. It is a software engineering project with preliminary physical experiments. Site prediction accuracy and room mapping remain unvalidated.

![Editable plan and exact point reading](images/workspace.png)

## The interaction

The shortest experiment is closing a door. Its actual opening state changes, the worker computes a new field, and the selected probe reports a new estimate. The loss explanation shows which assembly contributed. A saved baseline supports A/B and difference views with a common scale.

The same metric geometry supports independent sound and RF models. Source and receiver heights affect path length and assembly intersections; display camera changes do not affect numerical inputs.

## Engineering decisions

| Decision | Reason and implemented behavior |
|---|---|
| Pure numerical packages | The same kernels support fields, exact probe readings, automated fixtures and offline analysis without a renderer |
| Cancellable workers | Drag previews coalesce; request identities prevent old results from replacing current inputs |
| Canonical inputs and atomic commands | Geometry, undo/redo, baseline snapshots and validated imports have explicit ownership |
| Common comparison scales | A/B and difference maps preserve units and compatibility |
| Local recovery paths | Worker failure preserves edits and export; failed imports preserve the workspace; project data stays separate from offline app caches |
| Explicit evidence boundaries | Material assumptions, synthetic examples, browser checks and real observations have distinct labels |

The project also includes constrained wall junctions, numeric and keyboard editing, RSSI survey residuals, a bounded placement search and an optional lazy architectural cutaway. [Architecture and current ownership](ARCHITECTURE.md)

## Performance evidence

Historical local measurements include 100 worker updates after 20 warmups on an M4 Pro: **30.4 ms median and 32.2 ms p95** from request posting to accepted Canvas draw for the 2,240-cell acoustic fixture. A separate 20-navigation run measured **108.3 ms median** to the first accepted Canvas draw.

These are build-specific, headless Chromium observations. They exclude physical display presentation and do not establish real-network, phone or full pointer-to-display budgets. [Raw distributions, environment and reproduction](PERFORMANCE_EVIDENCE.md)

## The acoustic investigation

Echo Lab tests a different question: can phone recordings provide identifiable reflection timing before attempting a room fit?

The synthetic example recovers a rectangular fixture from unlabeled first-order arrivals at known positions. The first real spatial recordings did not establish wall identities. A later five-probe batch exercised complete observed input continuity, but retained an unexplained first-probe reference shift. Acquisition telemetry, raw-data preservation and deterministic inspection became prerequisites for further interpretation.

The important decision was to stop short of reporting a plausible rectangle as a measured room. The next gate is repeated identification of one measured wall using a controlled protocol. [Preliminary report](RESEARCH_PREVIEW.md)

## What the work demonstrates

- An interactive numerical product with editable inputs, interpretable outputs and a consistent visual system.
- Browser systems work across workers, versioned persistence, offline assets, recovery and optional phone transport.
- An experimental workflow that retains inconvenient observations and distinguishes software integrity from physical validity.

This case study makes no claim of a novel propagation algorithm, measured educational benefit, calibrated acoustic/RF predictions or successful physical room reconstruction. [Current verification](../reports/PORTFOLIO_VERIFICATION.md) records the checks actually run; [implementation status](IMPLEMENTATION_STATUS.md) retains the broader history and outstanding gates.
