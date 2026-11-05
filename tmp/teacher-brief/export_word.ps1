param(
    [Parameter(Mandatory=$true)][string]$InputDocx,
    [Parameter(Mandatory=$true)][string]$OutputPdf
)
$ErrorActionPreference = 'Stop'
$taskWord = $null
$taskDoc = $null
$taskSaveOption = 0
try {
    $taskWord = New-Object -ComObject Word.Application
    $taskWord.Visible = $false
    $taskWord.DisplayAlerts = 0
    $taskWord.AutomationSecurity = 3
    $taskDoc = $taskWord.Documents.Open($InputDocx, $false, $true, $false)
    $taskDoc.Repaginate()
    $taskDoc.ExportAsFixedFormat($OutputPdf, 17)
    Write-Output ('Pages: ' + $taskDoc.ComputeStatistics(2))
} finally {
    if ($null -ne $taskDoc) {
        $taskDoc.Close([ref]$taskSaveOption)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDoc)
    }
    if ($null -ne $taskWord) {
        $taskWord.Quit([ref]$taskSaveOption)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
