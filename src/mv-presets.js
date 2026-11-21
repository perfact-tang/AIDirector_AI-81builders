// Built-in default reference portraits/scenes for Music MV mode.
// Each preset renders locally to a crisp 768x432 PNG data URL so MiniMax H3 always receives a valid image reference.

export const DEFAULT_MV_REFERENCES = [
  {
    id: 'neon-vocalist',
    name: '赛博歌姬 · Nova',
    role: 'MV 主角',
    tag: '赛博 / 电子 / 流行',
    recommendedStyles: ['cyberpunk', 'realistic-3d', 'anime'],
    palette: ['#080c18', '#141e3c', '#00e5ff', '#ff2a85', '#f3f7ff'],
    accent: 'neon',
  },
  {
    id: 'urban-walker',
    name: '都市夜行者 · 陆沉',
    role: 'MV 主角',
    tag: 'R&B / 说唱 / 摇滚',
    recommendedStyles: ['realistic-3d', 'film-noir', 'cyberpunk'],
    palette: ['#0c0e12', '#1f2630', '#f5a623', '#60a5fa', '#e5e7eb'],
    accent: 'urban',
  },
  {
    id: 'ink-swordsman',
    name: '青衫剑客 · 清寒',
    role: 'MV 主角',
    tag: '古风 / 国风 / 史诗',
    recommendedStyles: ['ink-wash', 'watercolor', '2.5d'],
    palette: ['#e9e5da', '#c7c1b0', '#2b4c59', '#9e2a2b', '#1b2428'],
    accent: 'ink',
  },
  {
    id: 'anime-band',
    name: '二次元主唱 · 星野',
    role: 'MV 主角',
    tag: '二次元 / 摇滚 / 流行',
    recommendedStyles: ['anime', '2.5d', 'watercolor'],
    palette: ['#1a1638', '#3c2a6e', '#ff6b9d', '#ffd166', '#ffffff'],
    accent: 'stage',
  },
  {
    id: 'starlight-drifter',
    name: '星际旅人 · Aria',
    role: 'MV 主角',
    tag: '电子 / 电影配乐',
    recommendedStyles: ['realistic-3d', '2.5d', 'oil-painting'],
    palette: ['#060814', '#162447', '#7b2cbf', '#4cc9f0', '#f8fafc'],
    accent: 'cosmos',
  },
  {
    id: 'retro-vinyl',
    name: '复古胶片主角 · 曼妮',
    role: 'MV 主角',
    tag: '爵士 / 民谣 / 复古',
    recommendedStyles: ['oil-painting', 'film-noir', 'pixar-clay'],
    palette: ['#1c1410', '#3d281c', '#d4a373', '#e76f51', '#f6efe4'],
    accent: 'retro',
  },
];

const cachedImages = new Map();

export function renderPresetDataUrl(preset) {
  if (!preset) return '';
  if (cachedImages.has(preset.id)) return cachedImages.get(preset.id);
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 432;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const [bg1, bg2, c1, c2, fg] = preset.palette;

  // Atmospheric backdrop gradient
  const bg = ctx.createLinearGradient(0, 0, 768, 432);
  bg.addColorStop(0, bg1);
  bg.addColorStop(0.55, bg2);
  bg.addColorStop(1, bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 768, 432);

  // Soft rim glow behind subject
  const glow = ctx.createRadialGradient(384, 185, 18, 384, 185, 220);
  glow.addColorStop(0, c1 + 'aa');
  glow.addColorStop(0.5, c2 + '44');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 768, 432);

  // Stylized environmental motif per theme
  ctx.save();
  if (preset.accent === 'neon' || preset.accent === 'urban') {
    ctx.strokeStyle = c1 + '44';
    ctx.lineWidth = 2;
    for (let x = 40; x < 768; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 310);
      ctx.lineTo(x + (x - 384) * 0.6, 432);
      ctx.stroke();
    }
    ctx.fillStyle = c2 + '33';
    ctx.fillRect(90, 90, 88, 220);
    ctx.fillRect(590, 65, 96, 245);
  } else if (preset.accent === 'ink') {
    ctx.fillStyle = c1 + '38';
    ctx.beginPath();
    ctx.moveTo(0, 340);
    ctx.quadraticCurveTo(180, 190, 380, 310);
    ctx.quadraticCurveTo(560, 170, 768, 330);
    ctx.lineTo(768, 432);
    ctx.lineTo(0, 432);
    ctx.fill();
    ctx.fillStyle = c2 + 'bb';
    ctx.beginPath();
    ctx.arc(580, 110, 44, 0, Math.PI * 2);
    ctx.fill();
  } else if (preset.accent === 'stage' || preset.accent === 'cosmos') {
    ctx.strokeStyle = c1 + '55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(384, 210, 260, 72, -0.22, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 28; i++) {
      const sx = (i * 97 + 53) % 740 + 14;
      const sy = (i * 61 + 29) % 260 + 20;
      ctx.fillStyle = fg + '99';
      ctx.beginPath();
      ctx.arc(sx, sy, (i % 3) + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = c1 + '55';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(384, 210, 145, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(384, 210, 115, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Clean stylized character silhouette & rim light (center hero 3/4 portrait)
  ctx.save();
  const bodyGrad = ctx.createLinearGradient(320, 110, 448, 432);
  bodyGrad.addColorStop(0, preset.accent === 'ink' ? '#1f2e34' : '#151923');
  bodyGrad.addColorStop(1, preset.accent === 'ink' ? '#0f171a' : '#090b10');

  // Shoulders & coat
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(270, 432);
  ctx.quadraticCurveTo(286, 286, 344, 258);
  ctx.lineTo(424, 258);
  ctx.quadraticCurveTo(482, 286, 498, 432);
  ctx.closePath();
  ctx.fill();

  // Rim highlight on shoulder
  ctx.strokeStyle = c1 + 'cc';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(278, 430);
  ctx.quadraticCurveTo(292, 290, 346, 260);
  ctx.stroke();

  // Neck
  ctx.fillStyle = preset.accent === 'ink' ? '#d8cfc4' : '#d6c3b4';
  ctx.fillRect(368, 224, 32, 42);

  // Head
  ctx.beginPath();
  ctx.ellipse(384, 178, 46, 56, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stylized hair crown
  ctx.fillStyle = preset.accent === 'neon' ? '#1e293b' : preset.accent === 'stage' ? '#2e1d4f' : '#14171f';
  ctx.beginPath();
  ctx.arc(384, 166, 52, Math.PI * 0.92, Math.PI * 2.08);
  ctx.quadraticCurveTo(444, 198, 428, 234);
  ctx.quadraticCurveTo(418, 180, 384, 152);
  ctx.quadraticCurveTo(348, 176, 338, 234);
  ctx.quadraticCurveTo(324, 198, 332, 166);
  ctx.fill();

  // Subtle accent scarf / collar
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.moveTo(338, 260);
  ctx.quadraticCurveTo(384, 294, 430, 260);
  ctx.lineTo(418, 288);
  ctx.quadraticCurveTo(384, 312, 350, 288);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  cachedImages.set(preset.id, dataUrl);
  return dataUrl;
}
