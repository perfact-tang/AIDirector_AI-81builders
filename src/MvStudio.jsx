import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Check, Film, LoaderCircle, Music, Play, Sparkles, Square, Upload, Video, Wand2, Zap, MoveRight, Download, Trash2, Layers } from 'lucide-react';
import { useI18n } from './LanguageProvider.jsx';
import { VISUAL_STYLES } from './visual-styles.js';
import { MUSIC_GENRES, parseLrc, formatClock } from './mv-lrc.js';
import { DEFAULT_MV_REFERENCES, renderPresetDataUrl } from './mv-presets.js';
import { readImage } from './character-images.js';
import { extractLastFrame } from './video-last-frame.js';
import { fingerprint } from './video-references.js';
import { downloadZip } from './download-zip.js';
import MediaPlaylist from './MediaPlaylist.jsx';

const STATUS_LABELS = {
  submitting: '正在上传素材并提交',
  moderating: '正在审核提示词与素材',
  translating: '正在准备模型提示词',
  queued: '已排队，等待生成',
  in_progress: '正在生成动画',
  completed: '生成完成',
  failed: '生成失败',
  canceled: '任务已结束',
  submission_unknown: '提交状态待确认，请先检查 ai& 控制台',
};

const isTerminal = (job) =>
  ['failed', 'canceled', 'submission_unknown'].includes(job?.status) ||
  (job?.status === 'completed' && Boolean(job.url));

function waitMs(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

async function fetchAsDataUrl(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('无法读取音频切片文件。');
  const blob = await res.blob();
  return readFileAsDataUrl(blob);
}

export default function MvStudio() {
  const { t } = useI18n();

  // Form state
  const [audioFile, setAudioFile] = useState(null); // { name, dataUrl, objectUrl, duration }
  const [lrcText, setLrcText] = useState('');
  const [lrcFileName, setLrcFileName] = useState('');
  const [visualStyle, setVisualStyle] = useState('cyberpunk');
  const [genre, setGenre] = useState('pop');
  const [pace, setPace] = useState(5);
  const [aspect, setAspect] = useState('16:9');
  const [inspiration, setInspiration] = useState('');
  const [selectedPresets, setSelectedPresets] = useState(['neon-vocalist']);
  const [customRefs, setCustomRefs] = useState([]); // [{ id, name, image }]
  const [autoGenerateH3, setAutoGenerateH3] = useState(true);

  // Preset thumbnail cache
  const [presetImages, setPresetImages] = useState({});
  useEffect(() => {
    const map = {};
    for (const preset of DEFAULT_MV_REFERENCES) {
      map[preset.id] = renderPresetDataUrl(preset);
    }
    setPresetImages(map);
  }, []);

  // Cleanup audio objectUrl on unmount
  useEffect(() => {
    return () => {
      if (audioFile?.objectUrl) URL.revokeObjectURL(audioFile.objectUrl);
    };
  }, [audioFile?.objectUrl]);

  // Pipeline state
  const [phase, setPhase] = useState('idle'); // idle | slicing | scripting | ready
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [session, setSession] = useState(null); // { sessionId, durationSeconds, pace, meta, masterAudioUrl, slices }
  const [story, setStory] = useState(null);
  const [shots, setShots] = useState({}); // { [index]: shot }
  const [scriptProgress, setScriptProgress] = useState({ completed: 0, total: 0 });

  // MiniMax H3 video generation state
  const [videoConfig, setVideoConfig] = useState(null);
  const [jobs, setJobs] = useState({}); // { [index]: videoJob }
  const [queue, setQueue] = useState([]); // number[]
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoMessage, setVideoMessage] = useState('');
  const [playlist, setPlaylist] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergedUrl, setMergedUrl] = useState('');
  const [packing, setPacking] = useState(false);

  const scriptAbortRef = useRef(null);
  const videoAbortRef = useRef(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  async function loadVideoConfig() {
    try {
      const res = await fetch('/api/videos/config');
      const data = await res.json();
      if (res.ok) setVideoConfig(data);
    } catch {
      // Ignore offline config fetch error until submission
    }
  }

  useEffect(() => {
    loadVideoConfig();
    return () => {
      scriptAbortRef.current?.abort();
      videoAbortRef.current?.abort();
    };
  }, []);

  const parsedLrc = useMemo(() => parseLrc(lrcText), [lrcText]);
  const estimatedSlices = audioFile?.duration ? Math.max(1, Math.ceil(audioFile.duration / pace)) : 0;

  // Build active character/reference images for script + MiniMax H3
  const activeReferences = useMemo(() => {
    const list = [];
    for (const id of selectedPresets) {
      const preset = DEFAULT_MV_REFERENCES.find((p) => p.id === id);
      if (preset && presetImages[id]) {
        list.push({
          character_id: `CHAR-PRESET-${preset.id.toUpperCase()}`,
          name: preset.name,
          role: preset.role,
          image: presetImages[id],
        });
      }
    }
    for (const custom of customRefs) {
      if (custom.image) {
        list.push({
          character_id: custom.id,
          name: custom.name.trim() || '自定义参考',
          role: '用户参考图',
          image: custom.image,
        });
      }
    }
    if (!list.length) {
      const fallback = DEFAULT_MV_REFERENCES.find((p) => p.recommendedStyles.includes(visualStyle)) || DEFAULT_MV_REFERENCES[0];
      if (fallback && presetImages[fallback.id]) {
        list.push({
          character_id: `CHAR-PRESET-${fallback.id.toUpperCase()}`,
          name: fallback.name,
          role: fallback.role,
          image: presetImages[fallback.id],
        });
      }
    }
    return list.slice(0, 4);
  }, [selectedPresets, presetImages, customRefs, visualStyle]);

  async function handleAudioUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 35 * 1024 * 1024) {
      setError('音频文件超过 35 MB 限制，请压缩后上传。');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const objectUrl = URL.createObjectURL(file);
      const duration = await new Promise((resolve) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
        audio.onerror = () => resolve(0);
        audio.src = objectUrl;
      });
      if (audioFile?.objectUrl) URL.revokeObjectURL(audioFile.objectUrl);
      setAudioFile({ name: file.name, dataUrl, objectUrl, duration });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLrcUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      setLrcText(text);
      setLrcFileName(file.name);
    } catch {
      setError('无法读取 LRC 歌词文件。');
    }
  }

  async function handleCustomRefUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const image = await readImage(file);
      const idx = customRefs.length + 1;
      setCustomRefs((prev) => [
        ...prev.slice(0, 3),
        { id: `CHAR-USER-${Date.now().toString(36)}`, name: `自定义主角 ${idx}`, image },
      ]);
    } catch (err) {
      setError(err.message);
    }
  }

  function togglePreset(id) {
    setSelectedPresets((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(-3),
    );
  }

  function updateShot(index, patch) {
    setShots((prev) => ({
      ...prev,
      [index]: { ...(prev[index] || {}), ...patch },
    }));
  }

  function stopVideoGeneration() {
    videoAbortRef.current?.abort();
    setQueue([]);
    setVideoBusy(false);
    setVideoMessage('已停止后续生成。已提交的动画仍会继续处理，结果将自动保留。');
  }

  async function startVideoQueue(indices, overrideSession, overrideShots) {
    const activeSession = overrideSession || sessionRef.current;
    const activeShots = overrideShots || shotsRef.current;
    if (!activeSession?.slices?.length || !indices.length) return;
    if (videoConfig && !videoConfig.accepted) {
      setVideoMessage('请先在 ai& 控制台 Playground 接受视频服务条款后再生成动画。');
      return;
    }

    videoAbortRef.current?.abort();
    const controller = new AbortController();
    videoAbortRef.current = controller;
    setQueue(indices);
    setVideoBusy(true);
    setMergedUrl('');
    setVideoMessage(`已加入 ${indices.length} 个 MV 切片，全自动依次生成 MiniMax H3 视频…`);

    try {
      for (let pos = 0; pos < indices.length; pos++) {
        if (controller.signal.aborted) break;
        const idx = indices[pos];
        const slice = activeSession.slices[idx];
        const shot = activeShots[idx];
        if (!slice || !shot) continue;

        const requestId = crypto.randomUUID();
        setJobs((prev) => ({
          ...prev,
          [idx]: { id: requestId, status: 'submitting', shotId: slice.shotId },
        }));
        setVideoMessage(`正在处理 ${slice.shotId}（${pos + 1}/${indices.length}）…`);

        try {
          const audioDataUrl = await fetchAsDataUrl(slice.audioUrl, controller.signal);
          let continuityImage;
          let continuityMeta;

          if (shot.use_previous_frame && idx > 0) {
            const prevJob = jobsRef.current[idx - 1];
            if (prevJob?.status === 'completed' && prevJob.url) {
              setVideoMessage(`正在为 ${slice.shotId} 提取上一镜头尾帧…`);
              const frame = await extractLastFrame(prevJob.url, { signal: controller.signal });
              continuityImage = frame.image;
              continuityMeta = {
                sourceUrl: prevJob.url,
                sourceKey: fingerprint(prevJob.id + prevJob.url),
                sourceIndex: idx - 1,
                frameTime: frame.frameTime,
                sourceDuration: frame.sourceDuration,
                width: frame.width,
                height: frame.height,
              };
            }
          }

          const refs = activeReferences.map((r) => ({
            character_id: r.character_id,
            name: r.name,
            image: r.image,
          }));
          const characterRefs = refs.map((r) => r.character_id);
          const referenceKey = fingerprint(
            JSON.stringify(['mv-h3', slice.shotId, shot.video_prompt, shot.image_prompt, characterRefs, Boolean(continuityImage)]),
          );

          const body = {
            requestId,
            shotId: slice.shotId,
            revision: 'mv-auto',
            audioMode: 'music',
            prompt: shot.video_prompt,
            firstPrompt: shot.image_prompt,
            seconds: slice.duration,
            aspect,
            characters: refs,
            characterRefs,
            image: continuityImage,
            continuity: continuityMeta,
            audio: audioDataUrl,
            referenceKey,
          };

          const submitRes = await fetch('/api/videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          let job = await submitRes.json();
          if (!submitRes.ok) {
            job = { id: requestId, status: 'failed', error: job.error || '视频提交失败。' };
          }

          while (!controller.signal.aborted) {
            setJobs((prev) => ({ ...prev, [idx]: job }));
            if (isTerminal(job)) break;
            await waitMs(15000, controller.signal);
            const pollRes = await fetch(`/api/videos/${encodeURIComponent(requestId)}`, {
              signal: controller.signal,
            });
            job = await pollRes.json();
            if (!pollRes.ok) throw new Error(job.error || '无法查询视频任务状态。');
          }

          if (!controller.signal.aborted) {
            setJobs((prev) => ({ ...prev, [idx]: job }));
            setQueue((prev) => prev.filter((item) => item !== idx));
          }
        } catch (shotErr) {
          if (controller.signal.aborted || shotErr.name === 'AbortError') break;
          setJobs((prev) => ({
            ...prev,
            [idx]: { id: requestId, status: 'failed', error: shotErr.message || '生成失败' },
          }));
          setQueue((prev) => prev.filter((item) => item !== idx));
        }
      }

      if (!controller.signal.aborted) {
        setVideoMessage('MiniMax H3 批量生成流程已结束。可预览片段、重试失败项或一键合成完整 MV。');
      }
    } finally {
      if (videoAbortRef.current === controller) {
        setVideoBusy(false);
        setQueue([]);
      }
    }
  }

  async function handleStartMv(e) {
    e.preventDefault();
    if (!audioFile?.dataUrl) {
      setError('请先上传 MP3 或 WAV 歌曲文件。');
      return;
    }

    scriptAbortRef.current?.abort();
    videoAbortRef.current?.abort();
    const controller = new AbortController();
    scriptAbortRef.current = controller;

    setError('');
    setStory(null);
    setShots({});
    setJobs({});
    setQueue([]);
    setVideoBusy(false);
    setMergedUrl('');
    setVideoMessage('');
    setPhase('slicing');
    setStatusMsg(`正在按每 ${pace} 秒自动切片音频并对齐 LRC 歌词…`);

    try {
      const sliceRes = await fetch('/api/mv/slice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioDataUrl: audioFile.dataUrl,
          filename: audioFile.name,
          pace,
          lrcText,
        }),
        signal: controller.signal,
      });
      const sliceData = await sliceRes.json();
      if (!sliceRes.ok) throw new Error(sliceData.error || '音频切片失败。');

      setSession(sliceData);
      sessionRef.current = sliceData;
      setScriptProgress({ completed: 0, total: sliceData.slices.length });
      setPhase('scripting');
      setStatusMsg(`已完成 ${sliceData.slices.length} 段音频切片，正在构思故事并逐条输出 MV 脚本…`);

      const streamRes = await fetch('/api/mv/script-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sliceData.meta?.title || audioFile.name.replace(/\.[^.]+$/, ''),
          artist: sliceData.meta?.artist || '',
          genre,
          visualStyle,
          pace,
          inspiration,
          characters: activeReferences.map((r) => ({ name: r.name, role: r.role })),
          slices: sliceData.slices,
        }),
        signal: controller.signal,
      });

      if (!streamRes.ok) {
        const errData = await streamRes.json().catch(() => ({}));
        throw new Error(errData.error || '无法启动 MV 脚本生成。');
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedShots = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          let eventName = 'message';
          let dataLine = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);

          if (eventName === 'story') {
            setStory(payload);
          } else if (eventName === 'shot') {
            collectedShots[payload.index] = payload;
            setShots((prev) => ({ ...prev, [payload.index]: payload }));
          } else if (eventName === 'progress') {
            setStatusMsg(payload.stage || '');
            setScriptProgress({ completed: payload.completed || 0, total: payload.total || sliceData.slices.length });
          } else if (eventName === 'error') {
            throw new Error(payload.error || 'MV 脚本生成中断。');
          }
        }
      }

      shotsRef.current = collectedShots;
      setPhase('ready');
      setStatusMsg(`MV 脚本已全部生成（共 ${Object.keys(collectedShots).length} 条镜头）。`);

      if (autoGenerateH3 && (!videoConfig || videoConfig.accepted)) {
        const allIndices = sliceData.slices.map((s) => s.index).filter((idx) => Boolean(collectedShots[idx]));
        if (allIndices.length) {
          startVideoQueue(allIndices, sliceData, collectedShots);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'MV 生成流程失败。');
      setPhase(sessionRef.current ? 'ready' : 'idle');
    }
  }

  const slices = session?.slices || [];
  const completedVideoEntries = slices
    .map((s) => ({ slice: s, job: jobs[s.index] }))
    .filter(({ job }) => job?.status === 'completed' && Boolean(job.url));
  const pendingIndices = slices
    .map((s) => s.index)
    .filter((i) => shots[i] && !(jobs[i]?.status === 'completed' && jobs[i]?.url));
  const allScriptedIndices = slices.map((s) => s.index).filter((i) => Boolean(shots[i]));
  const price = videoConfig?.pricing?.find((p) => p.resolution === '768p');

  async function handleMergeMv() {
    if (!session?.sessionId || !completedVideoEntries.length) return;
    setMerging(true);
    setError('');
    try {
      const res = await fetch('/api/mv/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          videoIds: completedVideoEntries.map(({ job }) => job.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '合成完整 MV 失败。');
      setMergedUrl(`${data.url}?t=${Date.now()}`);
      setVideoMessage('完整 MV 已合成并锁定原曲音轨！');
    } catch (err) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  async function handleZipVideos() {
    if (!completedVideoEntries.length) return;
    setPacking(true);
    try {
      await downloadZip(
        completedVideoEntries.map(({ slice, job }) => ({
          name: `${slice.shotId}.mp4`,
          url: job.url,
        })),
        `${(story?.title || session?.meta?.title || 'music-mv').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.zip`,
        setVideoMessage,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setPacking(false);
    }
  }

  function openPlaylist() {
    if (!completedVideoEntries.length) return;
    setPlaylist(
      completedVideoEntries.map(({ slice, job }) => ({
        label: `${slice.shotId} · ${slice.timestamp}`,
        text: slice.lyrics,
        url: job.url,
      })),
    );
  }

  const busyInput = phase === 'slicing' || phase === 'scripting';

  return (
    <div className="mv-studio">
      {playlist && <MediaPlaylist items={playlist} type="video" onClose={() => setPlaylist(null)} />}

      <form onSubmit={handleStartMv}>
        <fieldset disabled={busyInput} className="brief-fieldset">
          {/* 01 MP3 & LRC Upload */}
          <section className="mv-section">
            <div className="section-heading">
              <h2><span>01</span>{t('上传歌曲与歌词')}</h2>
              <span className="section-note">{t('支持 MP3 / WAV 与带时间戳的 LRC 歌词')}</span>
            </div>

            <div className="mv-upload-grid">
              <div className="mv-upload-card">
                <div className="mv-upload-header">
                  <div>
                    <strong><Music size={15} /> {t('上传 MP3 歌曲')}</strong>
                    <p>{t('系统将按设定节奏自动精确切片，并保留原曲驱动 MiniMax H3 画面律动。')}</p>
                  </div>
                  <label className="small-button save-image upload-button">
                    <Upload size={13} /> {t(audioFile ? '更换音频' : '选择 MP3 / WAV')}
                    <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={handleAudioUpload} />
                  </label>
                </div>
                {audioFile ? (
                  <div className="mv-audio-preview">
                    <div className="mv-audio-meta">
                      <span>{audioFile.name}</span>
                      <small>
                        {formatClock(audioFile.duration)} · {t('预计切分')} {estimatedSlices} {t('段')}（{pace}s/{t('镜')}）
                      </small>
                    </div>
                    <audio controls src={audioFile.objectUrl} />
                  </div>
                ) : (
                  <div className="mv-empty-drop">{t('尚未上传音频文件（最大 35 MB，最长 10 分钟）')}</div>
                )}
              </div>

              <div className="mv-upload-card">
                <div className="mv-upload-header">
                  <div>
                    <strong><Sparkles size={15} /> {t('上传或粘贴 LRC 歌词')}</strong>
                    <p>
                      {lrcFileName
                        ? `${lrcFileName} · ${parsedLrc.lines.length} ${t('行时间戳歌词')}`
                        : parsedLrc.lines.length
                          ? `${t('已识别')} ${parsedLrc.lines.length} ${t('行时间戳歌词')}${parsedLrc.meta.title ? ` · ${parsedLrc.meta.title}` : ''}`
                          : t('支持 [00:12.34] 格式，也可留空由纯音乐节奏生成。')}
                    </p>
                  </div>
                  <label className="small-button upload-button">
                    <Upload size={13} /> {t('导入 .lrc 文件')}
                    <input type="file" accept=".lrc,.txt,text/plain" onChange={handleLrcUpload} />
                  </label>
                </div>
                <textarea
                  className="mv-lrc-textarea"
                  value={lrcText}
                  onChange={(e) => setLrcText(e.target.value)}
                  placeholder={t('[00:00.00][Intro] 深夜雨声与合成器前奏\n[00:15.20][Verse 1] 霓虹倒映在潮湿的街角...\n[00:45.00][Chorus] 我们穿过光影奔向黎明...')}
                />
              </div>
            </div>
          </section>

          {/* 02 Style, Genre & Pace */}
          <section className="style-section">
            <div className="section-heading">
              <h2><span>02</span>{t('选择画风与歌曲风格')}</h2>
              <span className="section-note">{t('决定整支 MV 的视觉质感与剪辑节奏')}</span>
            </div>
            <div className="style-grid" role="radiogroup" aria-label={t('MV 画风选择')}>
              {VISUAL_STYLES.map((s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={visualStyle === s.id}
                  className={`style-card ${s.cls} ${visualStyle === s.id ? 'selected' : ''}`}
                  key={s.id}
                  onClick={() => setVisualStyle(s.id)}
                >
                  <div className="art" aria-hidden="true">
                    <span className="art-sun" />
                    <span className="art-building b1" />
                    <span className="art-building b2" />
                    <span className="art-building b3" />
                    <span className="art-floor" />
                    <span className="art-person" />
                    <span className="art-orbit" />
                  </div>
                  <span className="card-index">{s.en}</span>
                  <span className="selection">{visualStyle === s.id && <Check size={14} />}</span>
                  <div className="card-info">
                    <div>
                      <h3>{t(s.name)}</h3>
                      <p>{t(s.description)}</p>
                    </div>
                    <span className="style-number">{s.number}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="mv-subblock">
              <div className="mv-sublabel">{t('歌曲风格')}</div>
              <div className="mv-genre-grid" role="radiogroup" aria-label={t('歌曲风格')}>
                {MUSIC_GENRES.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={genre === g.id}
                    className={`mv-genre-pill ${genre === g.id ? 'active' : ''}`}
                    onClick={() => setGenre(g.id)}
                  >
                    <strong>{t(g.name)}</strong>
                    <span>{g.en}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mv-subblock">
              <div className="mv-sublabel">{t('自动切片节奏与画幅')}</div>
              <div className="pace-grid" role="radiogroup" aria-label={t('切片节奏')}>
                {[5, 10].map((p) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pace === p}
                    className={`pace-option ${pace === p ? 'active' : ''}`}
                    key={p}
                    onClick={() => setPace(p)}
                  >
                    <span className="pace-icon">{p === 5 ? <Zap size={21} /> : <MoveRight size={24} />}</span>
                    <span className="pace-label">
                      <strong>{t(p === 5 ? '快节奏切片' : '慢节奏切片')}</strong>
                      <small>{t(p === 5 ? '紧凑卡点切换，适合燃系/电子/流行' : '长镜头情绪流动，适合抒情/古风/电影感')}</small>
                    </span>
                    <span className="seconds">{p}<small>{t('秒 / 镜头')}</small></span>
                    <span className="radio-dot" />
                  </button>
                ))}
              </div>
              <div className="mv-aspect-row">
                <span>{t('MV 画幅')}：</span>
                {['16:9', '9:16', '21:9', '1:1'].map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`small-button ${aspect === ratio ? 'save-image' : ''}`}
                    onClick={() => setAspect(ratio)}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 03 Optional Inspiration */}
          <section className="content-section">
            <div className="section-heading">
              <h2><span>03</span><label htmlFor="mv-inspiration">{t('MV 叙述感觉 / 灵感（可选）')}</label></h2>
              <span className="section-note">{t('告诉 AI 你想要的剧情氛围、意象或情绪转折')}</span>
            </div>
            <div className="text-wrap">
              <textarea
                id="mv-inspiration"
                maxLength={4000}
                value={inspiration}
                onChange={(e) => setInspiration(e.target.value)}
                placeholder={t('例如：一位孤独的未来旅人在雨夜霓虹都市中寻找记忆碎片，副歌时推开天台之门，城市灯光化作金色星海……（留空则由 AI 根据歌词自动构思故事）')}
              />
              <div className="textarea-footer">
                <span><span className="tiny-square" /> {t('将与歌词时间轴深度融合生成逐条分镜')}</span>
                <span>{inspiration.length} / 4,000</span>
              </div>
            </div>
          </section>

          {/* 04 Reference Characters / Images */}
          <section className="mv-section">
            <div className="section-heading">
              <h2><span>04</span>{t('参考人物 / 参考图（可选）')}</h2>
              <span className="section-note">{t('可直接选用系统默认参考，或上传用其他 AI 生成的人物图')}</span>
            </div>

            <div className="mv-preset-grid">
              {DEFAULT_MV_REFERENCES.map((preset) => {
                const selected = selectedPresets.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`mv-preset-card ${selected ? 'selected' : ''}`}
                    onClick={() => togglePreset(preset.id)}
                  >
                    {presetImages[preset.id] && <img src={presetImages[preset.id]} alt={preset.name} />}
                    <span className="selection">{selected && <Check size={13} />}</span>
                    <div className="mv-preset-info">
                      <strong>{t(preset.name)}</strong>
                      <small>{t(preset.tag)}</small>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mv-custom-refs">
              <div className="mv-custom-header">
                <label className="small-button upload-button">
                  <Upload size={13} /> {t('上传自定义参考人物 / 参考图')}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCustomRefUpload} />
                </label>
                <span className="image-hint">{t('最多同时使用 4 张参考图；若未勾选，将自动匹配所选画风的默认参考图。')}</span>
              </div>

              {customRefs.length > 0 && (
                <div className="mv-custom-list">
                  {customRefs.map((ref, idx) => (
                    <div className="mv-custom-item" key={ref.id}>
                      <img src={ref.image} alt={ref.name} />
                      <input
                        type="text"
                        value={ref.name}
                        maxLength={40}
                        aria-label={t('参考人物名称')}
                        onChange={(e) =>
                          setCustomRefs((prev) =>
                            prev.map((item, n) => (n === idx ? { ...item, name: e.target.value } : item)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="small-button"
                        onClick={() => setCustomRefs((prev) => prev.filter((_, n) => n !== idx))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </fieldset>

        <div className="mv-auto-row">
          <label className="mv-auto-toggle">
            <input
              type="checkbox"
              checked={autoGenerateH3}
              onChange={(e) => setAutoGenerateH3(e.target.checked)}
            />
            <span>{t('脚本逐条输出完成后，全自动生成全部 MiniMax H3 视频')}</span>
          </label>
          <button className="submit" type="submit" disabled={busyInput || !audioFile}>
            {busyInput ? <LoaderCircle className="spin" size={18} /> : <Wand2 size={18} />}
            {t(phase === 'slicing' ? '正在切片音频…' : phase === 'scripting' ? '正在逐条输出脚本…' : '自动切片并生成 MV 脚本')}
          </button>
        </div>

        {error && <div className="feedback error" role="alert">{t(error)}</div>}
      </form>

      {/* Live Streaming Story + Timeline + MiniMax H3 Studio */}
      {(session || phase === 'scripting') && (
        <section className="mv-workspace">
          <div className="mv-workspace-header">
            <div>
              <div className="eyebrow"><span /> MUSIC VIDEO PRODUCTION</div>
              <h2>{story?.title || session?.meta?.title || t('正在构思 MV 故事…')}</h2>
              <p className="speech-status" role="status">
                {t(statusMsg)}
                {scriptProgress.total > 0 && ` · ${scriptProgress.completed}/${scriptProgress.total}`}
              </p>
            </div>
            <div className="speech-actions">
              {videoBusy ? (
                <button type="button" className="small-button generation-stop" onClick={stopVideoGeneration}>
                  <Square size={13} /> {t('停止 H3 生成')}
                </button>
              ) : (
                <button
                  type="button"
                  className="small-button save-image"
                  disabled={busyInput || !allScriptedIndices.length || (videoConfig && !videoConfig.accepted)}
                  onClick={() => startVideoQueue(pendingIndices.length ? pendingIndices : allScriptedIndices)}
                >
                  <Video size={14} /> {t(completedVideoEntries.length && pendingIndices.length ? '继续生成剩余 H3 视频' : '全自动生成全部 MiniMax H3 视频')}
                </button>
              )}
              <button
                type="button"
                className="small-button"
                disabled={!completedVideoEntries.length}
                onClick={openPlaylist}
              >
                <Play size={13} /> {t('连续预览片段')} ({completedVideoEntries.length})
              </button>
              <button
                type="button"
                className="small-button"
                disabled={merging || videoBusy || !completedVideoEntries.length}
                onClick={handleMergeMv}
              >
                <Layers size={13} /> {t(merging ? '正在合成完整 MV…' : '一键合成完整 MV')}
              </button>
              <button
                type="button"
                className="small-button"
                disabled={packing || !completedVideoEntries.length}
                onClick={handleZipVideos}
              >
                <Download size={13} /> {t(packing ? '正在打包…' : '下载 ZIP')}
              </button>
            </div>
          </div>

          {videoConfig && !videoConfig.accepted && (
            <p className="tts-error" role="alert">
              {t('请先在 ai& 控制台 Playground 接受视频服务条款，然后')}
              <button type="button" className="small-button" onClick={loadVideoConfig}>{t('重新检查权限')}</button>
            </p>
          )}

          <p className="tts-note">
            {price
              ? `${t('MiniMax H3 报价')} ${price.per_second} ${price.currency} / ${t('秒')} · ${t('共')} ${slices.length} ${t('个切片')}（${slices.length * pace}s），${t('预计')} ${(slices.length * pace * Number(price.per_second)).toFixed(2)} ${price.currency}。`
              : t('MiniMax H3 · 768p · 原曲切片音频驱动')}
            {videoBusy && ` ${t('队列剩余')} ${queue.length} ${t('条')}。`}
            {videoMessage && ` ${t(videoMessage)}`}
          </p>

          {story && (
            <div className="mv-story-card">
              <div className="mv-story-badge"><Film size={14} /> {t('AI 导演故事大纲')}</div>
              <p className="mv-storyline">{story.storyline}</p>
              <div className="mv-story-meta">
                <span><strong>{t('视觉母题')}：</strong>{story.visual_theme}</span>
                <span><strong>{t('光影色彩')}：</strong>{story.color_palette}</span>
              </div>
            </div>
          )}

          {mergedUrl && (
            <div className="mv-merged-card">
              <div className="dialogue-heading">
                <h3>{t('完整合成 MV（已锁定原曲音轨）')}</h3>
                <a className="small-button save-image" href={mergedUrl} download={`${story?.title || 'music-mv'}.mp4`}>
                  <Download size={13} /> {t('下载完整 MV (MP4)')}
                </a>
              </div>
              <video controls src={mergedUrl} />
            </div>
          )}

          <div className="mv-shot-list">
            {slices.map((slice) => {
              const shot = shots[slice.index];
              const job = jobs[slice.index];
              const isQueued = queue.includes(slice.index);
              return (
                <article className={`project-article mv-shot-card ${shot ? 'is-ready' : 'is-pending'}`} key={slice.index}>
                  <div className="dialogue-heading">
                    <h3>
                      {slice.shotId}
                      <small>{slice.timestamp}</small>
                      <span className="mv-tag">{shot?.section || slice.section}</span>
                      {shot?.mood && <span className="mv-tag muted">{shot.mood}</span>}
                      {shot?.camera && <span className="mv-tag muted">{shot.camera}</span>}
                    </h3>
                    <div className="speech-actions">
                      <button
                        type="button"
                        className="small-button"
                        disabled={videoBusy || !shot || (videoConfig && !videoConfig.accepted)}
                        onClick={() => startVideoQueue([slice.index])}
                      >
                        {t(job?.url ? '重新生成 H3' : '生成本段 H3')}
                      </button>
                    </div>
                  </div>

                  <div className="mv-slice-bar">
                    <span className="mv-lyric-text">♪ {slice.lyrics}</span>
                    {slice.audioUrl && <audio controls preload="none" src={slice.audioUrl} />}
                  </div>

                  {shot ? (
                    <div className="storyboard-layout">
                      <div>
                        <div className="mv-transition-note">
                          <strong>{t('转场设计')}：</strong>{shot.scene_transition}
                        </div>
                        <label className="voice-label" htmlFor={`mv-vp-${slice.index}`}>
                          {t('分镜动态提示词')} <span>{shot.video_prompt.length} / 6,000</span>
                        </label>
                        <textarea
                          id={`mv-vp-${slice.index}`}
                          className="voice-textarea mv-prompt-area"
                          value={shot.video_prompt}
                          disabled={videoBusy}
                          onChange={(e) => updateShot(slice.index, { video_prompt: e.target.value })}
                        />
                        <label className="voice-label" htmlFor={`mv-ip-${slice.index}`}>
                          {t('核心构图提示词')} <span>{shot.image_prompt.length} / 800</span>
                        </label>
                        <textarea
                          id={`mv-ip-${slice.index}`}
                          className="voice-textarea"
                          value={shot.image_prompt}
                          disabled={videoBusy}
                          onChange={(e) => updateShot(slice.index, { image_prompt: e.target.value })}
                        />
                        <div className="continuity-control">
                          <label>
                            <input
                              type="checkbox"
                              checked={shot.use_previous_frame === true}
                              disabled={slice.index === 0 || videoBusy}
                              onChange={(e) => updateShot(slice.index, { use_previous_frame: e.target.checked })}
                            />
                            {t('使用上一镜头尾帧作为起始衔接参考')}
                          </label>
                        </div>
                      </div>

                      <div className="video-preview-column">
                        <div className="video-preview">
                          {job?.url ? (
                            <video controls preload="metadata" src={job.url} />
                          ) : (
                            <div>
                              <span>{isQueued || (job && !isTerminal(job)) ? '◌' : '▶'}</span>
                              <p>{t(job ? STATUS_LABELS[job.status] || '正在处理视频任务' : isQueued ? '排队等待生成' : '等待生成 MiniMax H3 视频')}</p>
                              <small>MINIMAX H3 · {slice.duration}S · {aspect}</small>
                            </div>
                          )}
                        </div>
                        {job?.error && <p className="tts-error" role="alert">{t(job.error)}</p>}
                        {job?.url && (
                          <div className="mv-video-actions">
                            <a className="small-button" href={job.url} download={`${slice.shotId}.mp4`}>
                              {t('下载 MP4')}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mv-shot-skeleton">
                      <LoaderCircle className="spin" size={16} />
                      <span>{t('正在等待 AI 逐条输出此切片的分镜脚本…')}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
