---
name: dotnet-chaos-engineering
description: Reviews whether resilience policies established elsewhere (dotnet-resilience's Polly retry/circuit-breaker, dotnet-outbox-pattern's idempotent consumers, dotnet-connection-pool-tuning's pool sizing) are actually verified under real fault injection, rather than existing only as configuration nobody has tested. Flags no chaos-testing practice at all, chaos experiments run only in a lab environment never resembling production load, no game-day/scheduled chaos exercise cadence, and chaos findings that don't feed back into the runbooks/SLOs they should inform. Outputs findings with pilot-dotnet chaos-engineering standard IDs.
when_to_use: chaos engineering, fault injection, Polly Simmy, Azure Chaos Studio, game day, resilience testing, chaos experiment, failure injection testing
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| CHAOS-001 | P1 | No chaos-testing practice verifies resilience policies actually work |
| CHAOS-002 | P2 | Chaos experiments run only in a lab environment unlike production load |
| CHAOS-003 | P2 | No scheduled game-day/chaos-exercise cadence |
| CHAOS-004 | P2 | Chaos findings don't feed back into runbooks/SLOs |

Every resilience mechanism this marketplace already governs — Polly retries
(`dotnet-resilience`), the outbox pattern (`dotnet-outbox-pattern`), connection-pool
sizing (`dotnet-connection-pool-tuning`), SignalR reconnection (`dotnet-realtime`) — is a
piece of configuration whose *correctness* has usually never been verified against a
real fault. This skill closes that verification gap.

---

## Check A — No chaos-testing practice at all (CHAOS-001)

### Detection

Check whether any tool (Polly's Simmy chaos-injection library for in-process fault
injection, or Azure Chaos Studio for infrastructure-level faults — killing a pod,
injecting network latency, throttling a dependency) is used anywhere to verify the
resilience policies already configured actually behave as expected under a real fault,
versus those policies existing purely as configuration that has never been exercised.

### BAD — retry/circuit-breaker policies configured, never tested against a real fault

```csharp
.AddResilienceHandler("payment-gateway", builder =>
{
    builder.AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2 });
    builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions { /* ... */ });
});
// This configuration has existed for a year. Nobody has ever verified the circuit
// breaker actually trips correctly when the payment gateway is genuinely unavailable.
```

### GOOD — Simmy fault injection verifies the policy in a test

```csharp
var chaosPolicy = ChaosMonkeyGenerator.InjectFault(
    fault: new TimeoutRejectedException("Simulated timeout"),
    injectionRate: 1.0); // 100% fault injection for this test run

[Fact]
public async Task CircuitBreaker_TripsAfterSustainedFailures()
{
    var pipeline = BuildResiliencePipelineWithChaos(chaosPolicy);
    for (int i = 0; i < 5; i++)
        await Assert.ThrowsAsync<TimeoutRejectedException>(() => pipeline.ExecuteAsync(CallPaymentGateway));

    // Verify the circuit is now open and subsequent calls fail fast without even attempting the call
    var stopwatch = Stopwatch.StartNew();
    await Assert.ThrowsAsync<BrokenCircuitException>(() => pipeline.ExecuteAsync(CallPaymentGateway));
    Assert.True(stopwatch.ElapsedMilliseconds < 50); // fails fast, doesn't wait for a real timeout
}
```

---

## Check B — Chaos experiments only in a lab environment (CHAOS-002)

### Detection

Check whether chaos experiments run against a realistic staging/production-like
environment under realistic load, versus only in an isolated local test with no
concurrent traffic — a circuit breaker's behavior under one sequential test call is not
the same as its behavior under real concurrent load where multiple requests race to trip
or reset the breaker simultaneously.

### BAD — chaos testing only ever run as a unit test with no concurrent load

```csharp
[Fact]
public async Task SingleSequentialFaultTest() { /* one call at a time, no concurrency */ }
// Never validated under anything resembling the concurrent request volume production sees.
```

### GOOD — chaos experiment run against staging under simulated load

```yaml
# Azure Chaos Studio experiment definition
steps:
  - name: InjectLatency
    branches:
      - actions:
          - selectorId: paymentGatewaySelector
            type: continuous
            parameters:
              - key: latencyInMilliseconds
                value: '5000'
duration: PT10M
# Run concurrently with a load test (k6/JMeter) hitting staging at realistic RPS,
# verifying the resilience pipeline behaves correctly under real concurrent pressure.
```

---

## Check C — No scheduled game-day/chaos-exercise cadence (CHAOS-003)

### Detection

Check for a documented, recurring cadence (quarterly game day, monthly chaos exercise)
versus chaos testing being a one-off exercise run once and never repeated. Resilience
configuration drifts over time (a Polly policy tweaked, a dependency's behavior changing)
— a chaos exercise validates the system *as it exists today*, and stops being valid the
moment something changes unless it's repeated.

### BAD — chaos testing was done once, a year ago, during initial rollout

```
<!-- The last chaos game day was 14 months ago. Three major resilience-policy changes
     have shipped since then, none of them re-validated under fault injection. -->
```

### GOOD — a recurring, scheduled cadence

```markdown
<!-- docs/CHAOS-SCHEDULE.md -->
Quarterly game day: inject a payment-gateway outage, a database failover, and a
SignalR backplane disconnection against staging under simulated peak load. Findings
feed into Check D. Next scheduled: 2026-10-01.
```

---

## Check D — Chaos findings don't feed back into runbooks/SLOs (CHAOS-004)

### Detection

Check whether a chaos exercise's findings actually update `incident-response-runbook`'s
runbooks (a discovered gap — "the circuit breaker didn't trip as expected" — becomes a
documented known issue and a fix) and `azure-slo-error-budget`'s SLO assumptions (if
chaos testing reveals the service can't actually meet its stated SLO under a plausible
fault, the SLO itself may need revisiting) — a chaos exercise whose findings live only in
a slide deck from the game day accomplishes nothing lasting.

### BAD — game day findings documented once, never actioned

```markdown
<!-- game-day-2026-Q3-notes.md, never referenced again:
     "Found: payment gateway circuit breaker took 3x longer to trip than expected." -->
```

### GOOD — findings become tracked action items feeding the existing runbook/SLO processes

```markdown
<!-- Action item tracked the same way incident-response-runbook IR-004 tracks postmortem
     action items: -->
- [ ] Tune payment-gateway circuit-breaker `SamplingDuration` (found during 2026-Q3 game
  day to trip 3x slower than the SLO error budget assumes) — #1502, @owner, due 2026-08-01
```
