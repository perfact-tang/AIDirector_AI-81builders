# AI DIRECTOR · 导演台

React + Vite 前端，Express 本地后端，通过 `aiand run` 调用 DeepSeek 并执行本地导演 skill 的完整指令。

## 启动

需要 Node.js 22.12+、本地 `aiand` CLI 和 `direct-h3-storyboards` skill。

```sh
npm install
cp .env.example .env
# 在 .env 填入 AIAND_API_KEY（已有 .env 时不要覆盖）
npm run dev
```

打开 http://127.0.0.1:5173/ 。生产运行：`npm run build`，然后 `npm start`，访问 http://127.0.0.1:3001/ 。

## 生成链路

1. `POST /api/scripts` 校验画风、每镜头秒数与源文，返回异步任务 ID。
2. 后端读取 skill 的 SKILL.md、四份必读参考、项目模板，通过固定参数的 `spawn` 调用 `aiand run --model deepseek-ai/deepseek-v4.1-flash`。源文通过 stdin 传入，无 shell 拼接。
3. CLI 的一次性推理接口不自动发现 skill，因此由后端显式加载完整 skill 上下文；本地校验脚本由后端执行。
4. 解析模型 JSON，运行 skill 自带 `validate_storyboard.mjs`，验证所有镜头符合所选时长。失败最多修正两次，每次修正都会调用模型。
5. `GET /api/scripts/:id` 返回进度、错误或通过校验的完整 JSON。网页展示创作方案、人物、声音、可搜索分镜，并支持下载 JSON。

`.env` 被 Git 忽略，仅后端加载；不要使用 VITE_ 前缀保存密钥。可通过 `AIAND_BIN`、`DIRECTOR_SKILL_PATH` 指定 CLI 和 skill 路径。默认 skill 路径为 `~/.agents/skills/direct-h3-storyboards`。

草稿保存在 localStorage，当前任务 ID 保存在 sessionStorage，刷新页面可恢复查询。任务及结果仅存于后端内存，服务重启后丢失；完成任务保留最多约一小时（新提交时清理）。请及时下载结果。每次仅执行一个生成任务，模型请求最多等待 15 分钟，完整任务最多三次模型调用。CLI 错误不会向浏览器泄露原始错误或密钥。

## 验证

`npm test` 验证异步任务、失败返回、源文组合、截断检测和跨站提交拦截；使用 mock 避免测试消耗模型额度。`npm run build` 验证前端构建。实际模型调用需通过网页提交。

## 页面流程

- `/` 填写创作需求。
- `/processing?job=<id>` 显示处理阶段、已用时间和真实阶段记录；刷新后继续查询。
- `/project?job=<id>` 展示已完成的方案、人物、声音和分镜；可返回修改需求。

任务 API 包含 `events: [{stage, at}]`，记录真实阶段切换。模型调用采用非流式 JSON 返回，生成内部的逐步进度不可见，因此页面不会显示虚构百分比。

## 人物图片与朗读

结果页默认展示人物。复制人物提示词，在外部服务生成图片后可上传 PNG/JPG/WebP（最大 10 MB），预览后点击“保存图片”。图片按项目和人物隔离存入当前浏览器的 IndexedDB；清除网站数据会删除本地图片，下载项目 JSON 可携带已保存图片备份。未点击保存的预览不会写入存储或导出文件。

声音设计展示逐镜头台词，支持全部顺序朗读、逐条朗读、暂停/继续与停止，并跳过无对白镜头。朗读复用参考站点的 Web Speech 实现，使用设备内置语音；可选中文、日文、英文、韩文。语音不可用或尚未加载时显示提示，切换页面或语言会停止当前朗读。

## Edge TTS 配音生成

后端使用项目 Python 虚拟环境调用 Edge TTS，将台词通过 stdin 传入，不使用 shell 拼接。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-tts.txt
```

声音设计页提供可编辑台词（每条最多 5,000 字）、中/日/英/韩男女音色、逐条生成与按顺序生成全部配音。空台词跳过；批量失败可逐条重试。生成时显示进度，禁止同时修改台词；改词或更换音色后旧音频仍可试听，但会标记过期且不会作为最新配音导出。

`POST /api/tts` 接收 `{text,voice}`，返回 MP3 地址；`GET /api/tts/voices` 返回支持音色。最多两个并发请求，每条超时 90 秒。MP3 按文本与音色的哈希缓存在 `.local/audio/`，该目录和 `.venv/` 均不会提交 Git。可用 `EDGE_TTS_PYTHON` 指定其他 Python 环境。

台词和音频会持久化至浏览器 IndexedDB，下载的项目 JSON 携带修改后的台词和未过期的内嵌音频。Edge TTS 使用 Microsoft 在线服务，需要网络；文本会发送至该服务。生成音频不会自动裁剪或拉伸到镜头长度。设备内置语音的朗读功能仍可独立使用。

## MiniMax H3 动画与 ZIP

分镜页提供可编辑的分镜提示词与首帧提示词、逐镜头生成、顺序批量生成、右侧 MP4 预览和动画 ZIP 下载。声音页提供已生成配音 ZIP 下载。打包使用浏览器本地 fflate，不向第三方上传文件；为限制内存，每次最多打包 512 MB，失败不会静默遗漏文件。

后端直接使用 ai& Videos REST API，模型固定为 `minimaxai/minimax-h3`，通过服务端 `AIAND_API_KEY` 鉴权。输出为 768p 带音轨 MP4，不发送不受支持的 resolution 参数。画幅必填，镜头可选 4–15 秒；页面从模型目录读取当前账户价格。提交视频不能撤销，完成才收费。视频权限需用户本人先在 ai& 控制台接受服务条款，应用只检查状态，不代替用户同意条款。

- `GET /api/videos/config` 查询接受状态与报价。
- `POST /api/videos` 接收客户端唯一 `requestId`、`prompt`、`firstPrompt`、`seconds`、`aspect`，以及可选的 `image` / `audio` base64 data URL。
- `GET /api/videos/:id` 查询任务，最多每 15 秒向上游刷新一次。审核、翻译、排队、生成、失败均展示真实状态。
- `GET /api/videos/:id/content` 播放或下载已缓存的 MP4，支持 Range。

生成统一采用配音优先的 `references.images` + `references.audio`。当前镜头的已生成配音为主要参考；分镜提示词中出现的人物姓名或别名会匹配人物展示中已保存的图片，按首次提及顺序上传，并写出明确的 `<Picture N>` 映射。角色缺图时不会提交。无人物镜头需手动上传场景参考图，满足音频必须有视觉参考的接口限制。首帧提示词仅作为画面构图补充，不会自动生成图片。

任务记录和 MP4 持久化在 Git 忽略的 `.local/videos/`。客户端草稿、批量队列和任务编号保存在 IndexedDB。刷新后使用相同编号继续查询/处理，后端不会重复提交相同编号的收费任务。网络中断时批量暂停，可点击继续，仍复用原任务编号。若提交结果不确定，需先在 ai& 控制台核对，不应盲目新建任务。上游失败会显示错误并可手动重试。

配音是必需输入，不能回退到 H3 重新配音。后端先用 ffprobe 检查音频时长，超过所选镜头时长则在上传与收费提交前报错；请延长镜头（最多 15 秒）或拆分台词。模型提示要求画面、口型、动作以配音为主，人物图片仅控制身份与外观；模型返回的声音仅作原始输出保留；最终 MP4 会通过 FFmpeg 使用用户原始配音重新制作音轨（转 AAC，尾部补静音），视频画面使用 stream copy，不重新编码。这样不会把模型生成的其他声音当作用户原配音。项目导出包含修改后的提示词、本机视频路径、参考版本与匹配人物；长期备份请使用动画 ZIP。

官方接口文档：https://docs.aiand.com/api/videos/

## 项目 JSON 存档与恢复

入口页点击“读取项目 JSON”可直接打开已保存项目，不调用脚本模型、配音生成或收费视频提交接口。兼容此前下载的 mv-maker-project JSON，以及包含 direction_name / characters / storyboard 的旧式独立项目对象。文件上限 100 MB。

方案页的“保存项目 JSON”包含最新台词、分镜与首帧提示词、人物图片、音色、内嵌配音、本地动画路径、动画任务 ID / 上游 ID、画幅、秒数、首帧参考图片和过期状态所需的版本信息。新增 `director_workspace` 字段保留编辑器工作状态；通用 project 字段也同步最新文本和素材。图片需点击保存后进入存档。

导入项目使用 `/project?local=<id>`，保存在当前浏览器 IndexedDB，刷新可继续编辑。每次导入使用独立工作区，避免被同名项目的旧缓存覆盖。导入存档不会恢复收费 POST 队列；未完成动画仅通过 GET 查询原任务编号，尚未提交的排队镜头需要手动生成。读取文件、打开已有动画、导出 JSON 和 ZIP 均不重新生成素材。

MP4 不内嵌在 JSON，以免文件过大；它的 `/api/videos/<id>/content` 路径依赖原电脑项目下 `.local/videos/` 的 MP4 与任务记录。系统升级时请保留 `.local` 目录，并同时下载动画 ZIP 作为独立备份；移动电脑时仅有 JSON 不能恢复已删除的 MP4 文件。音频路径也会保存，已内嵌的配音无需原音频缓存即可播放。素材路径失效时页面提示检查原本机文件，不自动重新生成。

### 配音优先视频依赖与版本检测

需要本机提供 FFmpeg 的 `ffprobe`（macOS 可通过 `brew install ffmpeg` 安装），或在 `.env` 配置 `FFPROBE_BIN=/absolute/path/to/ffprobe`。当前机器已安装并验证读取实际 MP3。

人物姓名匹配支持中英文混排、括号中的别名和可选的 `characters[].aliases` 数组，避免 Ann/Anna 等子串误匹配。多人物参考最多 9 张（包含可选场景图）；所有被点名的人物必须有已保存的 PNG/JPEG/WebP 图片。已生成的配音必须与当前台词、音色一致。只有本地路径的旧配音会先读取为可上传的音频数据，无需重新配音。

配音或人物图片变化会改变 `referenceKey`，旧动画显示需要重新生成。JSON 存档保留该版本与人物名称。旧版没有配音的人物/纯文本视频仍可播放、下载，不自动再生成；旧收费提交队列迁移为只读任务查询。批量生成只处理所需素材齐全的镜头，缺失项在各镜头下明确提示。

### 人物冲突与音轨锁定修复

执行提示词编译为“图片身份优先 + 场景动作”：对旧 skill 文本提取 detailed_description / integrated_multimodal_description，不再发送可能与新上传图片冲突的 subject_definitions 与 retention_analysis 外貌描述。图片为人物性别、发色、服装等身份依据；有效提示词可在页面展开查看。模型人物一致性仍需预览核对，图片参考并非自动身份验证。

每个新任务记录实际 submittedRequest、Files API 文件 ID、人物名单及输入文件 SHA-256。生成完成后缓存 `.provider.mp4` 原始返回，再通过 `.narration.mp3` 原始配音制作最终 `.mp4`；混流失败会重试本地处理，不新建收费任务。`audioLocked: true` / `audioPolicy: original-narration-v2` 表示最终输出已使用原始配音，而非模型返回的音轨。

旧视频可点击“使用当前配音修复音轨（免费）”，对应 `POST /api/videos/:id/restore-narration`，只做本机 FFmpeg 处理；保留原始画面与 provider 备份，不调用视频生成。音频超过原视频长度时拒绝修复，避免截断台词。可使用 FFMPEG_BIN 指定 FFmpeg。人物参考变化或提示词编译规则升级后，旧动画会显示过期，需用户主动决定是否重新生成。
