FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["src/FullStack.Api/FullStack.Api.csproj", "src/FullStack.Api/"]
COPY ["src/FullStack.Domain/FullStack.Domain.csproj", "src/FullStack.Domain/"]
RUN dotnet restore "src/FullStack.Api/FullStack.Api.csproj"
COPY . .
WORKDIR "/src/src/FullStack.Api"
RUN dotnet build "FullStack.Api.csproj" -c $BUILD_CONFIGURATION -o /app/build

FROM build AS publish
ARG BUILD_CONFIGURATION=Release
RUN dotnet publish "FullStack.Api.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "FullStack.Api.dll"]
