using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace VulnerableApp.Api.Migrations;

/// <inheritdoc />
public partial class AddOrders : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // VULN-010: MIG-001 P1 — DROP COLUMN is irreversible without data loss
        // LegacyNotes values are permanently destroyed by this operation.
        // Safe pattern: verify no reads/writes to this column for one full release
        // cycle, then drop in a separate deployment.
        migrationBuilder.DropColumn(
            name: "LegacyNotes",
            table: "Orders");

        migrationBuilder.CreateTable(
            name: "Orders",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                TenantId = table.Column<int>(type: "int", nullable: false),
                Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                Total = table.Column<decimal>(type: "decimal(18,2)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Orders", x => x.Id);
            });
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // MIG-006: Down() does not restore DropColumn — irreversible data loss confirmed
        migrationBuilder.DropTable(name: "Orders");
    }
}
