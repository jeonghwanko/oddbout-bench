/**
 * 푸딩 탈출 변신 단계("뇌절" 자막 밈의 곰젤리판). 순수 데이터와 규칙이다(src/sim — 화면·저장을 만지지 않는다).
 * 단계마다 자막 세 줄(를 뛰어넘은 / 업적 / 전투력과 이름), 이름 색, 몸 팔레트를 가진다. 마지막 단계를 넘으면 "뇌절 곰젤리 N형태"가 끝없이 붙는다.
 */
export type Lang = 'ko' | 'en';
/**
 * 곰젤리 몸 팔레트(빛은 왼쪽 위). 그늘 쪽 테 o · 빛 쪽 테 O · 두꺼운 그늘 고리 c · 바탕 r · 속빛 g · 속빛 심 m · 빛 받는 겉면 h · 반사광 w ·
 * 눈 e · 팔(예비) u · 볼 k. 젤리는 빛 반대쪽 안에 속빛(g → m)이 고이고, 얇은 곳(귀 · 발끝 · 바닥)은 빛이 비쳐 밝다.
 */
export interface BodyPalette { o: string; O: string; c: string; r: string; g: string; h: string; m: string; w: string; e: string; u: string; k: string;
  /** 초사이언 머리칼: y 밝은 쪽, z 그늘, q 머리칼 테. */
  y: string; z: string; q: string;
  /** 눈동자(변신하면 청록). */
  i: string }

/* ---------- 색 계산(순수): 팔레트의 속빛 · 빛 쪽 테를 바탕 색에서 끌어낸다 ---------- */
/** HSL(색상 °, 채도 · 명도 0..1) → `#rrggbb`. */
export function hslHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const f = (n: number) => { const k = (n + hh / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const rgbOf = (hex: string): [number, number, number] => [0, 1, 2].map(i => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) as [number, number, number];
/** `#rrggbb` → HSL(색상 °, 채도 · 명도 0..1). */
export function hexHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map(v => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}
/** 두 색을 t(0 → a, 1 → b)로 섞는다. */
export function mixHex(a: string, b: string, t: number): string {
  const p = rgbOf(a), q = rgbOf(b);
  return '#' + [0, 1, 2].map(i => Math.round(p[i]! + (q[i]! - p[i]!) * t).toString(16).padStart(2, '0')).join('');
}
/** 속빛이 노랑(60°) 쪽으로 도는 각도와 밝아지는 명도(젤리 도트 조사: 15~20°, +8~10). */
export const GLOW_HUE_SHIFT = 18, GLOW_LIGHT = 0.09;
/**
 * 젤리 빛 두 색: 속빛 g 는 바탕 r 의 색상을 노랑 쪽(가까운 방향)으로 `GLOW_HUE_SHIFT`° 돌리고(노랑을 넘지 않는다) 명도를 `GLOW_LIGHT` 올린다.
 * 빛 쪽 테 O 는 그늘 쪽 테 o 와 그늘 고리 c 의 가운데다. 팔레트를 새로 만들 때 이 두 색을 잊지 않도록 `bodyPal` 이 기본값으로 쓴다.
 */
export function jellyLights(o: string, c: string, r: string): { g: string; O: string } {
  const [h, s, l] = hexHsl(r), toYellow = ((60 - h + 540) % 360) - 180;
  const turn = Math.sign(toYellow) * Math.min(GLOW_HUE_SHIFT, Math.abs(toYellow));
  return { g: hslHex(h + turn, s, Math.max(l, Math.min(0.94, l + GLOW_LIGHT))), O: mixHex(o, c, 0.5) };
}
export interface Form {
  /** 업적 줄(한 줄 또는 두 줄). */
  feat: { ko: string; en: string };
  name: { ko: string; en: string };
  /** 전투력. null 이면 자막에 전투력 줄을 쓰지 않는다. Infinity 는 ∞, NaN 은 측정 불가. */
  power: number | null;
  /** 자막 이름 색. */
  color: string;
  /** 몸 팔레트. 'rainbow' 는 시간에 따라 색이 돈다. */
  body: BodyPalette | 'rainbow';
  /** 1+1 듀오: 곰젤리가 둘이 된다. */
  duo?: boolean;
}

/** 초사이언 머리칼 크기: 0 없음, 1 짧은 스파이크, 2 크게 솟음, 3 아주 길게. */
export const hairAt = (n: number) => n <= 0 ? 0 : n <= 2 ? 1 : n <= 10 ? 2 : 3;

const GOLD_HAIR: [string, string, string] = ['#fff38a', '#ffc21f', '#7a4a00'];
/**
 * 몸 팔레트 하나: 테 o · 그늘 c · 몸 r · 빛 테 h · 속빛 심 m · 반사광 w · 눈 e · 팔 u · 볼 k, 머리칼(기본 금빛), 변신 눈동자,
 * 속빛 g · 빛 쪽 테 O(주지 않으면 `jellyLights` 로 끌어낸다).
 */
export const bodyPal = (o: string, c: string, r: string, h: string, m: string, w: string, e: string, u: string, k: string,
  hair: [string, string, string] = GOLD_HAIR, i = '#2fd8c8', lights: { g?: string; O?: string } = {}): BodyPalette => {
  const d = jellyLights(o, c, r);
  return { o, O: lights.O ?? d.O, c, r, g: lights.g ?? d.g, h, m, w, e, u, k, y: hair[0], z: hair[1], q: hair[2], i };
};
const pal = bodyPal;

// 젤리 도트 조사(2026-11-19)가 손으로 고른 넷: 빨강(기본) · 분홍(1형태) · 노랑(골드) · 파랑. 나머지는 g · O 를 규칙으로 끌어낸다
export const BASE_BODY = pal('#5a0a2a', '#b8173f', '#ec2f4b', '#ff94a6', '#ffa071', '#fff7ee', '#2a0610', '#ff6f82', '#ff5f8f', GOLD_HAIR, '#2fd8c8', { g: '#ff6248', O: '#a3153d' });
const PINK = pal('#4f0f45', '#c23a98', '#f46ccf', '#ffc2f0', '#ffc7c9', '#fff8fd', '#2a0620', '#ff9be3', '#ff4fae', GOLD_HAIR, '#2fd8c8', { g: '#ff8fc0', O: '#9c2a83' });
const PINK2 = pal('#5a0f3f', '#c2307f', '#ff58b8', '#ffb0e0', '#ffcdee', '#fff4fb', '#24041a', '#ff86cc', '#ff3f98');
const LILAC = pal('#3f2a6a', '#8a6fd0', '#b9a7ff', '#e4dcff', '#efe9ff', '#fbf9ff', '#1a1030', '#cbbcff', '#ff7ab8');
const FINAL = pal('#3a3f62', '#a3a9d8', '#e8ebff', '#fbfcff', '#f4f5ff', '#fdfdff', '#2a1a4a', '#d6d9f5', '#b58cff', ['#f4f6ff', '#b9c2e6', '#3a3f62']);
const GOLD = pal('#5a2a00', '#d98a12', '#ffc93a', '#fff0a0', '#fff2a8', '#fffdf0', '#3a2200', '#ffc23a', '#ff8a5a', GOLD_HAIR, '#2fd8c8', { g: '#ffe066', O: '#a8640a' });
const BLACK = pal('#0a0610', '#2a1a3a', '#4a2f66', '#8a5fc0', '#a77bdb', '#e9dbff', '#ff3f6a', '#5f3f85', '#c77dff', ['#e3c4ff', '#9a5fe0', '#1a0a2a']);
const CRIMSON = pal('#5a0010', '#b0001f', '#ff1f3f', '#ff8a96', '#ffb0b8', '#fff0f2', '#2a0006', '#ff4f63', '#ffb0c8', ['#ffb0a0', '#ff3f2f', '#4a0008']);
const BLUE = pal('#0c1f5c', '#2a63d8', '#4fa6ff', '#a8dcff', '#b8f6ff', '#f4fbff', '#ff2f4f', '#7fc6ff', '#ff8ab8', ['#c8f4ff', '#3fb8ff', '#0a2a6a'], '#2fd8c8', { g: '#5fd8ff', O: '#1f4fb0' });
const GREEN = pal('#0a4a1f', '#1fa33f', '#5fe05f', '#c0ffb0', '#dcffd2', '#f6fff2', '#3a0a4a', '#8af07a', '#ff8ab8', ['#d8ffb8', '#5fe03f', '#0a3a10']);
const PRINCESS = pal('#6a0f5a', '#e03fb8', '#ff7ae6', '#ffd0f6', '#ffe4fa', '#fff8fe', '#4a2a00', '#ffa6ee', '#ffd23f', ['#ffe0f8', '#ff6fd8', '#5a0a4a']);
const FOSSIL = pal('#3a2f22', '#7a6a55', '#a8967a', '#d6c8ad', '#e4d9c4', '#f5efe2', '#1f1a12', '#bfae90', '#c9a07a', ['#e8dcc0', '#b09a70', '#3a2f22']);

export const FORMS: readonly Form[] = [
  { feat: { ko: '숟가락 하나로 푸딩을 뒤집는', en: 'Flips a whole pudding with ONE spoon' }, name: { ko: '곰젤리 1형태', en: 'GUMMY FORM 1' }, power: 530_000, color: '#ff7ad9', body: PINK },
  { feat: { ko: '체리, 캐러멜, 생크림을 모두 후드려 팬', en: 'Beat up the cherry, the caramel AND the cream' }, name: { ko: '곰젤리 2형태', en: 'GUMMY FORM 2' }, power: 1_060_000, color: '#ff58b8', body: PINK2 },
  { feat: { ko: '귀가 길쭉해져버린', en: 'Its ears got weirdly long' }, name: { ko: '곰젤리 3형태', en: 'GUMMY FORM 3' }, power: 2_120_000, color: '#c9a7ff', body: LILAC },
  { feat: { ko: '전력을 다했지만 숟가락한테 뚜드려 맞은', en: 'Went all out and STILL got spanked by a spoon' }, name: { ko: '곰젤리 최종형태', en: 'FINAL GUMMY FORM' }, power: 120_000_000, color: '#b9a7ff', body: FINAL },
  { feat: { ko: '4달 동안 냉장고에서 숙성해\n8조 3천억 배 쫀득해진', en: 'Aged 4 months in the fridge,\n8.3 trillion times chewier' }, name: { ko: '골든 곰젤리', en: 'GOLDEN GUMMY' }, power: null, color: '#ffb84d', body: GOLD },
  { feat: { ko: '신의 숟가락을 한 방에 기절시킨', en: 'KO\'d the Spoon of the Gods in one hit' }, name: { ko: 'VVIP 블랙카드 곰젤리', en: 'VVIP BLACK CARD GUMMY' }, power: null, color: '#c77dff', body: BLACK },
  { feat: { ko: '빨간 색소로 염색한', en: 'Dyed itself with red food coloring' }, name: { ko: '진홍빛 딸기맛 곰젤리', en: 'CRIMSON STRAWBERRY GUMMY' }, power: null, color: '#ff4d5e', body: CRIMSON },
  { feat: { ko: '파란 색소로 염색한 펜티엄', en: 'Dyed blue, powered by a Pentium' }, name: { ko: '오스트랄로피테쿠스 블루베리 곰젤리', en: 'AUSTRALOPITHECUS BLUEBERRY GUMMY' }, power: null, color: '#5fb0ff', body: BLUE },
  { feat: { ko: '초록 색소로 염색한 초 울트라', en: 'Dyed green, super ultra' }, name: { ko: '셀레스트리얼 메론맛 곰젤리', en: 'CELESTIAL MELON GUMMY' }, power: null, color: '#5fe05f', body: GREEN },
  { feat: { ko: '핑크 색소로 염색한 슈퍼 초 빽킹', en: 'Dyed pink, super mega royal' }, name: { ko: '핑크공주 프린세스 곰젤리', en: 'PINK PRINCESS GUMMY' }, power: null, color: '#ff7ae6', body: PRINCESS },
  { feat: { ko: '정신줄 놓고 자빠진 얼티메이트 초승천 마제스티\n우윳빛깔 아니 무지개빛깔 프린시플', en: 'Totally lost it: ultimate ascended majesty,\nmilky-no-RAINBOW principal' },
    name: { ko: '레인보우 골드 로드 오브 더 유니버스 곰젤리', en: 'RAINBOW GOLD LORD OF THE UNIVERSE GUMMY' }, power: null, color: '#ffe14d', body: 'rainbow' },
  { feat: { ko: '편의점 1+1 행사로 둘이 되어버린', en: 'Became two in a buy-one-get-one sale' }, name: { ko: '곰젤리 듀오', en: 'GUMMY DUO' }, power: Infinity, color: '#ff9f43', body: 'rainbow', duo: true },
  { feat: { ko: '유통기한을 초월한', en: 'Transcended its expiry date' }, name: { ko: '화석 곰젤리', en: 'FOSSIL GUMMY' }, power: NaN, color: '#d6c8ad', body: FOSSIL, duo: true },
];

/** n 번째 변신(1부터). 목록을 넘으면 뇌절 곰젤리가 끝없이 이어진다. */
export function formAt(n: number): Form {
  const f = FORMS[n - 1];
  if (f) return f;
  const k = n - FORMS.length + 1;
  return { feat: { ko: '개발자도 여기까지 올 줄 몰랐던', en: 'Even the developer didn\'t expect you here' },
    name: { ko: `뇌절 곰젤리 ${k}형태`, en: `OVERKILL GUMMY FORM ${k}` }, power: NaN, color: '#7ad7ff', body: 'rainbow', duo: true };
}

/**
 * 변신 도감 칸 수: 이름 있는 형태(`FORMS`) 13개(2026-11-19 재제출 3단계). 끝없는 `OVERKILL GUMMY FORM n` 은 도감에 넣지 않는다.
 * 형태는 차례로만 오르므로 도감은 가장 높이 오른 형태 번호 하나(`top`)로 저장한다. `top` 이하는 다 본 형태다.
 */
export const DEX_SIZE = FORMS.length;
/** 이번 판 단계(`stage`)까지 본 뒤의 도감 최고 형태(0..DEX_SIZE). */
export const dexReach = (top: number, stage: number): number => Math.max(top, Math.min(DEX_SIZE, Math.max(0, Math.floor(stage))));
/** 저장 값을 도감 최고 형태로 읽는다. 정수가 아니거나 음수면 0, 칸 수를 넘으면 칸 수. */
export const readDexTop = (v: unknown): number => typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(DEX_SIZE, v) : 0;

/** 첫 변신(0 → 1단계)이 열리는 거리(m). 첫 판 1분 안에 변신을 보이려고 앞당겼다(2026-11-19 1단계). */
export const FIRST_UNLOCK_M = 100;
/**
 * n 번째 변신이 열리는 거리(m). 자주 열리다가 점점 멀어진다. 첫 변신만 `FIRST_UNLOCK_M`, 나머지는 200 + 350·(n−1) + 40·(n−1)·(n−2).
 * 점프가 납작해져(2026-11-19 2안) 같은 시간에 더 멀리 가므로, 변신 시각(판 시작부터 초)이 전과 비슷하도록 둘째부터 약 1.4 배로 늘렸다.
 */
export const unlockAt = (n: number) => n <= 1 ? FIRST_UNLOCK_M : 200 + 350 * (n - 1) + 40 * (n - 1) * (n - 2);

/** 다음 변신까지: `next` 번째 변신, 남은 거리(m), 지난 변신 거리부터 채운 비율 0..1. 화면의 다음 변신 막대가 읽는다. */
export interface FormProgress { readonly next: number; readonly remainM: number; readonly ratio: number }
export function nextFormProgress(distM: number, stage: number): FormProgress {
  const next = stage + 1, at = unlockAt(next), from = stage <= 0 ? 0 : unlockAt(stage);
  const remainM = Math.max(0, at - distM);
  return { next, remainM, ratio: Math.max(0, Math.min(1, (distM - from) / (at - from))) };
}

/** 한국어 큰 수 단위(영어 짝은 같은 자리의 이름). */
const KO_UNITS: readonly (readonly [number, { ko: string; en: string }])[] = [[1e12, { ko: '조', en: 'trillion' }], [1e8, { ko: '억', en: 'hundred million' }], [1e4, { ko: '만', en: 'ten thousand' }]];

/** 전투력 글자. 한국어는 만 · 억 · 조, 영어는 쉼표. */
export function powerText(v: number, lang: Lang): string {
  if (v === Infinity) return '∞';
  if (Number.isNaN(v)) return lang === 'ko' ? '측정불가' : 'UNMEASURABLE';
  const n = Math.round(v);
  if (lang === 'en') return n.toLocaleString('en-US');
  for (const [u, unit] of KO_UNITS) if (n >= u) {
    const head = Math.floor(n / u), rest = n - head * u;
    const sub = rest >= u / 10 ? (u === 1e4 ? '' : ` ${powerText(rest, 'ko')}`) : '';
    return `${head}${unit.ko}${sub}`;
  }
  return String(n);
}
