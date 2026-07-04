-- Seed data for local development
INSERT INTO Customers (Name, Email, CreatedAt)
VALUES
    ('Acme Corp',    'billing@acme.example',   GETUTCDATE()),
    ('Contoso Ltd',  'admin@contoso.example',  GETUTCDATE()),
    ('Fabrikam Inc', 'ops@fabrikam.example',   GETUTCDATE());
