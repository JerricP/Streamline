<#
  Streamline sensor helper.

  Reads temperatures, fan speeds and other sensors through LibreHardwareMonitorLib
  and sets fan duty on request. It runs elevated (the PawnIO driver that
  LibreHardwareMonitor uses for the Super I/O chip only opens for
  administrators) and talks to the Streamline tray app over a named pipe,
  one JSON object per line:

    helper -> app   {"type":"hello","token":...,"elevated":...,"driverInstalled":...}
    app -> helper   {"id":1,"cmd":"read"}
                    {"id":2,"cmd":"set","control":"/lpc/nct6799d/0/control/1","value":55}
                    {"id":3,"cmd":"default","control":"/lpc/nct6799d/0/control/1"}
                    {"id":4,"cmd":"chipCurveRead","control":"/lpc/nct6701d/0/control/0"}
                    {"id":5,"cmd":"chipCurveWrite","control":"/lpc/nct6701d/0/control/0","points":[{"temp":0,"duty":127},...]}
    helper -> app   {"id":1,"ok":true,"hardware":[...]}  or  {"id":1,"ok":false,"error":"..."}

  When the pipe closes for any reason (Streamline quit, crashed or was killed)
  every fan this helper touched is handed back to the BIOS before exiting, so
  fans never stay stuck at a software speed.
#>
param(
  [Parameter(Mandatory = $true)][string]$LibDir,
  [Parameter(Mandatory = $true)][string]$Pipe,
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = 'Stop'

# The NuGet builds reference slightly different versions of System.Memory and
# friends. Resolve any of them by simple name from our folder, as a binding
# redirect would. Compiled C# so the handler works on any thread.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
public static class StreamlineResolver {
  private static string dir;
  public static void Install(string libDir) {
    dir = libDir;
    AppDomain.CurrentDomain.AssemblyResolve += OnResolve;
  }
  private static Assembly OnResolve(object sender, ResolveEventArgs args) {
    string file = Path.Combine(dir, new AssemblyName(args.Name).Name + ".dll");
    return File.Exists(file) ? Assembly.LoadFrom(file) : null;
  }
}
'@
[StreamlineResolver]::Install($LibDir)
$lhmAssembly = [System.Reflection.Assembly]::LoadFrom((Join-Path $LibDir 'LibreHardwareMonitorLib.dll'))

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$driverInstalled = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stream = New-Object System.IO.Pipes.NamedPipeClientStream('.', $Pipe, [System.IO.Pipes.PipeDirection]::InOut)
$stream.Connect(10000)
$reader = New-Object System.IO.StreamReader($stream, $utf8)
$writer = New-Object System.IO.StreamWriter($stream, $utf8)
$writer.AutoFlush = $true

function Send($object) {
  $writer.WriteLine(($object | ConvertTo-Json -Compress -Depth 6))
}

# ConvertTo-Json writes NaN and Infinity as bare words, which isn't JSON.
function Num($value) {
  if ($null -eq $value) { return $null }
  $number = [double]$value
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
  return [math]::Round($number, 2)
}

$computer = $null
$controls = @{}
$touched = @{}

# ---- NCT6701D chip curves ----------------------------------------------------
# On the ROG Strix B850-I the fan chip runs its own 10-point curve per header
# (SmartFan IV, register 0x02 = 0x40, with 0x1C bit 7 enabling the dual
# DC/PWM curve engine). Armoury Crate sets fans by rewriting those points;
# LibreHardwareMonitor's manual duty leaves the DC curve at zero and the fan
# stops. So for this chip Streamline writes the curve points, as ASUS does.
# Banks were read off this board; headers not listed here stay read-only.
# CPU_FAN (control/1, bank 0x02) is left out for now: on this PC it drives the AIO pump.
$chipBanks = @{
  '/lpc/nct6701d/0/control/0' = 0x01  # Chassis Fan
}
$chipTempRegs = @(0x11, 0x12, 0x13, 0x14, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85)
$chipDutyRegs = @(0x17, 0x18, 0x19, 0x1A, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B)
$chipModeReg = 0x02
$chipSmartFanIV = 0x40
$chipEngineReg = 0x1C
$chipEngineOn = 0x80

function Get-Nct([string]$controlId) {
  $bank = $chipBanks[$controlId]
  if ($null -eq $bank) { throw "Chip curves are not supported on $controlId" }
  $prefix = $controlId -replace '/control/\d+$', ''
  $hardware = $null
  foreach ($board in $computer.Hardware) {
    foreach ($sub in $board.SubHardware) { if ($sub.Identifier.ToString() -eq $prefix) { $hardware = $sub } }
  }
  if (-not $hardware) { throw "Fan chip $prefix not found" }
  $flags = [System.Reflection.BindingFlags]'NonPublic, Instance'
  $chip = $hardware.GetType().GetField('_superIO', $flags).GetValue($hardware)
  return @{
    bank = $bank
    chip = $chip
    read = $chip.GetType().GetMethod('ReadByte', $flags)
    write = $chip.GetType().GetMethod('WriteByte', $flags)
  }
}

function Read-Reg($nct, [int]$reg) { return [int]$nct.read.Invoke($nct.chip, @([uint16]($nct.bank * 256 + $reg))) }
function Write-Reg($nct, [int]$reg, [int]$value) { [void]$nct.write.Invoke($nct.chip, @([uint16]($nct.bank * 256 + $reg), [byte]$value)) }

# Hold the same locks LibreHardwareMonitor and Armoury Crate use for the chip.
# LHM's Mutexes class is internal, so reach its public static methods by
# reflection. ASUS's lock is an auto-reset event, not a mutex: waiting takes
# it and Set() hands it back.
$lhmMutexes = $lhmAssembly.GetType('LibreHardwareMonitor.Hardware.Mutexes', $true)
$staticFlags = [System.Reflection.BindingFlags]'Public, NonPublic, Static'
$waitIsaBus = $lhmMutexes.GetMethod('WaitIsaBus', $staticFlags)
$releaseIsaBus = $lhmMutexes.GetMethod('ReleaseIsaBus', $staticFlags)

function Use-ChipLock([scriptblock]$body) {
  if (-not $waitIsaBus.Invoke($null, @([int]1000))) { throw 'The fan chip is busy' }
  $asus = $null
  $asusTaken = $false
  try {
    try {
      $asus = [System.Threading.EventWaitHandle]::OpenExisting('Global\ASUS_SIO_MUTEX')
      $asusTaken = $asus.WaitOne(1000)
      if (-not $asusTaken) { throw 'Armoury Crate is using the fan chip' }
    } catch [System.Threading.WaitHandleCannotBeOpenedException] {
      $asus = $null
    }
    return & $body
  } finally {
    if ($asus) {
      if ($asusTaken) { [void]$asus.Set() }
      $asus.Dispose()
    }
    [void]$releaseIsaBus.Invoke($null, $null)
  }
}

function Read-ChipCurve($nct) {
  $points = for ($i = 0; $i -lt 10; $i++) { @{ temp = (Read-Reg $nct $chipTempRegs[$i]); duty = (Read-Reg $nct $chipDutyRegs[$i]) } }
  return @{ mode = (Read-Reg $nct $chipModeReg); engine = (Read-Reg $nct $chipEngineReg); points = @($points) }
}

try {
  $computer = New-Object LibreHardwareMonitor.Hardware.Computer
  $computer.IsMotherboardEnabled = $true
  $computer.IsCpuEnabled = $true
  $computer.IsGpuEnabled = $true
  $computer.IsMemoryEnabled = $true
  $computer.IsStorageEnabled = $true
  $computer.IsControllerEnabled = $true
  $computer.Open()

  Send @{ type = 'hello'; token = $Token; elevated = $elevated; driverInstalled = $driverInstalled }

  function Read-Hardware {
    $list = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    foreach ($hw in $computer.Hardware) { $queue.Enqueue(@($hw, '')) }
    while ($queue.Count -gt 0) {
      $item = $queue.Dequeue()
      $hw = $item[0]
      $hw.Update()
      # The script file is read as ANSI by Windows PowerShell 5.1, so build the dot from its code point.
      $name = if ($item[1]) { "$($item[1]) $([char]0x00B7) $($hw.Name)" } else { $hw.Name }
      $sensors = New-Object System.Collections.ArrayList
      foreach ($sensor in $hw.Sensors) {
        $id = $sensor.Identifier.ToString()
        if ($sensor.Control) { $controls[$id] = $sensor.Control }
        [void]$sensors.Add(@{
            id = $id
            name = $sensor.Name
            type = $sensor.SensorType.ToString()
            value = Num $sensor.Value
            min = Num $sensor.Min
            max = Num $sensor.Max
            software = [bool]($sensor.Control -and $sensor.Control.ControlMode.ToString() -eq 'Software')
          })
      }
      [void]$list.Add(@{ id = $hw.Identifier.ToString(); name = $name; type = $hw.HardwareType.ToString(); sensors = @($sensors) })
      foreach ($sub in $hw.SubHardware) { $queue.Enqueue(@($sub, $name)) }
    }
    return @($list)
  }

  while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    $request = $null
    try {
      $request = $line | ConvertFrom-Json
      switch ($request.cmd) {
        'read' {
          Send @{ id = $request.id; ok = $true; hardware = (Read-Hardware) }
        }
        'set' {
          $control = $controls[[string]$request.control]
          if (-not $control) { throw "Unknown fan control $($request.control)" }
          $value = [math]::Max(0, [math]::Min(100, [double]$request.value))
          $control.SetSoftware([single]$value)
          $touched[[string]$request.control] = $control
          Send @{ id = $request.id; ok = $true }
        }
        'default' {
          $control = $controls[[string]$request.control]
          if ($control) { $control.SetDefault() }
          $touched.Remove([string]$request.control)
          Send @{ id = $request.id; ok = $true }
        }
        'chipCurveRead' {
          $nct = Get-Nct ([string]$request.control)
          $curve = Use-ChipLock { Read-ChipCurve $nct }
          Send @{ id = $request.id; ok = $true; curve = $curve }
        }
        'chipCurveWrite' {
          $nct = Get-Nct ([string]$request.control)
          $points = @($request.points)
          if ($points.Count -ne 10) { throw 'A chip curve has exactly 10 points' }
          $last = 0
          foreach ($point in $points) {
            if ([int]$point.temp -lt $last -or [int]$point.temp -gt 255 -or [int]$point.duty -lt 0 -or [int]$point.duty -gt 255) {
              throw 'Chip curve points must rise in temperature and stay within 0-255'
            }
            $last = [int]$point.temp
          }
          # Don't let LibreHardwareMonitor's manual mode linger on this header.
          $control = $controls[[string]$request.control]
          if ($touched.ContainsKey([string]$request.control)) { $control.SetDefault(); $touched.Remove([string]$request.control) }
          $curve = Use-ChipLock {
            $mode = Read-Reg $nct $chipModeReg
            $engine = Read-Reg $nct $chipEngineReg
            if ($mode -ne $chipSmartFanIV -or ($engine -band $chipEngineOn) -eq 0) {
              throw ('Header is not in the expected curve mode (0x02={0:X2}, 0x1C={1:X2}); nothing written' -f $mode, $engine)
            }
            # Same order as Armoury Crate: pause the curve engine, write the points, resume it.
            Write-Reg $nct $chipEngineReg ($engine -band (-bnot $chipEngineOn))
            try {
              for ($i = 0; $i -lt 10; $i++) {
                Write-Reg $nct $chipTempRegs[$i] ([int]$points[$i].temp)
                Write-Reg $nct $chipDutyRegs[$i] ([int]$points[$i].duty)
              }
            } finally {
              Write-Reg $nct $chipEngineReg $engine
            }
            Read-ChipCurve $nct
          }
          Send @{ id = $request.id; ok = $true; curve = $curve }
        }
        default { throw "Unknown command $($request.cmd)" }
      }
    } catch {
      $id = if ($request) { $request.id } else { $null }
      Send @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
  }
} catch {
  try { Send @{ type = 'fatal'; error = $_.Exception.Message } } catch { }
} finally {
  foreach ($control in $touched.Values) {
    try { $control.SetDefault() } catch { }
  }
  if ($computer) { try { $computer.Close() } catch { } }
  $stream.Dispose()
}
