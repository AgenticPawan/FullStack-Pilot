---
id: always-structured-logging
title: Structured Logging — No String Interpolation, PII Redacted
appliesTo: always
severity: warn
standard: OWASP-A09
---
Use structured logging with named placeholders. Never interpolate variables directly into message strings. Mask or omit PII fields (email, phone, SSN, card number) per the project redaction list.

**BAD**
```csharp
_logger.LogInformation($"User {user.Email} logged in from {ip}");
_logger.LogError($"Payment failed for card {card.Number}");
```

**GOOD**
```csharp
_logger.LogInformation("User {UserId} logged in from {IpHash}", user.Id, HashIp(ip));
_logger.LogError("Payment failed for CardLastFour {LastFour}", card.LastFour);
```
