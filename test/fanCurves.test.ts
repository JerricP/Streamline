import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PANIC_TEMP,
  RAMP_DOWN_PER_TICK,
  RAMP_UP_PER_TICK,
  STALL_TICKS,
  canControl,
  checkStall,
  evaluateCurve,
  fanChannels,
  fanIdForControl,
  preferredSource,
  sanitizeFanConfig,
  targetDuty
} from '../src/main/services/fanCurves.ts'
import { SimulatedBackend } from '../src/main/services/sensorSimulator.ts'

const points = [
  { temp: 30, duty: 20 },
  { temp: 60, duty: 50 },
  { temp: 80, duty: 100 }
]
const curve = { name: null, mode: 'curve' as const, minDuty: 0, fixedDuty: 50, sourceId: '/cpu/t', points }

test('curve is flat outside its points and linear between them', () => {
  assert.equal(evaluateCurve(points, 10), 20)
  assert.equal(evaluateCurve(points, 30), 20)
  assert.equal(evaluateCurve(points, 45), 35)
  assert.equal(evaluateCurve(points, 70), 75)
  assert.equal(evaluateCurve(points, 100), 100)
})

test('bios mode leaves the fan alone and fixed mode holds one speed', () => {
  assert.equal(targetDuty({ ...curve, mode: 'bios' }, 50, null), null)
  assert.equal(targetDuty({ ...curve, mode: 'fixed', fixedDuty: 42 }, 90, 10), 42)
})

test('a curve whose temperature is missing or too hot runs at 100%', () => {
  assert.equal(targetDuty(curve, null, 30), 100)
  assert.equal(targetDuty(curve, Number.NaN, 30), 100)
  assert.equal(targetDuty(curve, PANIC_TEMP, 30), 100)
  assert.equal(targetDuty(curve, 0, 30), 100)
})

test('curve output ramps instead of jumping', () => {
  assert.equal(targetDuty(curve, 45, null), 35)
  assert.equal(targetDuty(curve, 80, 35), 35 + RAMP_UP_PER_TICK)
  assert.equal(targetDuty(curve, 30, 50), 50 - RAMP_DOWN_PER_TICK)
  assert.equal(targetDuty(curve, 45, 34), 35)
})

test('the minimum speed is a floor for fixed and curve modes', () => {
  assert.equal(targetDuty({ ...curve, minDuty: 40 }, 30, null), 40)
  assert.equal(targetDuty({ ...curve, mode: 'fixed', fixedDuty: 10, minDuty: 30 }, 50, null), 30)
})

test('a fan that spins under the BIOS and stops under Streamline is a stall', () => {
  let state = checkStall(undefined, 1100, null).next
  let stalled = false
  for (let tick = 0; tick < STALL_TICKS; tick += 1) ({ next: state, stalled } = checkStall(state, 0, 60))
  assert.equal(stalled, true)
  // Never seen spinning (nothing plugged in), no tachometer, or a deliberately low speed: not a stall.
  assert.equal(checkStall({ seenSpinning: false, zeroTicks: 99 }, 0, 60).stalled, false)
  assert.equal(checkStall({ seenSpinning: true, zeroTicks: 99 }, null, 60).stalled, false)
  assert.equal(checkStall({ seenSpinning: true, zeroTicks: 99 }, 0, 10).stalled, false)
})

test('fans on chips Streamline cannot drive are listed but not controllable', () => {
  assert.equal(canControl('/lpc/nct6701d/0/control/0'), false)
  assert.equal(canControl('/lpc/nct6799d/0/control/0'), true)
})

test('sanitize sorts, rounds and clamps points', () => {
  const config = sanitizeFanConfig({
    mode: 'curve',
    fixedDuty: 140,
    sourceId: '/cpu/t',
    points: [
      { temp: 70.4, duty: 120 },
      { temp: -5, duty: 10.6 }
    ]
  })
  assert.deepEqual(config.points, [
    { temp: 0, duty: 11 },
    { temp: 70, duty: 100 }
  ])
  assert.equal(config.fixedDuty, 100)
  assert.equal(config.minDuty, 0)
  assert.equal(config.name, null)
})

test('sanitize rejects bad input', () => {
  assert.throws(() => sanitizeFanConfig({ ...curve, mode: 'turbo' as never }))
  assert.throws(() => sanitizeFanConfig({ ...curve, points: [{ temp: 40, duty: 40 }] }))
  assert.throws(() => sanitizeFanConfig({ ...curve, points: [{ temp: 40, duty: 40 }, { temp: 40, duty: 60 }] }))
  assert.throws(() => sanitizeFanConfig({ ...curve, sourceId: null }))
  assert.throws(() => sanitizeFanConfig({ ...curve, points: [{ temp: 'hot', duty: 1 }, { temp: 50, duty: 2 }] as never }))
})

test('controls pair with fans of the same number', () => {
  assert.equal(fanIdForControl('/lpc/nct6701d/0/control/2'), '/lpc/nct6701d/0/fan/2')
})

test('channels and default source come from the snapshot', async () => {
  const backend = new SimulatedBackend()
  const snapshot = { at: 0, hardware: await backend.read() }
  assert.equal(preferredSource(snapshot), '/amdcpu/0/temperature/2')
  const channels = fanChannels(snapshot, {}, new Map([['/lpc/nct6799d/0/control/0', 55]]))
  // The simulated GPU's fan is not offered: only motherboard headers and coolers are.
  assert.equal(channels.length, 4)
  assert.ok(channels.every((channel) => channel.controlId.startsWith('/lpc/')))
  assert.equal(channels[0].name, 'CPU Fan')
  const renamed = fanChannels(snapshot, { '/lpc/nct6799d/0/control/2': { ...curve, name: 'AIO fans' } }, new Map())
  assert.equal(renamed[2].name, 'AIO fans')
  assert.equal(renamed[2].chipName, 'Chassis Fan')
  assert.equal(channels[0].target, 55)
  assert.equal(channels[0].config.mode, 'bios')
  // Header 2 has no tachometer in the simulator, so it falls back to the control's name.
  assert.equal(channels[1].fanId, null)
})
