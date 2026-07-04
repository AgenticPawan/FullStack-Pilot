namespace VulnerableApp.Api.Models;

public class Order
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int TenantId { get; set; }
    public string Status { get; set; } = "";
    public decimal Total { get; set; }
}
