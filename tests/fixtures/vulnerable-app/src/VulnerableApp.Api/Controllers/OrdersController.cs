using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using VulnerableApp.Api.Data;

namespace VulnerableApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// VULN-003: Missing [Authorize] — entire controller is publicly accessible (CWE-862)
public class OrdersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly OrderRepository _repo;

    public OrdersController(AppDbContext db, OrderRepository repo)
    {
        _db = db;
        _repo = repo;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(await _db.Orders.ToListAsync());

    // VULN-004: IDOR — fetches order by ID without verifying the caller owns it (CWE-639)
    // Any authenticated (or in this case unauthenticated) caller can read any order.
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var order = await _db.Orders.FindAsync(id);
        if (order is null) return NotFound();
        // Missing: if (order.UserId != GetCurrentUserId()) return Forbid();
        return Ok(order);
    }
}
