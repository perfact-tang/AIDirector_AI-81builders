export const MUSIC_GENRES = [
  { id: 'pop', name: '流行 Pop', en: 'POP', cue: '明快节奏、情绪递进清晰、副歌镜头开阔富有记忆点' },
  { id: 'rock', name: '摇滚 Rock', en: 'ROCK', cue: '高能鼓点切镜、强烈逆光与手持动感、副歌爆发力拉满' },
  { id: 'electronic', name: '电子 / 赛博', en: 'ELECTRONIC', cue: '精准卡点、光影脉冲与霓虹折射、未来感空间穿梭' },
  { id: 'guofeng', name: '古风 / 国风', en: 'GUOFENG', cue: '意境留白、衣袂烟雨飘动、山水与楼阁长镜头流转' },
  { id: 'folk', name: '民谣 / 治愈', en: 'FOLK', cue: '温暖自然光、生活化细节特写、从容温柔的叙事节奏' },
  { id: 'hiphop', name: '说唱 / 嘻哈', en: 'HIP-HOP', cue: '低角度仰拍、利落节奏硬切、街头光影与强烈主体气场' },
  { id: 'rnb', name: 'R&B / 都市夜景', en: 'R&B', cue: '丝滑慢摇运镜、霓虹雨夜氛围、私密情绪近景与光影交错' },
  { id: 'anime-rock', name: '二次元 / 燃系', en: 'ANIME ROCK', cue: '夸张透视动态、疾速追焦、高燃光效与情绪释放' },
  { id: 'cinematic', name: '电影配乐 / 史诗', en: 'CINEMATIC', cue: '宏大航拍景别、史诗级光影层次、强烈戏剧弧光' },
  { id: 'jazz', name: '爵士 / 复古', en: 'JAZZ', cue: '暖金胶片质感、烟雾与昏黄灯光、慵懒优雅的镜头摇移' },
];

export function getMusicGenre(id) {
  return MUSIC_GENRES.find((g) => g.id === id) || MUSIC_GENRES[0];
}

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = String(Math.floor(safe / 60)).padStart(2, '0');
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function parseShotClock(value) {
  const match = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value?.trim());
  if (!match) return undefined;
  const [, minutes, seconds, fraction = '0'] = match;
  return Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

export function formatVoiceLrc(shots) {
  const lines = [];
  let nextStart = 0;

  for (const { timestamp, seconds, text } of shots) {
    const [startClock, endClock] = (timestamp ?? '').split(/[-–—]/);
    const start = parseShotClock(startClock) ?? nextStart;
    const end = parseShotClock(endClock);
    const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
    nextStart = end > start ? end : start + duration;

    if (!text) continue;
    const centiseconds = Math.round(start * 100);
    const fraction = String(centiseconds % 100).padStart(2, '0');
    lines.push(`[${formatClock(centiseconds / 100)}.${fraction}]${text.replace(/\s*[\r\n]+\s*/g, ' ')}`);
  }

  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function parseLrc(rawText = '') {
  const meta = { title: '', artist: '', album: '' };
  const lines = [];
  if (typeof rawText !== 'string' || !rawText.trim()) return { meta, lines };

  const metaRegex = /^\s*\[(ti|ar|al):([^\]]*)\]\s*$/i;
  const timeTagRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const sectionRegex = /\[([^\]]+)\]/;

  for (const rawLine of rawText.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const metaMatch = trimmed.match(metaRegex);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      const val = metaMatch[2].trim();
      if (key === 'ti') meta.title = val;
      if (key === 'ar') meta.artist = val;
      if (key === 'al') meta.album = val;
      continue;
    }

    const timestamps = [];
    let match;
    timeTagRegex.lastIndex = 0;
    while ((match = timeTagRegex.exec(trimmed)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fracRaw = match[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      timestamps.push(minutes * 60 + seconds + frac);
    }

    if (!timestamps.length) continue;

    let body = trimmed.replace(timeTagRegex, '').trim();
    let section = '';
    const secMatch = body.match(sectionRegex);
    if (secMatch && body.startsWith(secMatch[0])) {
      section = secMatch[1].trim();
      body = body.slice(secMatch[0].length).trim();
    }

    for (const time of timestamps) {
      lines.push({ time, text: body, section });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return { meta, lines };
}

export function buildMvSlices({ durationSeconds, pace = 5, lrcLines = [] }) {
  const safePace = pace === 10 ? 10 : 5;
  const safeDuration = Math.max(safePace, Number(durationSeconds) || safePace);
  const count = Math.max(1, Math.ceil(safeDuration / safePace));
  const slices = [];
  let activeSection = 'Intro';

  for (let i = 0; i < count; i++) {
    const start = i * safePace;
    const end = (i + 1) * safePace;
    const matched = lrcLines.filter((line) => line.time >= start - 0.05 && line.time < end - 0.05);

    const foundSection = matched.find((line) => line.section)?.section;
    if (foundSection) {
      activeSection = foundSection;
    } else if (i === count - 1 && !matched.length) {
      activeSection = 'Outro';
    }

    const lyricText = matched
      .map((line) => line.text)
      .filter((text) => text && !/^finish$/i.test(text))
      .join(' / ');

    slices.push({
      index: i,
      shotId: `MV-${String(i + 1).padStart(3, '0')}`,
      start,
      end,
      duration: safePace,
      timestamp: `${formatClock(start)} - ${formatClock(end)}`,
      section: activeSection,
      lyrics: lyricText || '[纯音乐 / 间奏]',
      hasLyrics: Boolean(lyricText),
    });
  }

  return slices;
}
