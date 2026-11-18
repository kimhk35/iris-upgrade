# MathML → 워드 수식(OMML) (P18) — 오피스에 들어 있는 공식 변환표 MML2OMML.XSL 을 윈도 .NET 으로 돌린다(설치 없음).
# 입력 = 파일 하나(JSON 배열: MathML 문자열 또는 null), 출력 = 같은 순서의 OMML 문자열 JSON 배열(UTF-8, 표준 출력).
param([Parameter(Mandatory = $true)][string]$InFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$xslPath = @(
  "$env:ProgramFiles\Microsoft Office\root\Office16\MML2OMML.XSL",
  "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\MML2OMML.XSL",
  "$env:ProgramFiles\Microsoft Office\Office16\MML2OMML.XSL",
  "${env:ProgramFiles(x86)}\Microsoft Office\Office16\MML2OMML.XSL"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $xslPath) { Write-Error 'MML2OMML.XSL 을 찾지 못했습니다(Microsoft Office 가 필요합니다)'; exit 3 }
$xsl = New-Object System.Xml.Xsl.XslCompiledTransform
$settings = New-Object System.Xml.Xsl.XsltSettings($true, $false)
$xsl.Load($xslPath, $settings, (New-Object System.Xml.XmlUrlResolver))
$items = Get-Content -Raw -Encoding UTF8 $InFile | ConvertFrom-Json
$out = New-Object System.Collections.Generic.List[object]
foreach ($m in $items) {
  if (-not $m) { $out.Add($null); continue }
  try {
    $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader($m)))
    $sw = New-Object System.IO.StringWriter
    $ws = New-Object System.Xml.XmlWriterSettings; $ws.OmitXmlDeclaration = $true
    $writer = [System.Xml.XmlWriter]::Create($sw, $ws)
    $xsl.Transform($reader, $writer); $writer.Close()
    $out.Add($sw.ToString())
  } catch { $out.Add($null) }
}
ConvertTo-Json -InputObject $out.ToArray() -Compress -Depth 3
