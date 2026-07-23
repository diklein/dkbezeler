import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { measureFrame } from '../cli/lib/frame.mjs'
import { bakeStill } from '../cli/lib/bake.mjs'
import { pickFrame } from '../cli/lib/pick.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dkbezeler-test-'))
const framePath = join(dir, 'frame.png')

/* A synthetic 200x400 frame: transparent everywhere, a solid dark bezel ring from
 * (10,10) to (189,389), and a transparent screen hole from (30,30) to (169,369).
 * One antialiased (alpha 128) rim pixel band just outside the bezel's top edge
 * exercises the exterior repair. */
before(async () => {
  const w = 200, h = 400
  const px = Buffer.alloc(w * h * 4, 0)
  const set = (x, y, r, g, b, a) => {
    const o = (y * w + x) * 4
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a
  }
  for (let y = 10; y < 390; y++) {
    for (let x = 10; x < 190; x++) {
      const inHole = x >= 30 && x < 170 && y >= 30 && y < 370
      if (!inHole) set(x, y, 40, 40, 40, 255)
    }
  }
  for (let x = 10; x < 190; x++) set(x, 9, 40, 40, 40, 128) // antialiased rim
  await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(framePath)
})

test('measureFrame finds the screen hole', async () => {
  const m = await measureFrame(framePath)
  assert.equal(m.w, 200)
  assert.equal(m.h, 400)
  assert.deepEqual(m.hole, { x: 30, y: 30, w: 140, h: 340 })
})

test('measureFrame rejects a frame with no cutout', async () => {
  const solid = join(dir, 'solid.png')
  await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png().toFile(solid)
  await assert.rejects(() => measureFrame(solid), /no transparent screen cutout/)
})

test('bakeStill fills the hole and repairs the exterior', async () => {
  const shot = join(dir, 'shot.png')
  await sharp({ create: { width: 140, height: 340, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png().toFile(shot)

  const m = await measureFrame(framePath)
  const [out] = await bakeStill(shot, { file: framePath, ...m }, join(dir, 'baked'))
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => {
    const o = (y * info.width + x) * 4
    return [data[o], data[o + 1], data[o + 2], data[o + 3]]
  }
  assert.deepEqual(at(100, 200), [255, 0, 0, 255], 'screen center shows the capture')
  assert.deepEqual(at(15, 200), [40, 40, 40, 255], 'bezel stays bezel')
  assert.deepEqual(at(2, 2), [0, 0, 0, 0], 'outside the device stays fully transparent')
  assert.deepEqual(at(15, 9), [40, 40, 40, 128], 'antialiased rim keeps the frame\'s own alpha')
})

test('pickFrame prefers an exact device-resolution match', () => {
  const frames = [
    { name: 'iPhone 17 Pro - Portrait', file: 'a.png', w: 900, h: 1840, hole: { x: 48, y: 46, w: 804, h: 1748 } },
    { name: 'iPad Pro M5', file: 'b.png', w: 2000, h: 2600, hole: { x: 50, y: 50, w: 1900, h: 2500 } },
  ]
  const { frame, reason } = pickFrame({ w: 1206, h: 2622 }, frames)
  assert.equal(frame.name, 'iPhone 17 Pro - Portrait')
  assert.match(reason, /1206x2622/)
})

test('pickFrame falls back to aspect and rejects hopeless fits', () => {
  const frames = [
    { name: 'Some Phone', file: 'a.png', w: 900, h: 1840, hole: { x: 48, y: 46, w: 804, h: 1748 } },
  ]
  const ok = pickFrame({ w: 1000, h: 2174 }, frames) // same ~2.174 aspect as the hole
  assert.equal(ok.frame.name, 'Some Phone')
  assert.throws(() => pickFrame({ w: 1000, h: 1333 }, frames), /no frame fits/)
})
