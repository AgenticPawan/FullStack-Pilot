using Microsoft.AspNetCore.Mvc.Testing;

namespace NetEight.Api.Tests;

public class WeatherTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public WeatherTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetWeatherForecast_ReturnsSuccessStatusCode()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/weatherforecast");
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task GetWeatherForecast_ReturnsFiveItems()
    {
        var client = _factory.CreateClient();
        var json = await client.GetStringAsync("/weatherforecast");
        Assert.NotEmpty(json);
    }
}
