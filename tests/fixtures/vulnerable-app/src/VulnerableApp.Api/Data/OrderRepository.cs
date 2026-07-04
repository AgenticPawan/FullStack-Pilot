using Microsoft.EntityFrameworkCore;
using VulnerableApp.Api.Models;

namespace VulnerableApp.Api.Data;

public class OrderRepository
{
    private readonly AppDbContext _db;

    public OrderRepository(AppDbContext db) => _db = db;

    // VULN-008: Unparameterized raw EF SQL — string concatenation into FromSqlRaw (CWE-89)
    // `status` flows from caller input directly into the SQL string.
    public async Task<List<Order>> GetByStatusAsync(string status)
    {
        var sql = "SELECT * FROM Orders WHERE Status = '" + status + "'";
        return await _db.Orders.FromSqlRaw(sql).ToListAsync();
    }
}
