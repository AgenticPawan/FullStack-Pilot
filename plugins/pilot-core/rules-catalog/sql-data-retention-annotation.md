---
id: sql-data-retention-annotation
title: SQL — Tables with PII or Audit Data Must Declare a Retention Policy
appliesTo: sql
severity: warn
standard: GDPR-Art17
---

Any table that stores personally identifiable information (PII) or user-generated content
MUST declare a retention policy via one of the approved patterns. An undeclared retention
table can neither be purged systematically nor audited for GDPR compliance.

**Approved patterns**

1. **Soft-delete with RetainUntil** — add a `RetainUntil DATE NOT NULL` column with a
   default retention period; a scheduled job hard-deletes rows past their date.

2. **Temporal table** — enable `SYSTEM_VERSIONING = ON` with an explicit
   `HISTORY_RETENTION_PERIOD` (e.g. 7 YEARS). Do NOT leave the default unbounded.

**BAD**
```sql
CREATE TABLE dbo.CustomerMessages (
    Id        UNIQUEIDENTIFIER NOT NULL,
    TenantId  UNIQUEIDENTIFIER NOT NULL,
    Body      NVARCHAR(MAX)    NOT NULL  -- PII, no retention declared
);
```

**GOOD — option A (soft-delete)**
```sql
ALTER TABLE dbo.CustomerMessages
    ADD RetainUntil DATE NOT NULL
        CONSTRAINT DF_CustomerMessages_RetainUntil
        DEFAULT DATEADD(YEAR, 7, GETUTCDATE());
```

**GOOD — option B (temporal)**
```sql
ALTER TABLE dbo.CustomerMessages
    SET (SYSTEM_VERSIONING = ON (
        HISTORY_TABLE = dbo.CustomerMessagesHistory,
        HISTORY_RETENTION_PERIOD = 7 YEARS
    ));
```
