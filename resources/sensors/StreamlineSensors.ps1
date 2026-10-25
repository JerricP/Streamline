<#
  Streamline sensor helper.

  Reads temperatures, fan speeds and other sensors through LibreHardwareMonitorLib
  and sets fan duty on request. It runs elevated (the PawnIO driver that
  LibreHardwareMonitor uses for the Super I/O chip only opens for
  administrators) and talks to the Streamline tray app over a named pipe,
  one JSON object per line:

    helper -> app   {"type":"hello","token":...,"elevated":...,"driverInstalled":...}
    app -> helper   {"id":1,"cmd":"read"}
                    {"id":2,"cmd":"set","control":"/lpc/nct6701d/0/control/1","value":55}
                    {"id":3,"cmd":"default","control":"/lpc/nct6701d/0/control/1"}
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
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $LibDir 'LibreHardwareMonitorLib.dll'))

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
