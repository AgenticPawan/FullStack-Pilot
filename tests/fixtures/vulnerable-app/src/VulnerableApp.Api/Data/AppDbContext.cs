using Microsoft.EntityFrameworkCore;
using VulnerableApp.Api.Models;

namespace VulnerableApp.Api.Data;

public class AppDbContext : DbContext
{
    // VULN-002: Hardcoded secret — production password embedded in source code (CWE-798)
    private const string HardcodedConnectionString =
        "Server=prod.database.windows.net;Database=VulnerableDb;User Id=sa;Password=Sup3rS3cr3t123!;";

    public DbSet<User> Users => Set<User>();
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured)
            optionsBuilder.UseSqlServer(HardcodedConnectionString);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // VULN-007: Missing tenant filter — Orders has a TenantId column but no
        // global query filter is applied. Any tenant can read another tenant's orders.
        // Fix: modelBuilder.Entity<Order>().HasQueryFilter(o => o.TenantId == _tenantId);
        modelBuilder.Entity<User>().ToTable("Users");
        modelBuilder.Entity<Order>().ToTable("Orders");
    }
}
