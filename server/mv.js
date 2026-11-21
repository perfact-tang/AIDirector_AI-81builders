import express from 'express';
import { mkdir, writeFile, stat, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mediaTool, decodedAudioDuration } from './media-tools.js';
import { MODEL } from './director.js';
import { parseLrc, buildMvSlices, getMusicGenre } from '../src/mv-lrc.js';
import { getVisualStyle, VISUAL_STYLE_IDS } from '../src/visual-styles.js';

const DEFAULT_MV_DIR = fileURLToPath(new URL('../.local/mv/', import.meta.url));
const DEFAULT_VIDEO_DIR = fileURLToPath(new URL('../.local/videos/', import.meta.url));

function decodeAudioDataUrl(value) {
  const match = typeof value === 'string' && value.match(/^data:(audio\/(?:mpeg|mp3|wav|x-wav));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('请上传有效的 MP3 或 WAV 音频文件。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 35 * 1024 * 1024) throw new Error('音频文件为空或超过 35 MB 限制。');
  return { bytes, mime: match[1] };
}

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
    ? characters.map((c, i) => `<Subject ${i + 1}> = ${c.name}（${c.role || 'MV 主角'}）`).join('；')
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
    lines.push(`已确立的 MV 故事大纲（本批无需重复输出 story 行，直接从本批第一个 shot 开始输出）：`);
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

export function mvRouter({ folder = DEFAULT_MV_DIR, videoFolder = DEFAULT_VIDEO_DIR, request = fetch, audioInspector = decodedAudioDuration, tool = mediaTool } = {}) {
  const router = express.Router();

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

      if (ext === '.wav') {
        await tool(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', masterPath], 120000);
        await rm(rawPath, { force: true });
      } else {
        await tool(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', masterPath], 120000);
        await rm(rawPath, { force: true });
      }

      const durationSeconds = await audioInspector(masterPath);
      if (durationSeconds > 600) {
        await rm(sessionDir, { recursive: true, force: true });
        return res.status(400).json({ error: '音频时长超过 10 分钟，请上传更短的歌曲。' });
      }

      const parsed = parseLrc(typeof lrcText === 'string' ? lrcText : '');
      const slices = buildMvSlices({ durationSeconds, pace, lrcLines: parsed.lines });

      for (const slice of slices) {
        const sliceFile = `slice-${String(slice.index).padStart(3, '0')}.mp3`;
        const slicePath = path.join(sessionDir, sliceFile);
        const clipLen = Math.min(pace, Math.max(0.2, durationSeconds - slice.start));
        // Trim slightly under pace (-0.01s) and pad if short so MiniMax H3's strict <= pace+0.02 check always succeeds
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
      res.type('audio/mpeg').sendFile(filePath, { dotfiles: 'allow' });
    } catch {
      res.status(404).json({ error: '音频切片不存在。' });
    }
  });

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

        // Fill any slice skipped by the model in this batch so every slice always has a valid script
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
      const masterPath = path.join(sessionDir, 'master.mp3');
      await access(masterPath);

      const clipPaths = [];
      for (const id of videoIds) {
        const clipPath = path.join(videoFolder, id + '.mp4');
        await access(clipPath);
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
      res.type('video/mp4').sendFile(mergedPath, { dotfiles: 'allow' });
    } catch {
      res.status(404).json({ error: '完整 MV 尚未合成。' });
    }
  });

  return router;
}
