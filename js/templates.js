// 出片模板: ready-made poses for 照着拍. Each template is a rigged pose (rig.js), where the
// person sits in the frame, how the phone should be held, what to tell the subject, and the
// color look that goes with it. Poses are built from parameters, not copied from photos.

import { rig, placePose } from './rig.js';

export const GROUPS = [
  { key: 'others', name: '给别人拍' },
  { key: 'selfie', name: '自拍' },
];

// Camera angle (elevation, degrees: + = pointing up) each kind of shot wants.
const CAM = {
  low: { elev: [2, 16], tip: '低机位显腿长：手机放到TA腰的高度，镜头微微往上仰' },
  lowSquat: { elev: [0, 14], tip: '你也蹲下来，手机放低，镜头微微往上' },
  eye: { elev: [-6, 6], tip: '平拍：手机和TA胸口差不多高，端平' },
  sit: { elev: [-6, 8], tip: '蹲下来拍：手机和TA胸口一样高' },
  high: { elev: [-14, 0], tip: '手机比TA眼睛略高一点，平拍或稍微往下' },
  selfieHigh: { elev: [-35, -12], tip: '手机举到额头上方，往下拍' },
  selfieEye: { elev: [-10, 8], tip: '手机和眼睛差不多高' },
};

// The arm holding the phone, reaching toward the lens and mostly out of frame:
// raised for a shot from above, low toward the bottom corner at eye level.
const PHONE_ARM = { up: -150, kUp: 0.5, lo: -170, kLo: 0.4 };
const PHONE_ARM_LOW = { up: -40, kUp: 0.55, lo: -30, kLo: 0.5 };

export const TEMPLATES = [
  {
    id: 'giraffe', group: 'others', name: '小长颈鹿站姿', shot: '全身', look: 'cream', camera: CAM.low,
    steps: ['让TA重心放在后脚，前脚脚尖点地', '前腿膝盖往里收一点', '一只手叉腰，手肘往外'],
    pose: {
      turn: 0.6, lean: 3, hipTilt: 4, head: { tilt: 6, yaw: 0.25, down: 5 },
      arms: { left: { up: 35, lo: -60 }, right: { up: -8, lo: -2 } },
      legs: { left: { up: -12, lo: 14, toe: 0 }, right: { up: 4, lo: -2 } },
    },
    frame: { cx: 0.62, s: 0.8, fb: 0.955 },
  },
  {
    id: 'walk', group: 'others', name: '走路抓拍', shot: '全身', look: 'film', camera: CAM.low,
    steps: ['让TA斜着朝你走过来，步子放小', '手自然摆，眼睛看前方别看镜头', '多按几次快门，挑最好的一张'],
    pose: {
      turn: 0.55, lean: 2, head: { yaw: 0.2 },
      arms: { left: { up: -14, lo: -20 }, right: { up: 16, lo: 30 } },
      legs: { left: { up: 14, lo: 6, toe: 0.04 }, right: { up: -12, lo: -22, toe: -0.01 } },
    },
    frame: { cx: 0.38, s: 0.78, fb: 0.955 },
  },
  {
    id: 'pocket', group: 'others', name: '侧身插兜', shot: '全身', look: 'japan', camera: CAM.eye,
    steps: ['让TA双手插兜，肩膀放松', '身体侧一点，脸转回来看镜头', '一条腿微微弯曲'],
    pose: {
      turn: 0.5, lean: -3, head: { tilt: -4, yaw: 0.3, down: 3 },
      arms: { left: { up: 18, lo: -18 }, right: { up: -18, lo: 18 } },
      legs: { left: { up: 3, lo: 0 }, right: { up: 8, lo: -6 } },
    },
    frame: { cx: 0.36, s: 0.8, fb: 0.955 },
  },
  {
    id: 'wall', group: 'others', name: '靠墙抬脚', shot: '全身', look: 'moody', camera: CAM.low,
    steps: ['让TA背靠墙，肩膀轻轻贴上去', '一只脚抬起来踩在墙上', '头微微歪向墙那边'],
    pose: {
      turn: 0.45, lean: -6, head: { tilt: -8, yaw: 0.15 },
      arms: { left: { up: 6, lo: 4 }, right: { up: -10, lo: -4 } },
      legs: { left: { up: 2, lo: 0 }, right: { up: -30, kUp: 0.85, lo: 40, toe: 0.01 } },
    },
    frame: { cx: 0.6, s: 0.8, fb: 0.955 },
  },
  {
    id: 'steps', group: 'others', name: '坐台阶', shot: '全身', look: 'japan', camera: CAM.sit, prop: 'seat',
    steps: ['让TA坐在台阶边上，膝盖并拢', '双手搭在膝盖上，身体微微前倾', '下巴稍微收一点'],
    pose: {
      turn: 0.85, head: { tilt: 5, yaw: 0.1, down: 5 },
      arms: { left: { up: 20, lo: -10 }, right: { up: -20, lo: 10 } },
      legs: { left: { up: 12, kUp: 0.38, lo: -4 }, right: { up: -14, kUp: 0.38, lo: 6 } },
    },
    frame: { cx: 0.5, s: 0.95, fb: 0.9 },
  },
  {
    id: 'squat', group: 'others', name: '蹲姿', shot: '全身', look: 'film', camera: CAM.lowSquat,
    steps: ['让TA双脚分开蹲下，膝盖朝外', '手肘搭在膝盖上，手自然垂下', '抬头看镜头，或者低头看地面'],
    pose: {
      turn: 0.75, head: { yaw: 0.1, down: 4 },
      arms: { left: { up: 25, lo: 20 }, right: { up: -25, lo: -20 } },
      legs: { left: { up: 100, kUp: 0.6, lo: -10 }, right: { up: -100, kUp: 0.6, lo: 10 } },
    },
    frame: { cx: 0.5, s: 1.0, fb: 0.88 },
  },
  {
    id: 'hair', group: 'others', name: '撩头发', shot: '半身', look: 'cream', camera: CAM.high,
    steps: ['让TA一只手轻轻把头发撩到耳后', '头往撩头发那边歪一点', '眼睛看镜头，轻轻笑'],
    pose: {
      turn: 0.7, head: { tilt: 8, yaw: 0.25, down: 4 },
      arms: { left: { up: 135, lo: -100 }, right: { up: -6, lo: 6 } },
    },
    frame: { cx: 0.44, s: 1.85, fb: 1.94 },
  },
  {
    id: 'chin', group: 'others', name: '桌边托腮', shot: '半身', look: 'moody', camera: CAM.eye, prop: 'table',
    steps: ['让TA手肘撑在桌上，手背轻托下巴', '头往手那边歪一点', '眼神看窗外，或者看镜头'],
    pose: {
      turn: 0.75, lean: 6, head: { tilt: 10, yaw: 0.2, down: 3 },
      arms: { left: { up: 15, kUp: 0.5, lo: -170 }, right: { up: -10, kUp: 0.6, lo: 70, kLo: 0.9 } },
    },
    frame: { cx: 0.5, s: 1.85, fb: 1.94 },
  },
  {
    id: 'selfie-high', group: 'selfie', name: '45° 俯拍比耶', shot: '半身', look: 'cream', camera: CAM.selfieHigh,
    steps: ['手机举高到额头上方，往下拍', '脸转 45°，下巴微收', '另一只手在脸旁边比个耶'],
    pose: {
      turn: 0.8, head: { tilt: -8, yaw: 0.3, down: -8 },
      arms: { left: { up: 68, kUp: 0.46, lo: -152 }, right: PHONE_ARM }, // V sign beside the cheek
    },
    frame: { cx: 0.5, s: 2.1, fb: 2.2 },
  },
  {
    id: 'selfie-chin', group: 'selfie', name: '托腮歪头', shot: '近景', look: 'japan', camera: CAM.selfieEye,
    steps: ['手背轻轻托住下巴', '头往手那边歪一点', '眼睛看镜头，嘴角放松'],
    pose: {
      turn: 0.85, head: { tilt: 12, yaw: -0.15, down: 3 },
      arms: { left: { up: 10, kUp: 0.5, lo: -172 }, right: PHONE_ARM_LOW },
    },
    frame: { cx: 0.5, s: 2.2, fb: 2.28 },
  },
  {
    id: 'selfie-side', group: 'selfie', name: '侧脸看窗外', shot: '近景', look: 'film', camera: CAM.selfieEye,
    steps: ['身体侧对窗户，脸转向窗外', '眼睛看远处，不看镜头', '让窗户的光照在脸上'],
    pose: {
      turn: 0.5, head: { yaw: -0.7, down: 2 },
      arms: { left: { up: 6, lo: 4 }, right: PHONE_ARM_LOW },
    },
    frame: { cx: 0.58, s: 2.1, fb: 2.2 },
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

// The template's target landmarks in the frame, ready to use as a 照着拍 reference.
export function templatePose(t, aspect) {
  return placePose(rig(t.pose), t.frame, aspect);
}

// Is the phone tilted the way this template wants? elev: back-camera elevation in degrees
// (scene.js cameraElevation). The front camera faces the other way, so a selfie flips the sign.
export function cameraHint(t, elev, selfie = false) {
  if (elev == null || !t || !t.camera) return null;
  const e = selfie ? -elev : elev;
  const [lo, hi] = t.camera.elev;
  if (e >= lo && e <= hi) return null;
  const pointsTooLow = e < lo;
  const text = selfie
    ? (pointsTooLow ? '手机放低一点' : '手机举高一点')
    : (pointsTooLow ? '镜头往上仰一点' : '镜头往下一点');
  return { id: 't-cam', level: 'warn', order: 1, text, why: t.camera.tip };
}
