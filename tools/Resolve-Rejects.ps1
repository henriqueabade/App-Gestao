# Resolve-Rejects.ps1 - Versão v2 (PS 5.1 compatível, ASCII only)
# - Lê *.rej
# - Tenta aplicar hunk usando:
#   (A) Regex tolerante a espaços (como v1)
#   (B) Regex com linhas de CONTEXTO do hunk (mais agressivo)
# - Fallback específico para src/login/loginRenderer.js (caso comum do "Entrando...")
# - Remove .rej/.orig quando resolver

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Normalize-Text([string]$text) {
  if ($null -eq $text) { return "" }
  $t = $text -replace "`r`n", "`n"
  $t = $t -replace "`r", "`n"
  $t = $t -replace "[`t ]+", " "
  return $t.Trim()
}
function Escape-Regex([string]$s) { [Regex]::Escape($s) }

function Build-HunkBlocks {
  param([string]$hunkText)

  $lines    = $hunkText -split "`r?`n"
  $oldLines = New-Object System.Collections.Generic.List[string]
  $newLines = New-Object System.Collections.Generic.List[string]
  $ctxLines = New-Object System.Collections.Generic.List[string]

  foreach ($ln in $lines) {
    if ($ln -match '^\-\-\-' -or $ln -match '^\+\+\+' -or $ln -match '^\@\@') { continue }
    if ($ln -match '^\-') { $oldLines.Add($ln.Substring(1)); continue }
    if ($ln -match '^\+') { $newLines.Add($ln.Substring(1)); continue }
    if ($ln -match '^\ ') { $ctxLines.Add($ln.Substring(1));  continue }
  }

  return @{
    Old = ($oldLines -join "`n")
    New = ($newLines -join "`n")
    Ctx = ($ctxLines -join "`n")
  }
}

function Apply-By-LooseWhitespace {
  param([string]$normTarget, [string]$oldBlock, [string]$newBlock]

  $oldNorm = Normalize-Text $oldBlock
  $newNorm = Normalize-Text $newBlock
  if ([string]::IsNullOrWhiteSpace($oldNorm)) { return @{ Changed = $false; Out = $normTarget } }

  $oldRegex = Escape-Regex $oldNorm
  $oldRegex = $oldRegex -replace "(?:\s)+", "\\s+"

  $pattern = New-Object System.Text.RegularExpressions.Regex($oldRegex, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $pattern.IsMatch($normTarget)) {
    return @{ Changed = $false; Out = $normTarget }
  }

  $out = $pattern.Replace($normTarget, [Regex]::Escape((Normalize-Text $newBlock)), 1)
  return @{ Changed = ($out -ne $normTarget); Out = $out }
}

function Build-ContextRegex {
  param([string]$ctxAndOldBlock)

  # Junta CONTEXTO + OLD numa única sequência, tolerante a espaços e quebras de linha
  $norm = Normalize-Text $ctxAndOldBlock
  if ([string]::IsNullOrWhiteSpace($norm)) { return $null }
  $rx = Escape-Regex $norm
  $rx = $rx -replace "(?:\s)+", "\\s+"
  return New-Object System.Text.RegularExpressions.Regex($rx, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

function Apply-By-Context {
  param([string]$normTarget, [string]$ctx, [string]$oldBlock, [string]$newBlock]

  # Tenta achar "ctx + old" e substituir por "ctx + new"
  $ctxNorm = Normalize-Text $ctx
  $oldNorm = Normalize-Text $oldBlock
  $newNorm = Normalize-Text $newBlock

  if ([string]::IsNullOrWhiteSpace($oldNorm)) { return @{ Changed = $false; Out = $normTarget } }

  $lhs = @()
  if (-not [string]::IsNullOrWhiteSpace($ctxNorm)) { $lhs += $ctxNorm }
  $lhs += $oldNorm
  $pattern = Build-ContextRegex (($lhs -join "`n"))
  if ($null -eq $pattern) { return @{ Changed = $false; Out = $normTarget } }

  if (-not $pattern.IsMatch($normTarget)) {
    return @{ Changed = $false; Out = $normTarget }
  }

  $replacementNorm = @()
  if (-not [string]::IsNullOrWhiteSpace($ctxNorm)) { $replacementNorm += $ctxNorm }
  $replacementNorm += $newNorm
  $rep = [Regex]::Escape(($replacementNorm -join "`n"))

  $out = $pattern.Replace($normTarget, $rep, 1)
  return @{ Changed = ($out -ne $normTarget); Out = $out }
}

function Write-Back {
  param([string]$path, [string]$normalizedText)
  $out = ($normalizedText -replace "`n", "`r`n")
  Set-Content -Path $path -Value $out -Encoding UTF8
}

# ---------------- main ----------------

$rejFiles = Get-ChildItem -Recurse -Filter "*.rej"
if (-not $rejFiles) {
  Write-Host "Nenhum arquivo .rej encontrado. Nada a resolver."
  exit 0
}

foreach ($rej in $rejFiles) {
  Write-Host ""
  Write-Host "Processando rejects em: $($rej.FullName)"

  $targetPath = $rej.FullName -replace '\.rej$', ''
  $origPath   = "$targetPath.orig"

  if (-not (Test-Path $targetPath)) {
    Write-Warning "Arquivo alvo não existe: $targetPath. Pulando."
    continue
  }

  $rejText  = Get-Content -Raw -Path $rej.FullName
  $hunks    = ($rejText -split "(?m)^(?=@@)") | Where-Object { $_.Trim() -ne "" }

  $targetRaw  = Get-Content -Raw -Path $targetPath
  $normTarget = Normalize-Text $targetRaw

  $anyApplied = $false

  foreach ($h in $hunks) {
    $blocks = Build-HunkBlocks -hunkText $h
    $oldB = $blocks.Old
    $newB = $blocks.New
    $ctxB = $blocks.Ctx

    # (A) Tentativa whitespace-tolerant simples
    $r1 = Apply-By-LooseWhitespace -normTarget $normTarget -oldBlock $oldB -newBlock $newB
    if ($r1.Changed) {
      $normTarget = $r1.Out
      Write-Host "Hunk aplicado (modo A - whitespace tolerante)."
      $anyApplied = $true
      continue
    }

    # (B) Tentativa com CONTEXTO + OLD
    $r2 = Apply-By-Context -normTarget $normTarget -ctx $ctxB -oldBlock $oldB -newBlock $newB
    if ($r2.Changed) {
      $normTarget = $r2.Out
      Write-Host "Hunk aplicado (modo B - contexto + old)."
      $anyApplied = $true
      continue
    }

    Write-Warning "Hunk não pôde ser aplicado automaticamente."
  }

  if (-not $anyApplied) {
    # -------- Fallback específico para loginRenderer.js (caso comum: 'Entrando...') --------
    if ($targetPath -like "*src\login\loginRenderer.js") {
      $fallbackText = Get-Content -Raw -Path $targetPath
      $fb = $fallbackText

      # 1) 'Reconectando...' -> 'Entrando...'
      $fb = $fb -replace "Reconectando\.\.\.", "Entrando..."

      # 2) 'Conectando...' -> 'Entrando...'
      $fb = $fb -replace "Conectando\.\.\.", "Entrando..."

      # 3) opcional: remover toast informativo de 'Conectando ao banco...' se existir
      #   linhas com showToast(...'Conectando ao banco...')
      $fb = ($fb -split "`r?`n") | Where-Object {
        $_ -notmatch "showToast\(.+Conectando ao banco"
      } | ForEach-Object { $_ } | Out-String
      $fb = $fb -replace "(\r?\n)+$", ""

      if ($fb -ne $fallbackText) {
        Set-Content -Path $targetPath -Value $fb -Encoding UTF8
        Write-Host "Fallback aplicado em: $targetPath"
        $anyApplied = $true
      }
    }
  }

  if ($anyApplied) {
    Write-Back -path $targetPath -normalizedText $normTarget
    if (Test-Path $rej.FullName) { Remove-Item $rej.FullName -Force }
    if (Test-Path $origPath)     { Remove-Item $origPath -Force }
    Write-Host "Alterações gravadas em: $targetPath"
  } else {
    Write-Host "Nenhum hunk deste .rej pôde ser aplicado automaticamente."
  }
}

Write-Host ""
Write-Host "Diff após resolver:"
git --no-pager diff

Write-Host ""
Write-Host "Status:"
git status
