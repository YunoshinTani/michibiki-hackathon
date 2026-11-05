$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$manifestPath = Join-Path $taskRoot '.petdeck-build/submission/manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$renderPath = Join-Path $taskRoot '.petdeck-build/submission/final-render'
New-Item -ItemType Directory -Path $renderPath -Force | Out-Null
$presentationApp = New-Object -ComObject PowerPoint.Application
$initialPresentationCount = $presentationApp.Presentations.Count
$openedDeck = $null
$fitIssues = @()
try {
    $openedDeck = $presentationApp.Presentations.Open($manifest.pptx, -1, 0, 0)
    for ($slideIndex = 1; $slideIndex -le $openedDeck.Slides.Count; $slideIndex++) {
        $slide = $openedDeck.Slides.Item($slideIndex)
        $imagePath = Join-Path $renderPath ('slide-{0:D2}.png' -f $slideIndex)
        $slide.Export($imagePath, 'PNG', 1280, 720)
        foreach ($shape in $slide.Shapes) {
            if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame2.HasText -eq -1) {
                $range = $shape.TextFrame2.TextRange
                $rightExcess = $range.BoundLeft + $range.BoundWidth - $shape.Left - $shape.Width
                $bottomExcess = $range.BoundTop + $range.BoundHeight - $shape.Top - $shape.Height
                if ($rightExcess -gt 5 -or $bottomExcess -gt 5) {
                    $fitIssues += [pscustomobject]@{Slide=$slideIndex;Name=$shape.Name;RightExcess=[math]::Round($rightExcess,1);BottomExcess=[math]::Round($bottomExcess,1)}
                }
            }
            if ($shape.HasTable -eq -1) {
                for ($rowIndex = 1; $rowIndex -le $shape.Table.Rows.Count; $rowIndex++) {
                    for ($columnIndex = 1; $columnIndex -le $shape.Table.Columns.Count; $columnIndex++) {
                        $cellShape = $shape.Table.Cell($rowIndex, $columnIndex).Shape
                        $range = $cellShape.TextFrame2.TextRange
                        $rightExcess = $range.BoundLeft + $range.BoundWidth - $cellShape.Left - $cellShape.Width
                        $bottomExcess = $range.BoundTop + $range.BoundHeight - $cellShape.Top - $cellShape.Height
                        if ($rightExcess -gt 5 -or $bottomExcess -gt 5) {
                            $fitIssues += [pscustomobject]@{Slide=$slideIndex;Name=('Table cell {0},{1}' -f $rowIndex,$columnIndex);RightExcess=[math]::Round($rightExcess,1);BottomExcess=[math]::Round($bottomExcess,1)}
                        }
                    }
                }
            }
        }
    }
    $openedDeck.SaveAs($manifest.pdf, 32)
    $fitIssues | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskRoot '.petdeck-build/submission/native-fit.json') -Encoding utf8
    Write-Output ('Exported submission PDF and {0} native slide previews. Overflow candidates: {1}' -f $openedDeck.Slides.Count,$fitIssues.Count)
    $fitIssues | ConvertTo-Json -Depth 4
} finally {
    if ($null -ne $openedDeck) {
        $openedDeck.Close()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($openedDeck)
    }
    if ($initialPresentationCount -eq 0) {$presentationApp.Quit()}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentationApp)
}
