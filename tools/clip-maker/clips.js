// Clip definitions shared by the 2D placeholder maker (maker.js) and the Blender exporter
// (tools/blender/export-poses.mjs). Each clip samples the procedural rig's poses over time, so
// every renderer gets the same timing, anchor and scale. No DOM use: this also runs in Node.
import { POSE_FLAT, DOG_POSE_FLAT, unflat, wagTail } from '../../js/catArt.js';
import { clamp, easeInOut as ease } from '../../js/util.js';
export const FRAME = [512, 448];
export const ANCHOR = [256, 416];
export const PPU = 1.5;          // pixels per rig unit for a size-1.0 cat; the game applies each cat's size
export const FPS = 24;
export const STRIDE = 8.9 * Math.PI * 2; // rig units travelled per walk cycle (matches cats.js walkPhase)
export const DOG_STRIDE = 6.4 * Math.PI * 2; // Toby's shorter stride (cats.js DOG_STEP)

const TAU = Math.PI * 2;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
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
// Built from a pose table, so the cats' clips and Toby's shared ones come from the same code.
const build = (POSES, pose = (name) => POSES[name]) => ({
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
  // Paused by the teacher: sit up tall and turn to face the room (played backwards to turn away)
  attend: { frames: 20, frame(u) {
    const e = ease(u);
    const p = unflat(mix(pose('sit'), pose('attend'), e));
    return { p, turn: 1 - e, yaw: -e * Math.PI / 2, earFlick: u < 0.4 ? u / 0.4 : 0, alert: e };
  } },
  attendLoop: { frames: 72, loop: true, frame(u) {
    const p = unflat(pose('attend'));
    breathe(p, Math.sin(u * TAU) * 0.02);
    p.head[3] += Math.sin(u * TAU) * 0.05; // a slow, curious head tilt
    return { p, turn: 0, yaw: -Math.PI / 2, alert: 1, blink: 1 - bump(u, 0.62, 0.69), lookX: Math.sin(u * TAU) * 0.08 };
  } },
  bat: { frames: 12, frame(u) {
    const p = unflat(mix(pose('sit'), pose('bat'), ease(clamp(u / 0.4, 0, 1))));
    p.legs[2][2] += Math.sin(u * TAU) * 6; p.legs[2][3] += (Math.cos(u * TAU) - 1) * 5;
    return { p };
  } },
});

export const CLIPS = build(POSE_FLAT);

// Toby's set: the shared clips posed like a French bulldog, minus the cat-only ones (kneading,
// grooming, batting yarn, jumping), plus his own trot, sniffing walk, frog-splat flop, sleeping
// on his back, head tilt, ear scratch, shake-off, sneeze, whole-body wag and play bow. The
// motions match the live rig's (cats.js dogMotion).
function dogTrot(p, ph, amt) {
  const offs = [Math.PI, 0, 0, Math.PI];
  p.legs.forEach((l, i) => {
    const a = ph + offs[i];
    l[2] += Math.sin(a) * 10 * amt;
    l[3] -= Math.max(0, Math.cos(a)) * 7 * amt;
  });
  p.haunch[1] -= Math.abs(Math.sin(ph) * 2.2 * amt);
  p.chest[1] -= Math.abs(Math.cos(ph)) * 2.2 * amt;
  p.body[1] -= Math.abs(Math.sin(ph * 2)) * 1.2 * amt;
  p.head[1] += Math.sin(ph * 2 - 0.6) * 1.6 * amt;
  // bouncy, with a rolling waddle through the hips
  const b = Math.abs(Math.sin(ph)) * 2.6 * amt;
  p.body[1] -= b; p.chest[1] -= b; p.haunch[1] -= b * 0.8; p.head[1] -= b * 0.9;
  p.haunch[0] += Math.sin(ph) * 2.5 * amt; p.body[4] += Math.sin(ph) * 0.04 * amt;
  p.head[3] += Math.sin(ph) * 0.05 * amt;
}

function buildDog() {
  const base = build(DOG_POSE_FLAT);
  for (const c of ['knead', 'groom', 'bat', 'settle', 'crouch', 'jump', 'land']) delete base[c];
  const pose = (name) => DOG_POSE_FLAT[name];
  return {
    ...base,
    walk: { frames: 24, loop: true, stride: DOG_STRIDE, frame(u) {
      const p = unflat(pose('walk'));
      dogTrot(p, u * TAU, 1);
      return { p: wagTail(p, Math.sin(u * TAU * 2) * 0.5) };
    } },
    // nose to the floor, following a smell; same stride as the walk so it plays at ground speed
    sniffWalk: { frames: 24, loop: true, stride: DOG_STRIDE, frame(u) {
      const p = unflat(pose('sniffWalk'));
      dogTrot(p, u * TAU, 0.8);
      p.head[1] += Math.sin(u * TAU * 6) * 1.4; p.head[0] += Math.sin(u * TAU) * 2;
      return { p: wagTail(p, Math.sin(u * TAU * 2) * 0.4) };
    } },
    stand: { frames: 72, loop: true, frame(u) {
      const p = unflat(pose('stand'));
      breathe(p, Math.sin(u * TAU) * 0.02);
      return { p: wagTail(p, Math.sin(u * TAU * 6) * 0.25), blink: 1 - bump(u, 0.45, 0.52) };
    } },
    sniff: { frames: 36, loop: true, frame(u) {
      const p = unflat(pose('sniff'));
      p.head[1] += Math.sin(u * TAU * 3) * 1.2; p.head[0] += Math.sin(u * TAU) * 3;
      breathe(p, Math.sin(u * TAU) * 0.02);
      return { p: wagTail(p, Math.sin(u * TAU * 4) * 0.3) };
    } },
    sit: { frames: 96, loop: true, frame(u) {
      const p = unflat(pose('sit'));
      breathe(p, Math.sin(u * TAU) * 0.02);
      p.head[3] += Math.sin(u * TAU) * 0.06;
      return { p: wagTail(p, Math.sin(u * TAU * 8) * 0.2), lookX: Math.sin(u * TAU) * 0.35, blink: 1 - bump(u, 0.7, 0.77) };
    } },
    // the frog splat; its slow blink sits where clipCat's DOZE_OFF expects a loaf's
    loaf: { frames: 96, loop: true, frame(u) {
      const p = unflat(pose('loaf'));
      breathe(p, Math.sin(u * TAU) * 0.025);
      p.legs[3][2] -= bump(u, 0.2, 0.32) * 5; // a back foot twitches
      return { p, blink: 1 - bump(u, 0.55, 0.72) * 0.95 };
    } },
    // on his back, paws up: deep slow breaths, and a dream that sets the paws paddling
    sleepLoop: { frames: 144, loop: true, frame(u) {
      const p = unflat(pose('sleep'));
      breathe(p, Math.sin(u * TAU * 2) * 0.035);
      const dream = bump(u, 0.62, 0.82);
      for (const i of [0, 2]) p.legs[i][3] += Math.sin(u * TAU * 22 + i) * 3 * dream;
      return { p, earFlick: u > 0.4 && u < 0.5 ? (u - 0.4) / 0.1 : 0 };
    } },
    nuzzle: { frames: 48, loop: true, frame(u) {
      const p = unflat(pose('nuzzle'));
      p.head[0] += Math.sin(u * TAU) * 2; p.head[3] += Math.sin(u * TAU) * 0.04;
      breathe(p, Math.sin(u * TAU) * 0.02);
      return { p: wagTail(p, Math.sin(u * TAU * 6) * 0.6) };
    } },
    turn: { frames: 15, frame(u) {
      const p = unflat(pose('stand'));
      dogTrot(p, u * TAU, 0.5 * Math.sin(u * Math.PI));
      return { p, turn: Math.cos(u * Math.PI), yaw: -u * Math.PI };
    } },
    circle: { frames: 60, frame(u) {
      const p = unflat(pose('stand'));
      dogTrot(p, u * TAU * 2, 0.6 * Math.sin(u * Math.PI));
      return { p: wagTail(p, Math.sin(u * TAU * 6) * 0.4), turn: Math.cos(u * TAU), yaw: -u * TAU };
    } },
    // down from a last sniff into the frog splat, with a little squash as he lands
    flop: { frames: 18, frame(u) {
      const p = unflat(mix(pose('sniff'), pose('loaf'), ease(clamp(u / 0.7, 0, 1))));
      const sq = bump(u, 0.6, 1);
      p.body[3] *= 1 - 0.08 * sq; p.haunch[3] *= 1 - 0.06 * sq;
      return { p };
    } },
    // a dog's stretch is a play bow, bottom wiggling and tail going
    stretch: { frames: 46, frame(u) {
      const w = u < 0.3 ? ease(u / 0.3) : u > 0.75 ? ease((1 - u) / 0.25) : 1;
      const p = unflat(mix(pose('stand'), pose('bow'), w));
      p.haunch[1] -= Math.abs(Math.sin(u * TAU * 2)) * 3 * w; p.haunch[0] += Math.sin(u * TAU * 4) * 3 * w;
      return { p: wagTail(p, Math.sin(u * TAU * 7) * 0.75 * w) };
    } },
    bow: { frames: 24, loop: true, frame(u) {
      const p = unflat(pose('bow'));
      p.haunch[1] -= Math.abs(Math.sin(u * TAU)) * 3; p.haunch[0] += Math.sin(u * TAU * 3) * 3;
      return { p: wagTail(p, Math.sin(u * TAU * 4) * 0.75) };
    } },
    // the whole back end wags along with the tail
    wag: { frames: 24, loop: true, frame(u) {
      const p = unflat(pose('wag'));
      const w = Math.sin(u * TAU * 2);
      p.haunch[0] += w * 6; p.body[0] += w * 2; p.body[4] += w * 0.06; p.head[3] += Math.sin(u * TAU * 2 + 1) * 0.05;
      return { p: wagTail(p, Math.sin(u * TAU * 4) * 0.8) };
    } },
    // "hm?": head cocked, ears up
    tilt: { frames: 72, loop: true, frame(u) {
      const p = unflat(pose('tilt'));
      breathe(p, Math.sin(u * TAU) * 0.02);
      p.head[3] += Math.sin(u * TAU) * 0.06;
      return { p: wagTail(p, Math.sin(u * TAU * 5) * 0.15), alert: 1, blink: 1 - bump(u, 0.3, 0.37) };
    } },
    scratch: { frames: 16, loop: true, frame(u) {
      const p = unflat(pose('scratch'));
      const k = Math.sin(u * TAU * 3);
      p.legs[3][2] += k * 3; p.legs[3][3] += k * 6; p.head[3] += k * 0.03; p.body[1] += k * 0.6;
      return { p };
    } },
    shake: { frames: 30, frame(u) {
      const lt = u * 1.25, en = Math.sin(clamp(lt / 1.2, 0, 1) * Math.PI), w = lt * 34;
      const p = unflat(pose('shake'));
      p.head[3] += Math.sin(w) * 0.4 * en;
      p.chest[0] += Math.sin(w - 0.4) * 2 * en; p.body[0] += Math.sin(w - 0.8) * 3.5 * en;
      p.body[4] += Math.sin(w - 0.8) * 0.06 * en; p.haunch[0] += Math.sin(w - 1.6) * 2.5 * en;
      return { p: wagTail(p, Math.sin(w) * 0.6 * en), lookX: Math.sin(lt * 17) * 0.5 * en, earFlick: lt < 1.2 ? (lt * 4.5) % 1 : 0 };
    } },
    // "h... h..." head up, then the snap down, then back to sitting
    sneeze: { frames: 28, frame(u) {
      const lt = u * 1.17;
      const p = unflat(pose('sneeze'));
      const up = lt < 0.42 ? lt / 0.42 : 0, snap = lt >= 0.42 ? Math.exp(-(lt - 0.42) * 5) : 0;
      p.head[1] += -9 * up + 14 * snap; p.head[0] += 8 * snap;
      p.head[3] += -0.25 * up + 0.3 * snap;
      p.face[2] = Math.max(p.face[2], 0.35 * up);
      return { p, earFlick: lt > 0.42 && lt < 0.7 ? (lt - 0.42) / 0.28 : 0 };
    } },
    // paused: sitting tall facing the room, cocking his head one way, then the other
    attendLoop: { frames: 72, loop: true, frame(u) {
      const p = unflat(pose('attend'));
      breathe(p, Math.sin(u * TAU) * 0.02);
      p.head[3] = 0.04 + Math.sin(u * TAU) * 0.3;
      return { p: wagTail(p, Math.sin(u * TAU * 6) * 0.2), turn: 0, yaw: -Math.PI / 2, alert: 1,
        blink: 1 - bump(u, 0.62, 0.69), lookX: Math.sin(u * TAU) * 0.06 };
    } },
  };
}
export const DOG_CLIPS = buildDog();
export const clipsFor = (def) => (def.species === 'dog' ? DOG_CLIPS : CLIPS);
