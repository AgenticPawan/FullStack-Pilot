using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using VulnerableApp.Api.Data;

namespace VulnerableApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;

    public UsersController(AppDbContext db) => _db = db;

    // VULN-001: SQL injection via string concatenation (CWE-89)
    // User-supplied `name` is concatenated directly into a raw SQL string.
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string name)
    {
        var sql = $"SELECT * FROM Users WHERE Name = '{name}'";
        var users = await _db.Users.FromSqlRaw(sql).ToListAsync();
        return Ok(users);
    }
}
