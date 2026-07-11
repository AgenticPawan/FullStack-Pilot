---
name: dotnet-document-io
description: Reviews Excel/PDF import-export in ASP.NET Core. Flags commercial-license libraries (EPPlus v5+, QuestPDF) with no licensing note, full-file in-memory loads that should stream, imports aborting on the first bad row instead of collecting per-row errors, uploads trusted by extension instead of magic bytes, no antivirus scan before durable storage, and duplicated PDF layout logic. Outputs pilot-dotnet document-io standard IDs.
when_to_use: Excel import, Excel export, PDF generation, EPPlus, ClosedXML, OpenXML, QuestPDF, PdfSharp, IronPDF, file upload validation, streaming export, large file export, row validation, bulk import, document generation, report export, commercial license, antivirus scan upload, magic byte file signature, content sniffing, malware scan, file upload security
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|----------------|
| DOC-001 | P1 | EPPlus or QuestPDF referenced without a licensing note or `ExcelPackage.LicenseContext`/`Settings.License` acknowledgment |
| DOC-002 | P1 | Entire workbook loaded into memory instead of streamed for large exports |
| DOC-003 | P2 | Import endpoint aborts on first invalid row instead of returning a structured per-row error report |
| DOC-004 | P1 | Export builds full file `byte[]` in memory instead of streaming the HTTP response |
| DOC-005 | P0 | Uploaded import file has no content-type/extension validation before parsing |
| DOC-006 | P2 | PDF layout/branding logic duplicated inline per endpoint instead of a shared document component |
| DOC-007 | P0 | Upload trusted by declared content-type/extension alone instead of magic-byte file-signature sniffing |
| DOC-008 | P0 | No antivirus/malware scan before a user upload reaches durable storage |

---

## Check A — Commercial-license-triggering libraries

### Detection

1. Grep `*.csproj` for `PackageReference` entries: `EPPlus` (v5+), `QuestPDF`.
2. For `EPPlus`, check that `ExcelPackage.LicenseContext` is set AND a comment or config
   entry nearby documents that a commercial license was purchased, or that usage is
   noncommercial/internal (Polyform Noncommercial permits certain internal use — but this
   must be a documented decision, not silence).
3. For `QuestPDF`, check that `QuestPDF.Settings.License` is explicitly set to
   `LicenseType.Community` (with a revenue-threshold note) or `LicenseType.Professional`/`Enterprise`.
4. If the package is referenced but no license acknowledgment exists anywhere in the
   codebase → DOC-001. Recommend MIT alternatives: `ClosedXML` or `OpenXML SDK` for Excel;
   `PdfSharp`/`MigraDoc` for PDF if a fully free stack is required.

### BAD — EPPlus used with no license note

```csharp
using OfficeOpenXml;

public class ReportExporter
{
    public byte[] BuildReport(IEnumerable<OrderRow> rows)
    {
        using var package = new ExcelPackage();
        var sheet = package.Workbook.Worksheets.Add("Orders");
        // ... fills sheet ...
        return package.GetAsByteArray();
        // No ExcelPackage.LicenseContext set anywhere, no note that a
        // commercial license was purchased or that usage qualifies as noncommercial.
    }
}
```

### GOOD — license context set and documented, or free alternative used

```csharp
// Program.cs — documented decision: commercial license purchased 2025-11-01,
// invoice #4471, covers this application's production use.
OfficeOpenXml.ExcelPackage.LicenseContext = OfficeOpenXml.LicenseContext.Commercial;
```

```csharp
// Alternative: ClosedXML (MIT) — no license threshold to track.
using ClosedXML.Excel;

public class ReportExporter
{
    public byte[] BuildReport(IEnumerable<OrderRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Orders");
        var row = 1;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.OrderId;
            sheet.Cell(row, 2).Value = r.Total;
            row++;
        }
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
```

---

## Check B — Streaming large Excel files instead of full in-memory load

### Detection

1. Look for `Load()`/`LoadFromStream()` or `new ExcelPackage(stream)` followed by
   iterating `Worksheet.Cells` over an entire large range, or `XLWorkbook.OpenFromTemplate`
   used for exports expected to exceed ~50k rows.
2. If the dataset size is unbounded (e.g., sourced from a paged DB query without a limit)
   and the code materializes the whole workbook in memory before writing → DOC-002.
3. Recommend `OpenXmlWriter` (OpenXML SDK) or ClosedXML's row-by-row `IXLWorksheet` writes
   combined with `SaveAs(stream)` against a `FileStream`, avoiding a full `XLWorkbook`
   object graph held in memory for very large exports.

### BAD — full workbook materialized for a large export

```csharp
[HttpGet("orders/export")]
public async Task<IActionResult> ExportOrders()
{
    var allOrders = await _db.Orders.AsNoTracking().ToListAsync(); // could be millions of rows
    using var workbook = new XLWorkbook();
    var sheet = workbook.Worksheets.Add("Orders");
    for (int i = 0; i < allOrders.Count; i++)
    {
        sheet.Cell(i + 1, 1).Value = allOrders[i].OrderId;
        sheet.Cell(i + 1, 2).Value = allOrders[i].Total;
    }
    using var ms = new MemoryStream();
    workbook.SaveAs(ms);
    return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "orders.xlsx");
}
```

### GOOD — streaming write with OpenXML `OpenXmlWriter`

```csharp
[HttpGet("orders/export")]
public async Task ExportOrders()
{
    Response.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    Response.Headers.Append("Content-Disposition", "attachment; filename=orders.xlsx");

    using var document = SpreadsheetDocument.Create(Response.Body, SpreadsheetDocumentType.Workbook);
    var workbookPart = document.AddWorkbookPart();
    workbookPart.Workbook = new Workbook();
    var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();

    using var writer = OpenXmlWriter.Create(worksheetPart);
    writer.WriteStartElement(new Worksheet());
    writer.WriteStartElement(new SheetData());

    await foreach (var order in _db.Orders.AsNoTracking().AsAsyncEnumerable())
    {
        writer.WriteStartElement(new Row());
        writer.WriteElement(new Cell { CellValue = new CellValue(order.OrderId.ToString()), DataType = CellValues.Number });
        writer.WriteElement(new Cell { CellValue = new CellValue(order.Total.ToString()), DataType = CellValues.Number });
        writer.WriteEndElement(); // Row
    }

    writer.WriteEndElement(); // SheetData
    writer.WriteEndElement(); // Worksheet
    writer.Close();

    workbookPart.Workbook.Append(new Sheets(new Sheet
    {
        Id = workbookPart.GetIdOfPart(worksheetPart),
        SheetId = 1,
        Name = "Orders"
    }));
    workbookPart.Workbook.Save();
}
```

---

## Check C — Per-row import validation instead of abort-on-first-error

### Detection

1. Find import endpoints that call `throw`/`return BadRequest` on the first parse or
   validation failure inside a row loop, discarding progress on subsequent rows.
2. Flag DOC-003 when there is no accumulating error list keyed by row number returned
   to the caller.

### BAD — aborts entirely on first bad row

```csharp
[HttpPost("orders/import")]
public async Task<IActionResult> ImportOrders(IFormFile file)
{
    using var stream = file.OpenReadStream();
    using var workbook = new XLWorkbook(stream);
    var sheet = workbook.Worksheet(1);

    foreach (var row in sheet.RowsUsed().Skip(1))
    {
        var qtyCell = row.Cell(3);
        if (!int.TryParse(qtyCell.GetString(), out var qty))
        {
            return BadRequest($"Invalid quantity on row {row.RowNumber()}");
            // Every valid row before/after this one is silently dropped.
        }
        await _db.Orders.AddAsync(new Order { Quantity = qty });
    }
    await _db.SaveChangesAsync();
    return Ok();
}
```

### GOOD — collects per-row errors, imports valid rows

```csharp
public record ImportRowError(int RowNumber, string Message);
public record ImportResult(int Imported, int Skipped, IReadOnlyList<ImportRowError> Errors);

[HttpPost("orders/import")]
public async Task<ActionResult<ImportResult>> ImportOrders(IFormFile file)
{
    using var stream = file.OpenReadStream();
    using var workbook = new XLWorkbook(stream);
    var sheet = workbook.Worksheet(1);

    var errors = new List<ImportRowError>();
    var toInsert = new List<Order>();

    foreach (var row in sheet.RowsUsed().Skip(1))
    {
        var qtyCell = row.Cell(3);
        if (!int.TryParse(qtyCell.GetString(), out var qty))
        {
            errors.Add(new ImportRowError(row.RowNumber(), $"Invalid quantity '{qtyCell.GetString()}'"));
            continue;
        }
        toInsert.Add(new Order { Quantity = qty });
    }

    await _db.Orders.AddRangeAsync(toInsert);
    await _db.SaveChangesAsync();

    return Ok(new ImportResult(toInsert.Count, errors.Count, errors));
}
```

---

## Check D — Streaming export responses instead of full in-memory `File(byte[], ...)`

### Detection

1. Look for `return File(byte[] fileContents, ...)` where `fileContents` was built by
   fully materializing a large document in memory beforehand.
2. Flag DOC-004 when the source dataset is large/unbounded and no `FileStreamResult` or
   direct `Response.Body` write path is used, causing high memory pressure and delaying
   time-to-first-byte until the whole file is ready.

### BAD — whole PDF built in memory, then returned as a byte array

```csharp
[HttpGet("invoices/{id}/pdf")]
public async Task<IActionResult> GetInvoicePdf(int id)
{
    var invoice = await _db.Invoices.FindAsync(id);
    byte[] pdfBytes = _invoiceDocument.GeneratePdf(invoice); // fully buffered
    return File(pdfBytes, "application/pdf", $"invoice-{id}.pdf");
}
```

### GOOD — streamed directly to the response

```csharp
[HttpGet("invoices/{id}/pdf")]
public async Task GetInvoicePdf(int id)
{
    var invoice = await _db.Invoices.FindAsync(id);
    Response.ContentType = "application/pdf";
    Response.Headers.Append("Content-Disposition", $"attachment; filename=invoice-{id}.pdf");

    var document = new InvoiceDocument(invoice);
    document.GeneratePdf(Response.Body); // QuestPDF writes directly to the stream
    await Response.Body.FlushAsync();
}
```

---

## Check E — Missing content-type/extension validation on uploaded import files

### Detection

1. Find `IFormFile` upload handlers passed directly to `new ExcelPackage(stream)` /
   `new XLWorkbook(stream)` without checking `file.ContentType` and file extension first.
2. Flag DOC-005 — unvalidated uploads risk unhandled parser exceptions on malformed input
   and resource-exhaustion ("zip bomb"-style) attacks since `.xlsx` is a zip container.

### BAD — any uploaded file is parsed as Excel

```csharp
[HttpPost("orders/import")]
public async Task<IActionResult> ImportOrders(IFormFile file)
{
    using var stream = file.OpenReadStream();
    using var workbook = new XLWorkbook(stream); // parses whatever was uploaded, no checks
    ...
}
```

### GOOD — extension, content-type, and size validated before parsing

```csharp
private static readonly string[] AllowedExtensions = [".xlsx"];
private static readonly string[] AllowedContentTypes =
[
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];
private const long MaxUploadBytes = 10 * 1024 * 1024; // 10 MB

[HttpPost("orders/import")]
public async Task<IActionResult> ImportOrders(IFormFile file)
{
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!AllowedExtensions.Contains(ext) || !AllowedContentTypes.Contains(file.ContentType))
    {
        return BadRequest("Only .xlsx files are accepted.");
    }
    if (file.Length == 0 || file.Length > MaxUploadBytes)
    {
        return BadRequest("File is empty or exceeds the 10 MB upload limit.");
    }

    using var stream = file.OpenReadStream();
    using var workbook = new XLWorkbook(stream);
    // ... proceed with per-row validation (see Check C) ...
    return Ok();
}
```

---

## Check F — Reusable PDF document components instead of duplicated inline layout

### Detection

1. Grep for multiple endpoints/handlers each constructing PDF layout (headers, logos,
   fonts, margins) inline rather than composing a shared `IDocument`/component.
2. Flag DOC-006 when branding elements (logo, colors, footer text) are copy-pasted across
   two or more document classes instead of centralized in a shared layout component.

### BAD — branding and layout duplicated per document

```csharp
public class InvoiceDocument : IDocument
{
    public void Compose(IDocumentContainer container)
    {
        container.Page(page =>
        {
            page.Header().Text("Acme Corp").FontSize(20).Bold();
            page.Content().Text("Invoice details...");
            page.Footer().Text("Acme Corp — Confidential").FontSize(8);
        });
    }
    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}

public class ReceiptDocument : IDocument
{
    public void Compose(IDocumentContainer container)
    {
        container.Page(page =>
        {
            page.Header().Text("Acme Corp").FontSize(20).Bold(); // duplicated
            page.Content().Text("Receipt details...");
            page.Footer().Text("Acme Corp — Confidential").FontSize(8); // duplicated
        });
    }
    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}
```

### GOOD — shared branded layout component composed by each document

```csharp
public static class BrandedLayout
{
    public static void Compose(PageDescriptor page, string bodyTitle, Action<IContainer> content)
    {
        page.Header().Text("Acme Corp").FontSize(20).Bold();
        page.Content().Column(col =>
        {
            col.Item().Text(bodyTitle).FontSize(14);
            col.Item().Element(content);
        });
        page.Footer().Text("Acme Corp — Confidential").FontSize(8);
    }
}

public class InvoiceDocument(Invoice invoice) : IDocument
{
    public void Compose(IDocumentContainer container) =>
        container.Page(page => BrandedLayout.Compose(page, "Invoice", c => c.Text($"Total: {invoice.Total:C}")));

    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}

public class ReceiptDocument(Receipt receipt) : IDocument
{
    public void Compose(IDocumentContainer container) =>
        container.Page(page => BrandedLayout.Compose(page, "Receipt", c => c.Text($"Paid: {receipt.AmountPaid:C}")));

    public DocumentMetadata GetMetadata() => DocumentMetadata.Default;
}
```

---

## Check G — Uploads trusted by declared content-type/extension alone (DOC-007)

### Detection

1. Confirm DOC-005's extension/content-type check is not the *only* validation — both
   `file.ContentType` and the file name extension are client-supplied and trivially
   spoofed (a caller can rename a malicious executable to `report.xlsx` and set the
   content-type header to match).
2. Flag uploads parsed straight after the DOC-005 checks with no verification of the
   file's actual binary signature ("magic bytes") matching the claimed format.

### BAD — only the spoofable content-type/extension are checked

```csharp
var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
if (ext != ".xlsx" || file.ContentType != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return BadRequest();
// Both values come from the client and can be set to anything regardless of the actual file bytes.
using var workbook = new XLWorkbook(file.OpenReadStream());
```

### GOOD — magic-byte signature verified against the claimed format

```csharp
private static bool IsValidXlsxSignature(Stream stream)
{
    Span<byte> header = stackalloc byte[4];
    stream.ReadExactly(header);
    stream.Position = 0;
    // .xlsx files are zip containers — magic bytes 50 4B 03 04 ("PK\x03\x04")
    return header[0] == 0x50 && header[1] == 0x4B && header[2] == 0x03 && header[3] == 0x04;
}

[HttpPost("orders/import")]
public async Task<IActionResult> ImportOrders(IFormFile file)
{
    using var stream = file.OpenReadStream();
    if (!IsValidXlsxSignature(stream))
        return BadRequest("File content does not match a valid .xlsx signature.");

    using var workbook = new XLWorkbook(stream);
    // ... proceed with per-row validation (Check C) ...
}
```

---

## Check H — No antivirus scan before durable storage (DOC-008)

### Detection

For uploads that get written to durable storage (Blob Storage, a file share) rather than
parsed and discarded immediately, check whether the upload path invokes a malware-scanning
step (Microsoft Defender for Storage's built-in malware scanning, or an explicit AV scan
service) before the file becomes downloadable by other users. An unscanned upload that
other users can later retrieve turns the application into a malware distribution vector.

### BAD — upload written straight to Blob Storage, no scan

```csharp
[HttpPost("attachments")]
public async Task<IActionResult> UploadAttachment(IFormFile file)
{
    var blobClient = _containerClient.GetBlobClient(file.FileName);
    await blobClient.UploadAsync(file.OpenReadStream()); // immediately downloadable by other users, unscanned
    return Ok();
}
```

### GOOD — quarantine container scanned before promotion to the public-facing container

```csharp
[HttpPost("attachments")]
public async Task<IActionResult> UploadAttachment(IFormFile file)
{
    var quarantineBlob = _quarantineContainerClient.GetBlobClient(file.FileName);
    await quarantineBlob.UploadAsync(file.OpenReadStream());
    // Microsoft Defender for Storage malware scanning fires on blob upload; an Event Grid
    // subscription (dotnet-outbox-pattern) moves the blob to the public container only
    // after a clean scan result, and deletes/quarantines it on a malware verdict.
    return Accepted();
}
```
