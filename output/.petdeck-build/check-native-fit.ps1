$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$deckPath = Join-Path $taskRoot 'output/presentation/みちねこ_事業提案_初稿.pptx'
$presentationApp = New-Object -ComObject PowerPoint.Application
$initialPresentationCount = $presentationApp.Presentations.Count
$openedDeck = $null
$issues = @()
try {
    $openedDeck = $presentationApp.Presentations.Open($deckPath, -1, 0, 0)
    for ($slideIndex = 1; $slideIndex -le $openedDeck.Slides.Count; $slideIndex++) {
        $oneSlide = $openedDeck.Slides.Item($slideIndex)
        foreach ($oneShape in $oneSlide.Shapes) {
            if ($oneShape.HasTextFrame -eq -1 -and $oneShape.TextFrame2.HasText -eq -1) {
                $rangeBounds = $oneShape.TextFrame2.TextRange
                $rightExcess = ($rangeBounds.BoundLeft + $rangeBounds.BoundWidth) - ($oneShape.Left + $oneShape.Width)
                $bottomExcess = ($rangeBounds.BoundTop + $rangeBounds.BoundHeight) - ($oneShape.Top + $oneShape.Height)
                if ($rightExcess -gt 5 -or $bottomExcess -gt 5) {
                    $issues += [pscustomobject]@{Slide=$slideIndex;Name=$oneShape.Name;RightExcess=[math]::Round($rightExcess,1);BottomExcess=[math]::Round($bottomExcess,1);Text=$oneShape.TextFrame.TextRange.Text}
                }
            }
        }
    }
    $issues | ConvertTo-Json -Depth 3
    Write-Output ('Text overflow candidates: {0}' -f $issues.Count)
} finally {
    if ($null -ne $openedDeck) {
        $openedDeck.Close()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($openedDeck)
    }
    if ($initialPresentationCount -eq 0) {$presentationApp.Quit()}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentationApp)
}
