export const VISUAL_STYLES = [
  {
    id: 'realistic-3d',
    name: '真实 3D',
    en: 'CINEMATIC REALISM',
    cls: 'realistic',
    description: '电影质感，真实光影',
    number: '01',
    promptLabel: '真实3D（电影质感与物理级真实光影）',
    guidance: '电影级 3D 写实渲染，真实物理光照、体积光、微表面材质、浅景深与克制实拍运镜。',
  },
  {
    id: 'anime',
    name: '日本动漫',
    en: 'JAPANESE ANIME',
    cls: 'anime',
    description: '细腻笔触，想象无限',
    number: '02',
    promptLabel: '日本动漫（赛璐璐线稿与通透光影）',
    guidance: '日本电视与剧场版动画赛璐璐风格，干净线稿、清晰色块与柔和多层阴影、通透高光与灵动构图。',
  },
  {
    id: '2.5d',
    name: '2.5D 效果',
    en: 'STYLIZED DIMENSION',
    cls: 'dimension',
    description: '平面与立体之间',
    number: '03',
    promptLabel: '2.5D效果（风格化插画与立体纵深）',
    guidance: '2.5D 风格化厚涂与立体层次结合，手绘笔触叠加微缩空间景深与清晰轮廓光。',
  },
  {
    id: 'cyberpunk',
    name: '赛博霓虹',
    en: 'CYBERPUNK NEON',
    cls: 'cyberpunk',
    description: '雨夜霓虹，未来都市张力',
    number: '04',
    promptLabel: '赛博霓虹（高对比未来都市与潮湿霓虹反光）',
    guidance: '赛博朋克未来都市，深暗雨夜基底搭配青蓝与洋红霓虹光晕、潮湿路面镜面反光、全息投影与强烈景深。',
  },
  {
    id: 'ink-wash',
    name: '国风水墨',
    en: 'CHINESE INK WASH',
    cls: 'ink-wash',
    description: '写意留白，丹青气韵流转',
    number: '05',
    promptLabel: '国风水墨（宣纸晕染、写意留白与青绿丹青）',
    guidance: '新中式国风水墨动画，宣纸肌理、水墨晕染、克制留白、朱砂与石青点缀，意境悠远、衣袂飘动感强。',
  },
  {
    id: 'pixar-clay',
    name: '黏土定格',
    en: 'CLAY STOP-MOTION',
    cls: 'clay',
    description: '手作肌理，温暖微缩剧场',
    number: '06',
    promptLabel: '黏土定格（手工黏土纹理与微缩棚拍光影）',
    guidance: '手工黏土定格动画质感，可见细微指纹与磨砂泥塑肌理、微缩场景道具、温暖柔和棚拍光与浅景深移轴效果。',
  },
  {
    id: 'oil-painting',
    name: '复古油画',
    en: 'CLASSICAL OIL',
    cls: 'oil',
    description: '厚涂笔触，戏剧明暗构图',
    number: '07',
    promptLabel: '复古油画（古典厚涂肌理与明暗戏剧光影）',
    guidance: '欧洲古典油画动态画卷，厚重笔触与画布肌理、伦勃朗式戏剧明暗对比、浓郁暖金与深黛色调。',
  },
  {
    id: 'watercolor',
    name: '治愈水彩',
    en: 'HEALING WATERCOLOR',
    cls: 'watercolor',
    description: '通透晕染，柔和手绘诗意',
    number: '08',
    promptLabel: '治愈水彩（透明水彩晕染与柔光手绘绘本）',
    guidance: '治愈系手绘水彩动画，冷压水彩纸纹、自然水痕晕染、低饱和柔光配色与轻盈温暖的诗意镜头。',
  },
  {
    id: 'film-noir',
    name: '黑白胶片',
    en: 'FILM NOIR',
    cls: 'noir',
    description: '胶片颗粒，强烈光影悬疑',
    number: '09',
    promptLabel: '黑白胶片（35mm 高反差黑白银盐与百叶窗光影）',
    guidance: '经典黑色电影 35mm 黑白胶片质感，真实银盐颗粒、强烈明暗切割、百叶窗与逆光剪影，氛围冷峻克制。',
  },
];

export const VISUAL_STYLE_IDS = VISUAL_STYLES.map((s) => s.id);

export function getVisualStyle(id) {
  return VISUAL_STYLES.find((s) => s.id === id) || null;
}

export const VISUAL_STYLE_LABELS = Object.fromEntries(
  VISUAL_STYLES.map((s) => [s.id, s.promptLabel]),
);
