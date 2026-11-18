# 시험용: 워드로 문서를 읽기 전용으로 열어 수식(OMath) 개수만 출력한다(숫자 하나).
param([Parameter(Mandatory = $true)][string]$Path)
$w = New-Object -ComObject Word.Application
$w.Visible = $false
try {
  $d = $w.Documents.Open($Path, $false, $true)
  $n = $d.OMaths.Count
  $d.Close($false)
  Write-Output $n
} finally { $w.Quit() }
