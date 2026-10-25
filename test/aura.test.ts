import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorPacket,
  commitPacket,
  effectPacket,
  packetsForState,
  parseConfigResponse,
  parseFirmwareResponse,
  parseHexColor
} from '../src/main/services/aura.ts'

test('every packet is a 65-byte report with id 0xEC', () => {
  for (const packet of [effectPacket(0, 'static'), colorPacket(0, 3, [1, 2, 3]), commitPacket()]) {
    assert.equal(packet.length, 65)
    assert.equal(packet[0], 0xec)
  }
})

test('effect packet carries channel and mode id', () => {
  assert.deepEqual(effectPacket(2, 'rainbow').slice(0, 6), [0xec, 0x35, 2, 0, 0, 0x05])
})

test('colour packet masks the requested slots and fills their RGB', () => {
  const packet = colorPacket(1, 2, [0x10, 0x20, 0x30])
  assert.deepEqual(packet.slice(0, 5), [0xec, 0x36, 0x00, 0b110, 0x00])
  assert.deepEqual(packet.slice(5, 14), [0, 0, 0, 0x10, 0x20, 0x30, 0x10, 0x20, 0x30])
})

test('colour packet never addresses past 16 slots', () => {
  const packet = colorPacket(14, 5, [1, 1, 1])
  assert.equal((packet[2] << 8) | packet[3], 0b11 << 14)
})

test('commit packet', () => {
  assert.deepEqual(commitPacket().slice(0, 3), [0xec, 0x3f, 0x55])
})

test('parses config table with or without the report id echoed', () => {
  const table = new Array<number>(60).fill(0)
  table[0x02] = 3
  table[0x1b] = 4
  const withId = [0xec, 0x30, 0, 0, ...table]
  const withoutId = [0x30, 0, 0, ...table]
  assert.deepEqual(parseConfigResponse(withId)?.config, { mainboardLeds: 4, argbHeaders: 3 })
  assert.deepEqual(parseConfigResponse(withoutId)?.config, { mainboardLeds: 4, argbHeaders: 3 })
  assert.equal(parseConfigResponse([0xec, 0x99]), null)
})

test('parses firmware string', () => {
  const name = [...'AULA3-AR32-0207'].map((char) => char.charCodeAt(0))
  assert.equal(parseFirmwareResponse([0xec, 0x02, ...name, 0]), 'AULA3-AR32-0207')
})

test('state turns into effect, colour and commit packets', () => {
  const packets = packetsForState({ mode: 'static', color: '#ff8000', includeHeaders: true }, { mainboardLeds: 2, argbHeaders: 1 })
  assert.deepEqual(
    packets.map((packet) => packet[1]),
    [0x35, 0x36, 0x35, 0x36, 0x3f]
  )
  assert.deepEqual(parseHexColor('#FF8000'), [255, 128, 0])
  assert.throws(() => parseHexColor('red'))
})
