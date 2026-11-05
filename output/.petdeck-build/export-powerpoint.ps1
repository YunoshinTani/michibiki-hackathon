$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$deckPath = Join-Path $taskRoot 'output/presentation/みちねこ_事業提案_初稿.pptx'
$pdfPath = Join-Path $taskRoot 'output/presentation/みちねこ_事業提案_初稿.pdf'
$renderPath = Join-Path $taskRoot '.petdeck-build/powerpoint-render'
New-Item -ItemType Directory -Path $renderPath -Force | Out-Null
$presentationApp = New-Object -ComObject PowerPoint.Application
$initialPresentationCount = $presentationApp.Presentations.Count
$openedDeck = $null
try {
    $openedDeck = $presentationApp.Presentations.Open($deckPath, -1, 0, 0)
    for ($slideIndex = 1; $slideIndex -le $openedDeck.Slides.Count; $slideIndex++) {
        $imagePath = Join-Path $renderPath ('slide-{0:D2}.png' -f $slideIndex)
        $openedDeck.Slides.Item($slideIndex).Export($imagePath, 'PNG', 1280, 720)
    }
    $openedDeck.SaveAs($pdfPath, 32)
    Write-Output ('Exported PDF and {0} slide previews with PowerPoint.' -f $openedDeck.Slides.Count)
} finally {
    if ($null -ne $openedDeck) {
        $openedDeck.Close()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($openedDeck)
    }
    if ($initialPresentationCount -eq 0) {
        $presentationApp.Quit()
    }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentationApp)
}
