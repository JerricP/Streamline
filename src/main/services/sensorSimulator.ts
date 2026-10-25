import type { HardwareReading } from '@shared/types'
import type { SensorBackend } from './sensors'

/**
 * A fake board with the same shape LibreHardwareMonitor reports for the
 * B850-I, so the UI and fan engine can be developed and tested anywhere.
 * Enabled with STREAMLINE_SIMULATE_SENSORS=1.
 */
export class SimulatedBackend implements SensorBackend {
  readonly driverInstalled = true
  private time = 0
  private readonly extremes = new Map<string, [number, number]>()
  private readonly duty = new Map<string, number | null>([
    ['/lpc/nct6701d/0/control/0', null],
    ['/lpc/nct6701d/0/control/1', null],
    ['/lpc/nct6701d/0/control/2', null],
    ['/lpc/nct6701d/0/control/3', null]
  ])

  private biosDuty(cpuTemp: number): number {
    return Math.round(Math.min(100, Math.max(25, (cpuTemp - 30) * 1.6 + 25)))
  }

  async read(): Promise<HardwareReading[]> {
    this.time += 1
    const wave = (period: number, phase = 0) => Math.sin((this.time + phase) / period)
    const cpuTemp = Math.round((52 + 14 * wave(20) + 4 * wave(3.3)) * 10) / 10
    const gpuTemp = Math.round((47 + 9 * wave(35, 4)) * 10) / 10
    const sensor = (id: string, name: string, type: string, value: number, software = false) => {
      const [low, high] = this.extremes.get(id) ?? [value, value]
      this.extremes.set(id, [Math.min(low, value), Math.max(high, value)])
      return { id, name, type, value, min: Math.min(low, value), max: Math.max(high, value), software }
    }
    const controls = [...this.duty.entries()].map(([id, set], index) => {
      const value = set ?? this.biosDuty(cpuTemp)
      return { id, set, value, index }
    })
    const fanNames = ['CPU Fan', 'CPU Optional Fan', 'Chassis Fan', 'AIO Pump']
    const maxRpm = [1900, 1900, 1500, 3200]
    return [
      {
        id: '/motherboard',
        name: 'ASUS ROG STRIX B850-I GAMING WIFI',
        type: 'Motherboard',
        sensors: []
      },
      {
        id: '/lpc/nct6701d/0',
        name: 'ASUS ROG STRIX B850-I GAMING WIFI · Nuvoton NCT6701D',
        type: 'SuperIO',
        sensors: [
          sensor('/lpc/nct6701d/0/voltage/0', 'Vcore', 'Voltage', 1.21 + 0.02 * wave(5)),
          sensor('/lpc/nct6701d/0/voltage/1', '+5V', 'Voltage', 5.04),
          sensor('/lpc/nct6701d/0/voltage/2', '+12V', 'Voltage', 12.1),
          sensor('/lpc/nct6701d/0/temperature/0', 'Motherboard', 'Temperature', 36 + wave(40)),
          sensor('/lpc/nct6701d/0/temperature/1', 'CPU', 'Temperature', cpuTemp - 3),
          sensor('/lpc/nct6701d/0/temperature/2', 'VRM', 'Temperature', 44 + 5 * wave(25)),
          ...controls
            .filter((control) => control.index !== 1)
            .map((control) =>
              sensor(
                control.id.replace('/control/', '/fan/'),
                fanNames[control.index],
                'Fan',
                Math.round((maxRpm[control.index] * control.value) / 100 + 15 * wave(2, control.index))
              )
            ),
          ...controls.map((control) =>
            sensor(control.id, fanNames[control.index], 'Control', control.value, control.set !== null)
          )
        ]
      },
      {
        id: '/amdcpu/0',
        name: 'AMD Ryzen 7 9800X3D',
        type: 'Cpu',
        sensors: [
          sensor('/amdcpu/0/temperature/2', 'Core (Tctl/Tdie)', 'Temperature', cpuTemp),
          sensor('/amdcpu/0/temperature/3', 'CCD1 (Tdie)', 'Temperature', cpuTemp - 6),
          sensor('/amdcpu/0/load/0', 'CPU Total', 'Load', Math.max(1, 30 + 25 * wave(20))),
          sensor('/amdcpu/0/power/0', 'Package', 'Power', 60 + 30 * wave(20)),
          sensor('/amdcpu/0/clock/1', 'Core #1', 'Clock', 4900 + 300 * wave(7))
        ]
      },
      {
        id: '/gpu-nvidia/0',
        name: 'NVIDIA GeForce RTX 4070',
        type: 'GpuNvidia',
        sensors: [
          sensor('/gpu-nvidia/0/temperature/0', 'GPU Core', 'Temperature', gpuTemp),
          sensor('/gpu-nvidia/0/temperature/2', 'GPU Hot Spot', 'Temperature', gpuTemp + 9),
          sensor('/gpu-nvidia/0/load/0', 'GPU Core', 'Load', Math.max(0, 20 + 20 * wave(35, 4))),
          sensor('/gpu-nvidia/0/fan/1', 'GPU Fan 1', 'Fan', gpuTemp > 50 ? 1100 : 0),
          sensor('/gpu-nvidia/0/control/1', 'GPU Fan 1', 'Control', gpuTemp > 50 ? 35 : 0),
          sensor('/gpu-nvidia/0/power/0', 'GPU Package', 'Power', 45 + 30 * wave(35, 4))
        ]
      },
      {
        id: '/ram',
        name: 'Generic Memory',
        type: 'Memory',
        sensors: [
          sensor('/ram/load/0', 'Memory', 'Load', 41 + wave(60)),
          sensor('/ram/data/0', 'Memory Used', 'Data', 13.1 + 0.3 * wave(60))
        ]
      },
      {
        id: '/nvme/0',
        name: 'Samsung SSD 990 PRO 2TB',
        type: 'Storage',
        sensors: [sensor('/nvme/0/temperature/0', 'Composite Temperature', 'Temperature', 41 + wave(50))]
      }
    ]
  }

  async set(controlId: string, duty: number): Promise<void> {
    if (!this.duty.has(controlId)) throw new Error(`Unknown fan control ${controlId}`)
    this.duty.set(controlId, duty)
  }

  async restore(controlId: string): Promise<void> {
    if (this.duty.has(controlId)) this.duty.set(controlId, null)
  }

  onExit(): void {}

  close(): void {
    for (const id of this.duty.keys()) this.duty.set(id, null)
  }
}
