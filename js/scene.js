// 分场景: which kind of scene is in front of the camera (from the image classifier,
// the light and the phone's angle), and what to tell the photographer for it.
// Pure functions, so they run in tests.

export const SCENE_NAME = {
  person: '人像', food: '美食', pet: '宠物', city: '城市', night: '夜景', sunset: '日落', landscape: '风景', still: '景物',
};
export const PICKABLE = ['auto', 'person', 'food', 'pet', 'city', 'night', 'sunset', 'landscape'];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ImageNet class indices, as in the classifier's label file (0-based).
const PET = [...range(151, 268), ...range(281, 285), 330, 331, 332, 333, 338]; // dogs, cats, rabbits, hamster, guinea pig
const FOOD = [
  ...range(923, 957), ...range(959, 969), // plate, dishes, vegetables, fruit, drinks (958 is hay)
  415, 467, 504, 509, 521, 532, 544, 550, 567, 582, 618, 659, 762, 766, 809, 813, 849, 868, 907, 909, 910, 987,
];
const CITY = [
  412, 424, 425, 437, 442, 444, 449, 454, 466, 468, 480, 483, 489, 497, 498, 511, 517, 538, 547, 555, 557, 562, 569,
  571, 580, 609, 612, 624, 627, 637, 640, 654, 656, 663, 665, 668, 670, 671, 675, 682, 698, 703, 704, 705, 706, 707,
  717, 718, 727, 733, 734, 743, 779, 788, 799, 817, 821, 825, 829, 832, 839, 853, 858, 860, 865, 873, 874, 877, 884,
  888, 900, 919, 920,
];

export const GROUP_OF = (() => {
  const m = new Map();
  for (const i of PET) m.set(i, 'pet');
  for (const i of FOOD) m.set(i, 'food');
  for (const i of CITY) m.set(i, 'city');
  return m;
})();

// categories: [{index, score}] from the classifier → summed score per group.
export function groupScores(categories) {
  const out = { food: 0, pet: 0, city: 0 };
  for (const c of categories || []) {
    const g = GROUP_OF.get(c.index);
    if (g) out[g] += c.score;
  }
  return out;
}

export function freshScene() {
  return { groups: { food: 0, pet: 0, city: 0 }, kind: null, cand: null, candAt: 0, lowLight: false, sunset: false };
}

// Smooth the group scores over successive classifications (about one per second).
export function addClassification(s, categories, k = 0.5) {
  const g = groupScores(categories);
  for (const key of Object.keys(s.groups)) s.groups[key] += (g[key] - s.groups[key]) * k;
}

// A warm, bright sky over a darker ground. light.top is the mean [r, g, b] (0..1) of the
// top of the frame, light.bottom the mean brightness of the bottom part.
export function isSunsetSky(light, already = false) {
  if (!light || !light.top) return false;
  const [r, g, b] = light.top;
  const tl = 0.299 * r + 0.587 * g + 0.114 * b;
  const warm = already ? 1.2 : 1.3;
  return tl > (already ? 0.25 : 0.3) && r > b * warm && r >= g * 0.98 && tl > (light.bottom ?? 1) + 0.08;
}

const ENTER = 0.3;
const STAY = 0.18;

function pickKind(s) {
  const holds = (k) => s.groups[k] > (s.kind === k ? STAY : ENTER);
  for (const k of ['pet', 'food', 'city']) if (holds(k)) return k;
  if (s.sunset) return 'sunset';
  if (s.lowLight) return 'night';
  return null;
}

// Updates the light flags and the current scene kind. A new kind must hold for `hold` ms
// before it shows, so the badge and hints don't flicker. warmHorizon: findHorizon() saw an
// orange sky over darker ground; required to enter sunset, so a warm-lit room doesn't count.
export function stepScene(s, light, now, hold = 1000, warmHorizon = false) {
  if (light) {
    s.lowLight = s.lowLight ? light.mean < 0.24 : light.mean < 0.18;
    s.sunset = isSunsetSky(light, s.sunset) && (s.sunset || warmHorizon);
  }
  const cand = pickKind(s);
  if (cand === s.kind) { s.cand = cand; return s.kind; }
  if (cand !== s.cand) { s.cand = cand; s.candAt = now; }
  if (now - s.candAt >= hold) s.kind = cand;
  return s.kind;
}

// Camera elevation in degrees from DeviceOrientation beta: 0 = level, -90 = pointing straight
// down (phone flat, screen up), positive = pointing up. Null when the phone is held sideways.
export function cameraElevation(beta, sideways = false) {
  if (beta == null || sideways) return null;
  return Math.max(-90, Math.min(90, beta - 90));
}

// How far a phone lying flat (shooting straight down) is from level, in degrees.
export const flatDeviation = (beta, gamma) => (beta == null || gamma == null ? null : Math.max(Math.abs(beta), Math.abs(gamma)));

export const SHAKE_LIMIT = 12; // deg/s of rotation; above this a dim shot blurs

// Scene-specific advice. ctx: {elev, flatDev, shake, lowLight}.
export function sceneRules(scene, ctx, out) {
  const { elev = null, flatDev = null, shake = null, lowLight = false } = ctx || {};
  if (scene === 'food') {
    if (elev == null) {
      out.push({ id: 'food-angle', level: 'tip', order: 9, text: '从斜上方或正上方拍', why: '美食别平着拍' });
    } else if (elev > -15) {
      out.push({ id: 'food-angle', level: 'warn', order: 1, text: '手机往下压，从斜上方拍', why: '平着拍，盘子显得扁' });
    } else if (elev < -70 && flatDev != null && flatDev > 6) {
      out.push({ id: 'food-flat', level: 'warn', order: 1, text: '手机端平', why: '正上方俯拍要拍平，盘子才是圆的' });
    }
  } else if (scene === 'pet') {
    if (elev != null && elev < -30) {
      out.push({ id: 'pet-low', level: 'warn', order: 1, text: '蹲下来，和它眼睛一样高', why: '平视拍宠物更有神' });
    }
    out.push({ id: 'pet-look', level: 'tip', order: 11, text: '拿零食逗它看镜头', why: '眼神看镜头更出片' });
  } else if (scene === 'city') {
    if (elev != null && elev > 8) {
      out.push({ id: 'city-tilt', level: 'warn', order: 1, text: '手机竖直，别仰着拍', why: '仰拍楼会往后倒，拍后只能校正一点' });
    } else if (elev != null && elev < -8) {
      out.push({ id: 'city-tilt', level: 'warn', order: 1, text: '手机别往下压', why: '往下拍，楼的竖线会歪' });
    }
  }
  if (scene === 'night' || lowLight) {
    if (shake != null && shake > SHAKE_LIMIT) {
      out.push({
        id: 'steady', level: 'warn', order: scene === 'night' ? 1 : 6,
        text: '拿稳，手肘贴住身体或靠在东西上', why: '光线暗，一抖就糊', voice: '拿稳手机',
      });
    } else if (shake == null && scene === 'night') {
      out.push({ id: 'steady', level: 'tip', order: 9, text: '拿稳手机，按完快门别马上动', why: '光线暗，一抖就糊' });
    }
  }
}
