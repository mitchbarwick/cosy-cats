// Clip definitions shared by the 2D placeholder maker (maker.js) and the Blender exporter
// (tools/blender/export-poses.mjs). Each clip samples the procedural rig's poses over time, so
// every renderer gets the same timing, anchor and scale. No DOM use: this also runs in Node.
import { POSE_FLAT, unflat } from '../../js/catArt.js';
import { clamp, easeInOut as ease } from '../../js/util.js';
export const FRAME = [512, 448];
export const ANCHOR = [256, 416];
export const PPU = 1.5;          // pixels per rig unit for a size-1.0 cat; the game applies each cat's size
export const FPS = 24;
export const STRIDE = 8.9 * Math.PI * 2; // rig units travelled per walk cycle (matches cats.js walkPhase)

const TAU = Math.PI * 2;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const pose = (name) => POSE_FLAT[name];
const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI)); // 0→1→0 over [a, b]

function breathe(p, b) {
  p.body[3] *= 1 + b; p.haunch[3] *= 1 + b * 0.6; p.chest[3] *= 1 + b; p.head[1] -= b * 22;
}
function sway(p, a, b, amt) {
  p.tail[4] += a * 18 * amt; p.tail[5] += a * 8 * amt; p.tail[6] += a * 26 * amt; p.tail[7] += b * 4 * amt;
}
function walkLegs(p, ph, amt) {
  const offs = [Math.PI, 0, 0, Math.PI];
  p.legs.forEach((l, i) => {
    const a = ph + offs[i];
    l[2] += Math.sin(a) * 14 * amt;
    l[3] -= Math.max(0, Math.cos(a)) * 9 * amt;
  });
  p.haunch[1] -= Math.abs(Math.sin(ph) * 2.2 * amt);
  p.chest[1] -= Math.abs(Math.cos(ph)) * 2.2 * amt;
  p.body[1] -= Math.abs(Math.sin(ph * 2)) * 1.2 * amt;
  p.head[1] += Math.sin(ph * 2 - 0.6) * 1.6 * amt;
}

// Each clip: frames, loop?, and frame(u) → { p, turn, yaw, blink, lookX, earFlick, alert }.
// Loops sample u in [0, 1) so frame N would equal frame 0; one-shots sample [0, 1].
export const CLIPS = {
  walk: { frames: 24, loop: true, frame(u) {
    const p = unflat(pose('walk'));
    walkLegs(p, u * TAU, 1);
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU * 2), 0.35);
    return { p };
  } },
  stand: { frames: 72, loop: true, frame(u) {
    const p = unflat(pose('stand'));
    breathe(p, Math.sin(u * TAU) * 0.02);
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU * 2), 0.6);
    return { p, blink: 1 - bump(u, 0.45, 0.52) };
  } },
  sniff: { frames: 36, loop: true, frame(u) {
    const p = unflat(pose('sniff'));
    p.head[1] += Math.sin(u * TAU * 3) * 1.2;
    p.head[0] += Math.sin(u * TAU) * 3;
    breathe(p, Math.sin(u * TAU) * 0.02);
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU * 2), 0.35);
    return { p };
  } },
  sit: { frames: 96, loop: true, frame(u) {
    const p = unflat(pose('sit'));
    breathe(p, Math.sin(u * TAU) * 0.02);
    p.head[3] += Math.sin(u * TAU) * 0.06;
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU * 2), 1);
    return { p, lookX: Math.sin(u * TAU) * 0.35, blink: 1 - bump(u, 0.7, 0.77) };
  } },
  groom: { frames: 48, loop: true, frame(u) {
    const p = unflat(pose('groom'));
    const g = Math.sin(u * TAU * 2);
    p.legs[2][3] += g * 6; p.head[3] += g * 0.05;
    breathe(p, Math.sin(u * TAU) * 0.02);
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU * 2), 1);
    return { p };
  } },
  loaf: { frames: 96, loop: true, frame(u) {
    const p = unflat(pose('loaf'));
    breathe(p, Math.sin(u * TAU) * 0.02);
    p.tail[6] += bump(u, 0.2, 0.32) * 10; // tail-tip twitch
    return { p, blink: 1 - bump(u, 0.55, 0.72) * 0.95 };
  } },
  sleepLoop: { frames: 144, loop: true, frame(u) {
    const p = unflat(pose('sleep'));
    breathe(p, Math.sin(u * TAU * 2) * 0.03);
    sway(p, Math.sin(u * TAU) * 0.5, Math.sin(u * TAU), 0.35);
    return { p, earFlick: u > 0.4 && u < 0.5 ? (u - 0.4) / 0.1 : 0 };
  } },
  knead: { frames: 32, loop: true, frame(u) {
    const p = unflat(pose('knead'));
    const k = u * TAU;
    p.legs[0][3] -= Math.max(0, Math.sin(k)) * 7;
    p.legs[2][3] -= Math.max(0, Math.sin(k + Math.PI)) * 7;
    p.body[1] += Math.sin(k * 2) * 0.8;
    return { p };
  } },
  nuzzle: { frames: 48, loop: true, frame(u) {
    const p = unflat(pose('nuzzle'));
    p.head[0] += Math.sin(u * TAU) * 2; p.head[3] += Math.sin(u * TAU) * 0.04;
    breathe(p, Math.sin(u * TAU) * 0.02);
    return { p };
  } },
  // 180° on the spot, passing through face-on; mirrored by the game when turning the other way
  turn: { frames: 15, frame(u) {
    const p = unflat(pose('stand'));
    walkLegs(p, u * TAU, 0.5 * Math.sin(u * Math.PI));
    return { p, turn: Math.cos(u * Math.PI), yaw: -u * Math.PI };
  } },
  circle: { frames: 60, frame(u) {
    const p = unflat(pose('stand'));
    walkLegs(p, u * TAU * 2, 0.6 * Math.sin(u * Math.PI));
    return { p, turn: Math.cos(u * TAU), yaw: -u * TAU };
  } },
  settle: { frames: 36, frame(u) {
    const p = unflat(mix(pose('knead'), pose('loaf'), ease(u)));
    p.legs[0][3] -= Math.max(0, Math.sin(u * TAU)) * 7 * (1 - u);
    return { p };
  } },
  wake: { frames: 48, frame(u) {
    const p = unflat(mix(pose('sleep'), pose('wake'), ease(clamp(u / 0.8, 0, 1))));
    return { p, earFlick: u > 0.75 && u < 0.95 ? (u - 0.75) / 0.2 : 0 };
  } },
  yawn: { frames: 40, frame(u) {
    const w = Math.sin(clamp((u - 0.05) / 0.85, 0, 1) * Math.PI);
    return { p: unflat(mix(pose('sit'), pose('yawn'), w)) };
  } },
  alert: { frames: 20, frame(u) {
    const p = unflat(mix(pose('sit'), pose('alert'), ease(clamp(u / 0.6, 0, 1))));
    return { p, earFlick: u < 0.45 ? u / 0.45 : 0, alert: ease(u) };
  } },
  stretch: { frames: 46, frame(u) {
    const w = u < 0.3 ? ease(u / 0.3) : u > 0.7 ? ease((1 - u) / 0.3) : 1;
    const p = unflat(mix(pose('stand'), pose('stretch'), w));
    p.haunch[1] -= Math.sin(u * TAU * 2) * 1.5 * w;
    return { p };
  } },
  crouch: { frames: 17, frame(u) {
    const p = unflat(mix(pose('stand'), pose('crouch'), ease(clamp(u / 0.5, 0, 1))));
    if (u > 0.5) p.haunch[0] += Math.sin((u - 0.5) * 2 * TAU * 2) * 3; // bottom wiggle
    return { p };
  } },
  jump: { frames: 15, frame(u) {
    const a = pose('crouch'), b = pose('jump');
    const f = u < 0.25 ? mix(a, b, ease(u / 0.25)) : u > 0.72 ? mix(b, a, ease((u - 0.72) / 0.28)) : b;
    return { p: unflat(f) };
  } },
  land: { frames: 9, frame(u) {
    const p = unflat(mix(pose('crouch'), pose('stand'), ease(u)));
    p.body[3] *= 1 - 0.08 * (1 - u); p.haunch[3] *= 1 - 0.06 * (1 - u);
    return { p };
  } },
  bat: { frames: 12, frame(u) {
    const p = unflat(mix(pose('sit'), pose('bat'), ease(clamp(u / 0.4, 0, 1))));
    p.legs[2][2] += Math.sin(u * TAU) * 6; p.legs[2][3] += (Math.cos(u * TAU) - 1) * 5;
    return { p };
  } },
};
