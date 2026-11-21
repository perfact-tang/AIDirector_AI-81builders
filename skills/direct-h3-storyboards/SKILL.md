---
name: direct-h3-storyboards
description: 为 AI Director 当前表单生成可执行动画项目。支持9种精选画风及固定5或10秒分镜，输出稳定人物ID、差异化场景与转场提示词、明确镜头人物绑定和自然口语化Edge TTS配音文本，使用脚本计算与校验mv-maker-project v4。
---

# AI Director 应用导演 Skill

以当前程序表单与执行能力为准。输入是 `style`、`pace`、`content`；输出是 `mv-maker-project` v4 JSON。人物图由用户在外部生成，本应用只提供提示词、上传和保存，不调用生图服务。不要要求额外的声音设计、音乐章节、外部 skill、人工角色审核或 ComfyUI 流程才能完成方案。

先读 [应用契约](references/app-contract.md) 和 [配音叙述风格与文字转场规范](references/narration-style.md)。当前执行链路是：表单 → 方案 → 外部生成人物图并上传保存 → Edge TTS → 人物图片和当前配音驱动 H3 → 原配音混流。没有生成的素材不要标记为已生成。

## 导演判断

1. **源文覆盖与口语化配音**：完整保留源文事件、观点、对白、关系和事实。所有 `audio_plan.audio_text` 必须严格遵循 `references/narration-style.md` 的自然口语解说风格（说人话、有设问开场、清晰过渡路标、具体例子、客观收束，绝不写书面公文腔或画面元描述）。按每镜一个核心动作或信息点拆镜，5 秒约 16–24 字、10 秒约 34–48 字，对白/讲解过长就自然拆镜，不改变用户的 5/10 秒节奏。画幅默认 16:9。画风严格跟随表单，不由题材覆盖。

2. **统一视觉锁与人物参考**：先锁定项目统一的中文 `visual_style_lock.shared_style_prefix` 和 `shared_negative_prompt`，逐字用于所有人物图片提示词。默认生成单人物全身 3/4 标准参考图，浅灰背景、清晰面部、固定服装道具；不强制多视图、四表情或中文标注，避免动画生成拼贴。用户明确要求时可以用多视图，但说明各视图是同一个人。

3. **稳定人物绑定**：人物使用唯一且稳定的 `character_id`（如 `CHAR-001`）。同名人物也必须有不同 ID。修改已有项目保留原 ID。每镜的 `character_refs` 按所需参考图片顺序填写 ID，无人物写空数组；不能用姓名、数组下标、`voice_id` 或 `(Sx)` 代替 ID。旁白不必成为可见人物，只引用出现在画面中的人物。

4. **无生图模式下的差异化分镜与文字转场**：
   - 严禁相邻镜头出现雷同的 `image_prompt` 或 `video_prompt`！每换一镜，必须在景别、机位角度、空间环境/视觉隐喻、主体动作中至少改变 2 项。
   - `video_prompt` 直接用中文描述**转场方式、空间布置、起势→中段核心动作→结束状态的动态推进、运镜变化及音频同步**；可写人物姓名或 `<Subject N>`，编号仅指向当前镜头 `character_refs` 的第 N 项，绝不指向全项目人物顺序。程序负责提交时的 `<Picture N>` 映射。
   - 首帧描述 `image_prompt` 精准描绘本镜独有的构图、景别、光影与道具，不得包含拼贴、角色设定板或文字标签，也不得与上一镜重复。
   - `use_previous_frame` 规则：`SHOT-001` 必须为 `false`；切换话题、地点或大幅改变景别时必须为 `false`（在 `video_prompt` 中用文字写明硬切/视觉转场进入新场景）；仅在同一空间内连续动作紧接上一镜结尾时才设为 `true`（连续不超过 2 镜），且必须在 `video_prompt` 中写出如何从尾帧立刻推进到新动作与新结束构图，防止下一帧停留在上一帧。

## 脚本职责与交付

创作判断由模型完成；ID 补齐、镜头编号补齐、时间线、总时长、帧数由 `scripts/project_contract.mjs` 的 `normalizeProject(data,{pace})` 完成。它不猜测或修复错误的人物引用。引用缺失、未知 ID、重复 ID、越界编号、相邻镜头提示词高度重复与非法 `use_previous_frame` 由 `validateAppProject` 拒绝并要求模型修正。

独立使用时将 JSON 交给同一个脚本标准化后保存，并运行 `node scripts/validate_app_project.mjs <project.json>`，修复全部问题。应用内模型没有文件工具，直接返回完整 JSON，后端运行标准化和校验，最多修正两次。不要求模型执行无法使用的脚本。

原有详细导演、角色板、音乐和 MV Maker 参考与 `validate_storyboard.mjs` 留作外部完整 MV 工作流兼容；它们不构成当前应用的前置条件。应用执行契约优先。
