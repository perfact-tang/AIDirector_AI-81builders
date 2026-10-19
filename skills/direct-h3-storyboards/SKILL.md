---
name: direct-h3-storyboards
description: 为 AI Director 当前表单生成可执行动画项目。支持真实3D、日本动漫、2.5D及固定5或10秒分镜，输出稳定人物ID、图片提示词、明确镜头人物绑定和Edge TTS配音文本，使用脚本计算与校验mv-maker-project v4。
---

# AI Director 应用导演 Skill

以当前程序表单与执行能力为准。输入是 `style`、`pace`、`content`；输出是 `mv-maker-project` v4 JSON。人物图由用户在外部生成，本应用只提供提示词、上传和保存，不调用生图服务。不要要求额外的声音设计、音乐章节、外部 skill、人工角色审核或 ComfyUI 流程才能完成方案。

先读 [应用契约](references/app-contract.md)。当前执行链路是：表单 → 方案 → 外部生成人物图并上传保存 → Edge TTS → 人物图片和当前配音驱动 H3 → 原配音混流。没有生成的素材不要标记为已生成。

## 导演判断

完整保留源文事件、对白、关系和事实；按每镜一个动作组织段落。对白过长要拆镜，不改变用户的5/10秒节奏。为无对白的故事提供简短准确的旁白以适配当前配音流程。画幅默认16:9。画风严格跟随表单，不由题材覆盖。

先锁定项目统一的中文 `visual_style_lock.shared_style_prefix` 和 `shared_negative_prompt`，逐字用于所有人物图片提示词。默认生成单人物全身3/4标准参考图，浅灰背景、清晰面部、固定服装道具；不强制多视图、四表情或中文标注，避免动画生成拼贴。用户明确要求时可以用多视图，但说明各视图是同一个人。

人物使用唯一且稳定的 `character_id`（如CHAR-001）。同名人物也必须有不同ID。修改已有项目保留原ID。每镜的 `character_refs` 按所需参考图片顺序填写ID，无人物写空数组；不能用姓名、数组下标、voice_id或(Sx)代替ID。旁白不必成为可见人物。只引用出现在画面中的人物。

`video_prompt` 直接用中文描述空间、动作、运镜、表演及音频同步；可写人物姓名或 `<Subject N>`，编号仅指向当前镜头 `character_refs` 的第N项，绝不指向全项目人物顺序。程序负责提交时的 `<Picture N>` 映射。首帧描述不得包含拼贴、角色设定板或文字标签。尾帧续接使用 `use_previous_frame`，仅从第二镜起启用。当前运行器只实现图片参考和主配音路线，不伪造首尾帧生成器或音乐生成器。

## 脚本职责与交付

创作判断由模型完成；ID补齐、镜头编号补齐、时间线、总时长、帧数由 `scripts/project_contract.mjs` 的 `normalizeProject(data,{pace})` 完成。它不猜测或修复错误的人物引用。引用缺失、未知ID、重复ID与越界编号由 `validateAppProject` 拒绝并要求模型修正。

独立使用时将JSON交给同一个脚本标准化后保存，并运行 `node scripts/validate_app_project.mjs <project.json>`，修复全部问题。应用内模型没有文件工具，直接返回完整JSON，后端运行标准化和校验，最多修正两次。不要求模型执行无法使用的脚本。

原有详细导演、角色板、音乐和MV Maker参考与 `validate_storyboard.mjs` 留作外部完整MV工作流兼容；它们不构成当前应用的前置条件。应用执行契约优先。
