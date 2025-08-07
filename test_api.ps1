# PowerShell script to test the API without Python dependencies
# Run this with: powershell -ExecutionPolicy Bypass -File test_api.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "LPC Character Generator API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$apiUrl = "http://localhost:8000"

# Test if API is running
Write-Host "Testing API connection..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$apiUrl/health" -Method Get -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ API is healthy" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ API is not responding. Make sure Docker containers are running." -ForegroundColor Red
    Write-Host "  Run: BuildScript_v2.bat" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "1. Generating Basic Male Character" -ForegroundColor Cyan
Write-Host "----------------------------------------"

# Create request body for basic male character
$body = @{
    body_type = "male"
    selections = @(
        @{type = "body"; item = "body"; variant = "light"},
        @{type = "heads"; item = "heads_human_male"},
        @{type = "hair"; item = "hair_plain"; variant = "blonde"}
    )
} | ConvertTo-Json -Depth 3

Write-Host "Request body:"
Write-Host $body

try {
    # Make the API request
    $response = Invoke-WebRequest -Uri "$apiUrl/generate-sprite" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -OutFile "character_male_basic.png" `
        -ErrorAction Stop
    
    Write-Host "✓ Generated: character_male_basic.png" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to generate character: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Generating Female Warrior Character" -ForegroundColor Cyan
Write-Host "----------------------------------------"

$body2 = @{
    body_type = "female"
    selections = @(
        @{type = "body"; item = "body"; variant = "amber"},
        @{type = "heads"; item = "heads_human_female"},
        @{type = "hair"; item = "hair_ponytail"; variant = "brown"}
    )
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-WebRequest -Uri "$apiUrl/generate-sprite" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body2 `
        -OutFile "character_female_warrior.png" `
        -ErrorAction Stop
    
    Write-Host "✓ Generated: character_female_warrior.png" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to generate character: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "3. Testing Available Options Endpoint" -ForegroundColor Cyan
Write-Host "----------------------------------------"

$optionsBody = @{
    body_type = "male"
    current_selections = @()
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-RestMethod -Uri "$apiUrl/available-options" `
        -Method Post `
        -ContentType "application/json" `
        -Body $optionsBody `
        -ErrorAction Stop
    
    Write-Host "✓ Found $($response.total_categories) categories" -ForegroundColor Green
    
    # Show first few categories
    $count = 0
    foreach ($category in $response.available_options.PSObject.Properties) {
        if ($count -ge 5) { break }
        $itemCount = @($category.Value).Count
        Write-Host "  - $($category.Name): $itemCount items"
        $count++
    }
} catch {
    Write-Host "✗ Failed to get options: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# List generated files
$pngFiles = Get-ChildItem -Path . -Filter "character_*.png" 2>$null
if ($pngFiles) {
    Write-Host ""
    Write-Host "Generated images:" -ForegroundColor Yellow
    foreach ($file in $pngFiles) {
        Write-Host "  - $($file.Name)" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "Sample curl command for manual testing:" -ForegroundColor Yellow
Write-Host @'
curl -X POST http://localhost:8000/generate-sprite \
  -H "Content-Type: application/json" \
  -d "{\"body_type\":\"male\",\"selections\":[{\"type\":\"body\",\"item\":\"body\",\"variant\":\"light\"},{\"type\":\"heads\",\"item\":\"heads_human_male\"},{\"type\":\"hair\",\"item\":\"hair_plain\",\"variant\":\"blonde\"}]}" \
  --output character.png
'@ -ForegroundColor Gray