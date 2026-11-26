# =====================================================================
#  BaseStudio - installation sur un nouveau PC
#  1. Trouve XAMPP
#  2. Copie l'appli dans xampp\htdocs\basestudio
#  3. Crée le raccourci BaseStudio (Bureau + menu Démarrer)
#  Aucune donnée n'est copiée : chacun a ses propres bases MySQL
#  et ses propres réglages (thèmes, serveurs, historique).
# =====================================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $here 'basestudio'

function Stop-Install($msg) {
    Write-Host ''
    Write-Host "  ERREUR : $msg" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Appuie sur Entrée pour fermer'
    exit 1
}

Write-Host ''
Write-Host '  ===  Installation de BaseStudio  ===' -ForegroundColor Magenta
Write-Host ''

if (-not (Test-Path (Join-Path $src 'index.html'))) {
    Stop-Install "Le dossier 'basestudio' est introuvable. Dézippe tout le ZIP avant de lancer INSTALLER.bat."
}

# --- 1. Trouver XAMPP ------------------------------------------------
$xampp = $null
foreach ($p in @('C:\xampp', 'D:\xampp', 'E:\xampp', "$env:USERPROFILE\xampp")) {
    if (Test-Path (Join-Path $p 'htdocs')) { $xampp = $p; break }
}
if (-not $xampp) {
    Write-Host '  XAMPP n''a pas été trouvé dans C:\xampp.' -ForegroundColor Yellow
    Write-Host '  - Si XAMPP n''est pas installé : télécharge-le sur https://www.apachefriends.org/fr/'
    Write-Host '    installe-le, puis relance INSTALLER.bat.'
    Write-Host '  - S''il est installé ailleurs, tape son dossier (ex : D:\Logiciels\xampp).'
    Write-Host ''
    $answer = Read-Host '  Dossier de XAMPP (ou Entrée pour quitter)'
    if (-not $answer) { exit 1 }
    if (-not (Test-Path (Join-Path $answer 'htdocs'))) { Stop-Install "Pas de dossier htdocs dans '$answer'." }
    $xampp = $answer
}
Write-Host "  XAMPP trouvé : $xampp" -ForegroundColor Green

# --- 2. Copier l'appli -----------------------------------------------
$dest = Join-Path $xampp 'htdocs\basestudio'
if (Test-Path $dest) {
    Write-Host '  BaseStudio est déjà installé : mise à jour des fichiers (tes bases ne sont pas touchées).'
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
Write-Host "  Appli copiée dans $dest" -ForegroundColor Green

# --- 3. Raccourcis ---------------------------------------------------
$edge = $null
foreach ($p in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                 "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")) {
    if (Test-Path $p) { $edge = $p; break }
}
if (-not $edge) { Stop-Install 'Microsoft Edge est introuvable sur ce PC.' }

$url  = 'http://localhost/basestudio/'
$icon = Join-Path $dest 'basestudio.ico'
$shell = New-Object -ComObject WScript.Shell
$places = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('Programs')
)
foreach ($dir in $places) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'BaseStudio.lnk'))
    $lnk.TargetPath   = $edge
    $lnk.Arguments    = "--app=$url"
    $lnk.IconLocation = "$icon,0"
    $lnk.Description  = 'BaseStudio - gestionnaire MySQL'
    $lnk.WorkingDirectory = Split-Path $edge
    $lnk.Save()
}
Write-Host '  Raccourci BaseStudio créé sur le Bureau et dans le menu Démarrer.' -ForegroundColor Green

# --- Fin -------------------------------------------------------------
Write-Host ''
Write-Host '  C''est installé !' -ForegroundColor Magenta
Write-Host '  1. Ouvre le panneau XAMPP et clique sur Start pour Apache et MySQL.'
Write-Host '  2. Double-clique sur le raccourci BaseStudio du Bureau.'
Write-Host '  3. Clique sur Se connecter (localhost / 3306 / root / mot de passe vide).'
Write-Host ''
$open = Read-Host '  Ouvrir BaseStudio maintenant ? (O/N)'
if ($open -match '^[oOyY]') { Start-Process $edge "--app=$url" }
