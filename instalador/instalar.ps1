#Requires -Version 5.1
# Instalador do Agente de impressão da Ônix (expedição).
# Instala Node.js e Chrome se faltarem, copia o agente para C:\OnixAgente,
# pergunta a impressora deste PC e instala o serviço do Windows (liga com o PC).
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Instalador do Agente Ônix'

# Precisa de administrador para instalar o serviço.
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

$destino = 'C:\OnixAgente'
$origem = $PSScriptRoot
function Passo($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function AtualizarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

try {
  Write-Host "Instalador do Agente Ônix - impressão automática da expedição" -ForegroundColor White

  # 1. Node.js 24+
  Passo "Verificando o Node.js"
  AtualizarPath
  $versao = $null
  try { $versao = (& node -v) -replace '^v', '' } catch { }
  if (-not $versao -or [int]($versao.Split('.')[0]) -lt 24) {
    Write-Host "Instalando o Node.js (pode levar alguns minutos)..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    AtualizarPath
    $versao = (& node -v) -replace '^v', ''
  }
  Write-Host "Node.js $versao OK" -ForegroundColor Green

  # 2. Google Chrome (gera o PDF da folha)
  Passo "Verificando o Google Chrome"
  $locais = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe")
  $chrome = $locais | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $chrome) {
    Write-Host "Instalando o Google Chrome..."
    winget install -e --id Google.Chrome --accept-source-agreements --accept-package-agreements --silent
    $chrome = $locais | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if (-not $chrome) { throw "Não encontrei o Google Chrome. Instale manualmente e rode o instalador de novo." }
  Write-Host "Chrome OK: $chrome" -ForegroundColor Green

  # 3. Se já existe um agente instalado, para o serviço antes de atualizar os arquivos.
  $servico = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Onix Expedicao - Agente' }
  if ($servico -and $servico.Status -eq 'Running') { Passo "Parando o agente atual"; Stop-Service $servico.Name -Force }

  # 4. Copia os arquivos (mantém o config.json de uma instalação anterior)
  Passo "Copiando o agente para $destino"
  $configAnterior = $null
  if (Test-Path "$destino\agente\config.json") { $configAnterior = Get-Content "$destino\agente\config.json" -Raw | ConvertFrom-Json }
  robocopy $origem $destino /E /NFL /NDL /NJH /NJS /NP /XD node_modules dados | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar os arquivos (robocopy $LASTEXITCODE)" }

  # 5. Dependências
  Passo "Instalando dependências (npm)"
  Push-Location $destino
  & npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm install falhou" }
  Pop-Location

  # 6. Impressora deste PC
  Passo "Escolha a impressora deste computador"
  $impressoras = @(Get-Printer | Where-Object { $_.Name -notmatch 'PDF|Fax|OneNote|XPS|Microsoft' } | Select-Object -ExpandProperty Name)
  $padrao = (Get-CimInstance Win32_Printer | Where-Object Default).Name
  $escolhida = $null
  if ($configAnterior -and $configAnterior.impressora) { Write-Host "Impressora atual: $($configAnterior.impressora)" }
  if ($impressoras.Count -eq 0) {
    Write-Host "Nenhuma impressora encontrada. O agente vai só salvar os PDFs em $destino\dados\folhas." -ForegroundColor Yellow
  } else {
    for ($i = 0; $i -lt $impressoras.Count; $i++) {
      $marca = if ($impressoras[$i] -eq $padrao) { ' (padrão)' } else { '' }
      Write-Host ("  {0}) {1}{2}" -f ($i + 1), $impressoras[$i], $marca)
    }
    $resposta = Read-Host "Número da impressora (Enter = padrão)"
    if ([string]::IsNullOrWhiteSpace($resposta)) { $escolhida = $padrao } else { $escolhida = $impressoras[[int]$resposta - 1] }
    Write-Host "Usando: $escolhida" -ForegroundColor Green
  }

  # 7. Configuração (servidor e token vêm no pacote)
  Passo "Gravando a configuração"
  $config = Get-Content "$destino\agente\config.pacote.json" -Raw | ConvertFrom-Json
  $config | Add-Member -NotePropertyName chromePath -NotePropertyValue $chrome -Force
  $config | Add-Member -NotePropertyName impressora -NotePropertyValue ($(if ($escolhida) { $escolhida } else { '' })) -Force
  if (-not $escolhida) { $config.modo = 'pasta' }
  $json = $config | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText("$destino\agente\config.json", $json, (New-Object Text.UTF8Encoding $false))

  # 8. Serviço do Windows
  Passo "Instalando o serviço (liga sozinho com o Windows)"
  Push-Location $destino
  if ($servico) { Start-Service $servico.Name } else { & node scripts\servicos.ts instalar agente }
  Pop-Location
  Start-Sleep -Seconds 5
  Get-Service | Where-Object { $_.DisplayName -eq 'Onix Expedicao - Agente' } | Format-Table Status, StartType, DisplayName -AutoSize

  Write-Host ""
  Write-Host "Pronto! O agente está instalado e liga sozinho com o computador." -ForegroundColor Green
  Write-Host "Painel: $($config.servidorUrl)  (a impressão automática liga/desliga por lá)"
  Write-Host "Log: $destino\agente\src\daemon\onixexpedicaoagente.out.log"
} catch {
  Write-Host ""
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""
Read-Host "Aperte Enter para fechar"
