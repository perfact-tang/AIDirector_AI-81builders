import express from 'express';
import { mkdir, writeFile, readFile, readdir, stat, rm, access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mediaTool, decodedAudioDuration } from './media-tools.js';
import { MODEL } from './director.js';
import { parseLrc, buildMvSlices, getMusicGenre } from '../src/mv-lrc.js';
import { getVisualStyle, VISUAL_STYLE_IDS } from '../src/visual-styles.js';

const DEFAULT_MV_DIR = fileURLToPath(new URL('../.local/mv/', import.meta.url));
const DEFAULT_VIDEO_DIR = fileURLToPath(new URL('../.local/videos/', import.meta.url));

function createLocalStore(rootDir) {
  const resolveSafe = (key) => {
    if (!/^[\w./-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
      throw new Error('Invalid object path');
    }
    return path.join(rootDir, key);
  };
  return {
    async read(key) {
      try {
        return JSON.parse(await readFile(resolveSafe(key), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(key, value) {
      const dest = resolveSafe(key);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, JSON.stringify(value), 'utf8');
    },
    async bytes(key, bytes) {
      const dest = resolveSafe(key);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    },
    async upload(key, localPath) {
      const dest = resolveSafe(key);
      await mkdir(path.dirname(dest), { recursive: true });
      if (path.resolve(localPath) !== path.resolve(dest)) {
        await copyFile(localPath, dest);
      }
    },
    async download(key, localPath) {
      const src = resolveSafe(key);
      await mkdir(path.dirname(localPath), { recursive: true });
      if (path.resolve(src) !== path.resolve(localPath)) {
        await copyFile(src, localPath);
      }
      return localPath;
    },
    async buffer(key) {
      return readFile(resolveSafe(key));
    },
    async list(directory) {
      const dir = resolveSafe(directory.replace(/\/+$/, ''));
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => `${directory.replace(/\/+$/, '')}/${e.name}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async remove(key) {
      await rm(resolveSafe(key), { force: true });
    },
  };
}

function decodeAudioDataUrl(value) {
  const match = typeof value === 'string' && value.match(/^data:(audio\/(?:mpeg|mp3|wav|x-wav));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('请上传有效的 MP3 或 WAV 音频文件。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 35 * 1024 * 1024) throw new Error('音频文件为空或超过 35 MB 限制。');
  return { bytes, mime: match[1] };
}

function decodeImageDataUrl(value) {
  const match = typeof value === 'string' && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('请上传有效的 PNG、JPG 或 WebP 人物图片。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('人物图片为空或超过 10 MB 限制。');
  return { bytes, mime: match[1] };
}

const validId = (id) => typeof id === 'string' && /^[-a-zA-Z0-9_]{8,80}$/.test(id);

export function buildMvSystemPrompt() {
  return `你是一位顶级音乐 MV 导演与分镜设计师，精通 MiniMax H3 音乐驱动视频生成。
你的任务是根据歌曲风格、画风、LRC 歌词时间轴、用户灵感和参考人物，构思一个完整动人的 MV 故事线，并为每一个时间切片逐条输出电影级分镜脚本。

输出格式严格要求（NDJSON，每行一个完整 JSON 对象，不要 Markdown 代码块，不要多余解释，不要数组包裹）：
1. 第一行（仅首批输出）必须是故事大纲对象：
{"type":"story","title":"MV 标题","storyline":"100-220字完整 MV 故事脉络与情感弧光","visual_theme":"核心视觉母题与空间设计","color_palette":"统一色彩与光影基调"}
2. 紧接着每个切片输出一行镜头对象：
{"type":"shot","index":0,"shot_id":"MV-001","section":"段落名","mood":"情绪关键词","camera":"景别与运镜（如：低角度推进/俯拍环绕/特写拉远）","scene_transition":"文字转场方式（如：硬切新场景/光影叠化/尾帧推进）","image_prompt":"60-220字中文核心构图描述，包含景别、机位、环境道具、光影色调与主体位置","video_prompt":"100-350字中文动态分镜提示词，描述起势→中段卡点动作与运镜变化→结束画面状态，紧贴音乐节拍与歌词意境；如有参考人物，用 <Subject 1> 或角色名称引用","use_previous_frame":false}

严格导演规则：
- 必须严格覆盖提供的每一个切片 index，不得遗漏或合并。
- 相邻两个镜头的 image_prompt 和 video_prompt 严禁雷同！每切一镜至少改变景别、机位角度、环境空间或主体动作中的两项。
- 切换段落（如 Intro→Verse→Chorus）、切换地点或大幅换景别时，use_previous_frame 必须为 false，并在 scene_transition 与 video_prompt 开头写清全新场景切换。
- index 为 0 的首个镜头 use_previous_frame 必须为 false；连续启用 use_previous_frame: true 不超过 2 个镜头；启用时必须写出从起始尾帧立刻推进到全新动作与结束构图，绝不停留在静止画面。
- 纯音乐/间奏切片也要设计富有张力的空镜、意象转场或氛围表演，绝不留白。
- 每行 JSON 必须是合法单行 JSON，字符串内禁止出现未转义换行符。`;
}

export function buildMvBatchPrompt({ title, artist, genre, visualStyle, pace, inspiration, characters, slices, story, previousShot, batchIndex, totalBatches }) {
  const styleInfo = getVisualStyle(visualStyle);
  const genreInfo = getMusicGenre(genre);
  const charText = characters?.length
    ? characters.map((c, i) => `<Subject ${i + 1}> = ${c.name}${c.prompt ? `（角色设定：${String(c.prompt).slice(0, 180)}）` : `（${c.role || 'MV 主角'}）`}`).join('；')
    : '无固定人物，以意象与环境叙事为主';

  const lines = [
    `歌曲标题：${title || '未命名歌曲'}${artist ? ` · 演唱：${artist}` : ''}`,
    `歌曲风格：${genreInfo.name}（节奏与镜头参考：${genreInfo.cue}）`,
    `视觉画风：${styleInfo ? `${styleInfo.promptLabel}（${styleInfo.guidance}）` : visualStyle}`,
    `切片节奏：固定 ${pace} 秒 / 镜头`,
    `参考人物：${charText}`,
    inspiration?.trim() ? `用户 MV 叙述感觉与灵感：${inspiration.trim()}` : '用户未提供额外灵感，请结合歌词与曲风自由发挥一个有电影感的故事。',
  ];

  if (batchIndex > 0 && story) {
    lines.push('已确立的 MV 故事大纲（本批无需重复输出 story 行，直接从本批第一个 shot 开始输出）：');
    lines.push(`标题：${story.title}｜故事线：${story.storyline}｜视觉母题：${story.visual_theme}｜色彩：${story.color_palette}`);
  }
  if (previousShot) {
    lines.push(`上一批最后一个镜头（${previousShot.shot_id}）结尾状态：${previousShot.video_prompt.slice(-160)}`);
  }

  lines.push(`\n以下是第 ${batchIndex + 1}/${totalBatches} 批切片时间轴（共 ${slices.length} 条），请严格按 index 逐条输出 NDJSON：`);
  for (const s of slices) {
    lines.push(`index=${s.index} | shot_id=${s.shotId} | ${s.timestamp} | 段落=${s.section} | 歌词=${s.lyrics}`);
  }
  return lines.join('\n');
}

export function extractJsonObjects(buffer) {
  const objects = [];
  let start = -1, depth = 0, inString = false, escape = false, lastConsumed = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        const candidate = buffer.slice(start, i + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Ignore malformed fragment and keep scanning
        }
        lastConsumed = i + 1;
        start = -1;
      }
    }
  }

  return {
    objects,
    rest: start !== -1 ? buffer.slice(start) : buffer.slice(lastConsumed),
  };
}

function normalizeShot(raw, slice, prevShot) {
  const index = slice.index;
  const usePreviousFrame = index > 0 && raw?.use_previous_frame === true && !(prevShot?.use_previous_frame && prevShot?._streak >= 2);
  const imagePrompt = String(raw?.image_prompt || `${slice.section} 场景，${slice.lyrics} 对应的电影感核心构图，光影层次分明。`).trim().slice(0, 800);
  const videoPrompt = String(raw?.video_prompt || `【镜头切换】紧贴 ${slice.timestamp} 音乐节拍，画面从开场构图迅速推进，呈现「${slice.lyrics}」的情绪张力与动态运镜。`).trim().slice(0, 6000);
  return {
    index,
    shot_id: slice.shotId,
    section: String(raw?.section || slice.section || 'Scene').trim(),
    mood: String(raw?.mood || '沉浸').trim(),
    camera: String(raw?.camera || '中景推进').trim(),
    scene_transition: String(raw?.scene_transition || (usePreviousFrame ? '尾帧自然推进' : '硬切新场景')).trim(),
    image_prompt: imagePrompt,
    video_prompt: videoPrompt,
    use_previous_frame: usePreviousFrame,
    _streak: usePreviousFrame ? (prevShot?._streak || 0) + 1 : 0,
  };
}

async function streamCompletion(system, prompt, { request = fetch, signal } = {}) {
  if (!process.env.AIAND_API_KEY) throw new Error('后端未配置 AIAND_API_KEY。');
  const response = await request('https://api.aiand.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.AIAND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 16000,
      stream: true,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`MV 脚本模型请求失败（${response.status}），请检查模型权限、余额与网络。`);
  return response;
}

export function mvRouter({ folder = DEFAULT_MV_DIR, videoFolder = DEFAULT_VIDEO_DIR, getVideoFolder, getStore, request = fetch, audioInspector = decodedAudioDuration, tool = mediaTool } = {}) {
  const router = express.Router();
  const localStore = createLocalStore(path.join(folder, '_store'));
  const storeOf = (req) => (getStore ? getStore(req) : localStore);
  const resolveVideoFolder = (req) => (getVideoFolder ? getVideoFolder(req) : videoFolder) || DEFAULT_VIDEO_DIR;

  // --- Cloud / Local Character Library ---
  router.get('/characters', async (req, res) => {
    try {
      const store = storeOf(req);
      const keys = await store.list('mv-characters/');
      const metaKeys = keys.filter((k) => k.endsWith('.json'));
      const list = await Promise.all(
        metaKeys.map(async (k) => {
          const meta = await store.read(k);
          if (!meta?.id) return null;
          let image = '';
          if (meta.mime) {
            try {
              const bytes = await store.buffer(`mv-characters/${meta.id}.image`);
              image = `data:${meta.mime};base64,${bytes.toString('base64')}`;
            } catch {
              image = '';
            }
          }
          return {
            id: meta.id,
            name: meta.name,
            role: meta.role || 'MV 主角',
            prompt: meta.prompt || '',
            image,
            updatedAt: meta.updatedAt || '',
          };
        }),
      );
      res.json({
        characters: list.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      });
    } catch (e) {
      res.status(500).json({ error: e.message || '无法读取参考人物列表。' });
    }
  });

  router.post('/characters', express.json({ limit: '16mb' }), async (req, res) => {
    try {
      const store = storeOf(req);
      const { id: rawId, name, role = 'MV 主角', prompt = '', image } = req.body ?? {};
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName || cleanName.length > 60) {
        return res.status(400).json({ error: '请输入 1–60 字的人物名称。' });
      }
      const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
      const id = validId(rawId) ? rawId : `CHAR-${randomUUID().slice(0, 12)}`;
      const existing = await store.read(`mv-characters/${id}.json`);

      let mime = existing?.mime || '';
      let imageDataUrl = '';

      if (typeof image === 'string' && image.startsWith('data:image/')) {
        const decoded = decodeImageDataUrl(image);
        mime = decoded.mime;
        await store.bytes(`mv-characters/${id}.image`, decoded.bytes, decoded.mime);
        imageDataUrl = image;
      } else if (existing?.mime) {
        try {
          const bytes = await store.buffer(`mv-characters/${id}.image`);
          imageDataUrl = `data:${existing.mime};base64,${bytes.toString('base64')}`;
        } catch {
          imageDataUrl = '';
        }
      }

      if (!imageDataUrl) {
        return res.status(400).json({ error: '请上传人物参考图。' });
      }

      const meta = {
        id,
        name: cleanName,
        role: typeof role === 'string' && role.trim() ? role.trim().slice(0, 40) : 'MV 主角',
        prompt: cleanPrompt,
        mime,
        updatedAt: new Date().toISOString(),
      };
      await store.write(`mv-characters/${id}.json`, meta);
      res.json({ character: { ...meta, image: imageDataUrl } });
    } catch (e) {
      res.status(400).json({ error: e.message || '保存参考人物失败。' });
    }
  });

  router.delete('/characters/:id', async (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return res.sendStatus(400);
    try {
      const store = storeOf(req);
      await Promise.all([
        store.remove(`mv-characters/${id}.json`),
        store.remove(`mv-characters/${id}.image`),
      ]);
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: e.message || '删除参考人物失败。' });
    }
  });

  // --- Cloud / Local MV Projects Persistence ---
  router.get('/projects', async (req, res) => {
    try {
      const store = storeOf(req);
      const keys = await store.list('mv-projects/');
      const items = await Promise.all(
        keys.filter((k) => k.endsWith('.summary.json')).map((k) => store.read(k)),
      );
      res.json({
        projects: items.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      });
    } catch (e) {
      res.status(500).json({ error: e.message || '无法读取 MV 项目列表。' });
    }
  });

  router.get('/projects/:id', async (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return res.sendStatus(404);
    try {
      const store = storeOf(req);
      const data = await store.read(`mv-projects/${id}.json`);
      if (!data) return res.status(404).json({ error: 'MV 项目不存在。' });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message || '无法读取 MV 项目。' });
    }
  });

  router.post('/projects/:id', express.json({ limit: '16mb' }), async (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return res.status(400).json({ error: 'MV 项目 ID 无效。' });
    try {
      const store = storeOf(req);
      const body = req.body ?? {};
      const slices = Array.isArray(body.session?.slices) ? body.session.slices : [];
      const shotsObj = body.shots && typeof body.shots === 'object' ? body.shots : {};
      const jobsObj = body.jobs && typeof body.jobs === 'object' ? body.jobs : {};
      const completedVideos = Object.values(jobsObj).filter((j) => j?.status === 'completed' && Boolean(j.url)).length;
      const updatedAt = new Date().toISOString();
      const title = String(
        body.story?.title || body.session?.meta?.title || body.audioName?.replace(/\.[^.]+$/, '') || '未命名 MV 项目',
      ).trim().slice(0, 120);

      const record = {
        id,
        title,
        audioName: typeof body.audioName === 'string' ? body.audioName.slice(0, 200) : '',
        audioDuration: Number.isFinite(body.audioDuration) ? body.audioDuration : (body.session?.durationSeconds || 0),
        lrcText: typeof body.lrcText === 'string' ? body.lrcText.slice(0, 60000) : '',
        lrcFileName: typeof body.lrcFileName === 'string' ? body.lrcFileName.slice(0, 200) : '',
        visualStyle: VISUAL_STYLE_IDS.includes(body.visualStyle) ? body.visualStyle : 'cyberpunk',
        genre: typeof body.genre === 'string' ? body.genre.slice(0, 40) : 'pop',
        pace: body.pace === 10 ? 10 : 5,
        aspect: typeof body.aspect === 'string' ? body.aspect.slice(0, 16) : '16:9',
        inspiration: typeof body.inspiration === 'string' ? body.inspiration.slice(0, 4000) : '',
        selectedCharacterIds: Array.isArray(body.selectedCharacterIds) ? body.selectedCharacterIds.filter(validId).slice(0, 4) : [],
        session: body.session || null,
        story: body.story || null,
        shots: shotsObj,
        jobs: jobsObj,
        mergedUrl: typeof body.mergedUrl === 'string' ? body.mergedUrl : '',
        updatedAt,
      };

      const summary = {
        id,
        title,
        visualStyle: record.visualStyle,
        genre: record.genre,
        pace: record.pace,
        sliceCount: slices.length,
        scriptedCount: Object.keys(shotsObj).length,
        completedVideos,
        updatedAt,
      };

      await store.write(`mv-projects/${id}.json`, record);
      await store.write(`mv-projects/${id}.summary.json`, summary);
      res.json({ id, summary });
    } catch (e) {
      res.status(400).json({ error: e.message || '保存 MV 项目失败。' });
    }
  });

  router.delete('/projects/:id', async (req, res) => {
    const { id } = req.params;
    if (!validId(id)) return res.sendStatus(400);
    try {
      const store = storeOf(req);
      await Promise.all([
        store.remove(`mv-projects/${id}.json`),
        store.remove(`mv-projects/${id}.summary.json`),
      ]);
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: e.message || '删除 MV 项目失败。' });
    }
  });

  // --- Audio Slicing ---
  router.post('/slice', express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const { audioDataUrl, filename = 'song.mp3', pace = 5, lrcText = '' } = req.body ?? {};
      if (![5, 10].includes(pace)) return res.status(400).json({ error: '切片节奏仅支持 5 秒或 10 秒。' });
      const { bytes, mime } = decodeAudioDataUrl(audioDataUrl);
      const sessionId = randomUUID();
      const sessionDir = path.join(folder, sessionId);
      await mkdir(sessionDir, { recursive: true });

      const ext = mime.includes('wav') ? '.wav' : '.mp3';
      const rawPath = path.join(sessionDir, 'source' + ext);
      const masterPath = path.join(sessionDir, 'master.mp3');
      await writeFile(rawPath, bytes);

      await tool(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', masterPath], 120000);
      await rm(rawPath, { force: true });

      const durationSeconds = await audioInspector(masterPath);
      if (durationSeconds > 600) {
        await rm(sessionDir, { recursive: true, force: true });
        return res.status(400).json({ error: '音频时长超过 10 分钟，请上传更短的歌曲。' });
      }

      const cloudStore = getStore ? getStore(req) : null;
      if (cloudStore) {
        await cloudStore.upload(`mv-audio/${sessionId}/master.mp3`, masterPath, 'audio/mpeg');
      }

      const parsed = parseLrc(typeof lrcText === 'string' ? lrcText : '');
      const slices = buildMvSlices({ durationSeconds, pace, lrcLines: parsed.lines });

      for (const slice of slices) {
        const sliceFile = `slice-${String(slice.index).padStart(3, '0')}.mp3`;
        const slicePath = path.join(sessionDir, sliceFile);
        const clipLen = Math.min(pace, Math.max(0.2, durationSeconds - slice.start));
        const target = Math.max(0.2, Math.min(pace - 0.02, clipLen));
        await tool(
          process.env.FFMPEG_BIN || 'ffmpeg',
          [
            '-y', '-v', 'error',
            '-ss', String(slice.start),
            '-t', String(target),
            '-i', masterPath,
            '-vn',
            '-af', `apad=whole_dur=${Math.max(1, Math.min(pace - 0.02, pace))}`,
            '-t', String(pace - 0.02),
            '-c:a', 'libmp3lame',
            '-b:a', '192k',
            slicePath,
          ],
          60000,
        );
        if (cloudStore) {
          await cloudStore.upload(`mv-audio/${sessionId}/${sliceFile}`, slicePath, 'audio/mpeg');
        }
        slice.audioUrl = `/api/mv/audio/${sessionId}/${sliceFile}`;
      }

      const cleanTitle = parsed.meta.title || String(filename).replace(/\.[^.]+$/, '');
      res.json({
        sessionId,
        durationSeconds,
        pace,
        meta: { ...parsed.meta, title: cleanTitle },
        masterAudioUrl: `/api/mv/audio/${sessionId}/master.mp3`,
        slices,
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '音频切片失败。' });
    }
  });

  router.get('/audio/:sessionId/:file', async (req, res) => {
    const { sessionId, file } = req.params;
    if (!/^[a-f0-9-]{16,64}$/.test(sessionId) || !/^(master|slice-\d{3})\.mp3$/.test(file)) {
      return res.sendStatus(404);
    }
    const filePath = path.join(folder, sessionId, file);
    try {
      await stat(filePath);
      return res.type('audio/mpeg').sendFile(filePath, { dotfiles: 'allow' });
    } catch {
      if (getStore) {
        try {
          await getStore(req).download(`mv-audio/${sessionId}/${file}`, filePath);
          return res.type('audio/mpeg').sendFile(filePath, { dotfiles: 'allow' });
        } catch {
          return res.status(404).json({ error: '音频切片不存在。' });
        }
      }
      res.status(404).json({ error: '音频切片不存在。' });
    }
  });

  // --- Streaming MV Storyboard Generation ---
  router.post('/script-stream', express.json({ limit: '2mb' }), async (req, res) => {
    const { title = '', artist = '', genre = 'pop', visualStyle = 'realistic-3d', pace = 5, inspiration = '', characters = [], slices = [] } = req.body ?? {};
    if (!VISUAL_STYLE_IDS.includes(visualStyle) || ![5, 10].includes(pace) || !Array.isArray(slices) || !slices.length || slices.length > 120) {
      return res.status(400).json({ error: '请先上传音频并完成切片，再生成 MV 脚本。' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });

    try {
      const system = buildMvSystemPrompt();
      const batchSize = 20;
      const batches = [];
      for (let i = 0; i < slices.length; i += batchSize) {
        batches.push(slices.slice(i, i + batchSize));
      }

      let story = null;
      let lastShot = null;
      const emitted = new Set();

      for (let b = 0; b < batches.length; b++) {
        if (controller.signal.aborted) break;
        const batch = batches[b];
        send('progress', {
          stage: batches.length > 1 ? `正在构思并生成第 ${b + 1}/${batches.length} 批分镜脚本…` : '正在构思 MV 故事并逐条生成分镜脚本…',
          completed: emitted.size,
          total: slices.length,
        });

        const prompt = buildMvBatchPrompt({
          title,
          artist,
          genre,
          visualStyle,
          pace,
          inspiration,
          characters,
          slices: batch,
          story,
          previousShot: lastShot,
          batchIndex: b,
          totalBatches: batches.length,
        });

        const upstream = await streamCompletion(system, prompt, { request, signal: controller.signal });
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let contentBuffer = '';

        const processContent = () => {
          const { objects, rest } = extractJsonObjects(contentBuffer);
          contentBuffer = rest;
          for (const obj of objects) {
            if (obj.type === 'story' && !story) {
              story = {
                title: String(obj.title || title || '音乐 MV').trim(),
                storyline: String(obj.storyline || '').trim(),
                visual_theme: String(obj.visual_theme || '').trim(),
                color_palette: String(obj.color_palette || '').trim(),
              };
              send('story', story);
            } else if (obj.type === 'shot' || Number.isInteger(obj.index)) {
              const targetSlice = batch.find((s) => s.index === Number(obj.index)) || batch.find((s) => !emitted.has(s.index));
              if (targetSlice && !emitted.has(targetSlice.index)) {
                const clean = normalizeShot(obj, targetSlice, lastShot);
                emitted.add(targetSlice.index);
                lastShot = clean;
                const { _streak, ...publicShot } = clean;
                send('shot', publicShot);
                send('progress', {
                  stage: `已输出 ${emitted.size} / ${slices.length} 条分镜脚本`,
                  completed: emitted.size,
                  total: slices.length,
                });
              }
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
              if (delta) {
                contentBuffer += delta;
                processContent();
              }
            } catch {
              // Ignore partial non-JSON SSE control lines
            }
          }
        }
        processContent();

        for (const slice of batch) {
          if (!emitted.has(slice.index)) {
            const fallback = normalizeShot({}, slice, lastShot);
            emitted.add(slice.index);
            lastShot = fallback;
            const { _streak, ...publicShot } = fallback;
            send('shot', publicShot);
          }
        }
      }

      if (!story && !controller.signal.aborted) {
        story = {
          title: title || '音乐 MV',
          storyline: inspiration?.trim() || '围绕歌曲旋律与歌词情绪展开的电影感视觉叙事。',
          visual_theme: getVisualStyle(visualStyle)?.name || visualStyle,
          color_palette: '随音乐段落情绪由克制逐步推向高潮光影',
        };
        send('story', story);
      }

      if (!controller.signal.aborted) {
        send('done', { total: emitted.size });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        send('error', { error: e.message || 'MV 脚本生成失败。' });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // --- Merge Completed Clips + Master MP3 ---
  router.post('/merge', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { sessionId, videoIds } = req.body ?? {};
      if (!/^[a-f0-9-]{16,64}$/.test(sessionId || '') || !Array.isArray(videoIds) || !videoIds.length || videoIds.length > 150) {
        return res.status(400).json({ error: '请提供有效的 MV 会话与已生成的视频片段列表。' });
      }
      if (!videoIds.every((id) => typeof id === 'string' && /^[-a-zA-Z0-9_]{16,80}$/.test(id))) {
        return res.status(400).json({ error: '视频片段 ID 格式无效。' });
      }

      const sessionDir = path.join(folder, sessionId);
      await mkdir(sessionDir, { recursive: true });
      const masterPath = path.join(sessionDir, 'master.mp3');
      const cloudStore = getStore ? getStore(req) : null;
      try {
        await access(masterPath);
      } catch {
        if (cloudStore) await cloudStore.download(`mv-audio/${sessionId}/master.mp3`, masterPath);
        else throw new Error('原曲音频不存在，请重新上传音频切片。');
      }

      const targetVideoDir = resolveVideoFolder(req);
      const clipPaths = [];
      for (const id of videoIds) {
        const clipPath = path.join(targetVideoDir, id + '.mp4');
        try {
          await access(clipPath);
        } catch {
          if (cloudStore) {
            const downloaded = path.join(sessionDir, `clip-${id}.mp4`);
            await cloudStore.download(`videos/${id}.mp4`, downloaded);
            clipPaths.push(downloaded);
            continue;
          }
          throw new Error(`找不到已生成的视频片段（${id}）。`);
        }
        clipPaths.push(clipPath);
      }

      const listPath = path.join(sessionDir, 'concat.txt');
      const mergedPath = path.join(sessionDir, 'merged.mp4');
      const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
      await writeFile(listPath, listContent, 'utf8');

      await tool(
        process.env.FFMPEG_BIN || 'ffmpeg',
        [
          '-y', '-v', 'error',
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-i', masterPath,
          '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
          mergedPath,
        ],
        180000,
      );

      if (cloudStore) {
        await cloudStore.upload(`mv-audio/${sessionId}/merged.mp4`, mergedPath, 'video/mp4');
      }

      res.json({ url: `/api/mv/merged/${sessionId}` });
    } catch (e) {
      res.status(400).json({ error: e.message || '合成完整 MV 失败，请确认所有片段均已生成。' });
    }
  });

  router.get('/merged/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!/^[a-f0-9-]{16,64}$/.test(sessionId)) return res.sendStatus(404);
    const mergedPath = path.join(folder, sessionId, 'merged.mp4');
    try {
      await stat(mergedPath);
      return res.type('video/mp4').sendFile(mergedPath, { dotfiles: 'allow' });
    } catch {
      if (getStore) {
        try {
          await getStore(req).download(`mv-audio/${sessionId}/merged.mp4`, mergedPath);
          return res.type('video/mp4').sendFile(mergedPath, { dotfiles: 'allow' });
        } catch {
          return res.status(404).json({ error: '完整 MV 尚未合成。' });
        }
      }
      res.status(404).json({ error: '完整 MV 尚未合成。' });
    }
  });

  return router;
}
