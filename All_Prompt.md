Here is the complete translation into natural, clear English suitable for technical specifications, documentation, or prompts:

---

Next, I want to build a functional Web site for a Director's Console / Studio Dashboard. Let's build this step by step, going from basic to advanced.

First, let's create the entry interface with the following layout:

1. **Art Style Selection**: Real 3D, Japanese Anime, 2.5D Effect
2. **Animation Pacing Selection**: Fast-paced (5s), Slow-paced (10s)
3. **Content Input**: A large `textarea`
4. **Button**: "Help Me Script It"

**Theme & Styling**: Dark theme, Neon Green main accent color, white text, with a sleek and tech-forward overall feel.

Since this will communicate with a local CLI later, please consider whether to use React, SvelteKit, or another framework capable of backend interaction.

---

Alright, next comes the interesting part, which is also the main challenge of this program.

You will combine the selected art style, pacing settings, and inspiration prompt into a text prompt. Then, via the `aiand` CLI tool installed on my local machine, invoke the locally installed skill `direct-h3-storyboards` to execute the task. Upon completion, `direct-h3-storyboards` will return a JSON payload, which you will then return to my website. Finally, referencing my existing website `001_CloudJsonView`, the website will render and visualize the returned JSON data.

* `aiand` Official Docs: [https://docs.aiand.com/](https://docs.aiand.com/)
* Model to use: `deepseek-ai/deepseek-v4.1-flash` via `aiand`
* `aiand` API key: 
---

Great, now let's make some visual and UI adjustments:

1. **Pagination / Multi-page Navigation**
When the user clicks "Help Me Script It", switch to a dedicated processing page while the AI handles the request. Once finished, navigate to a new screen displaying the "Creation Plan" (including character showcases, audio showcases, etc.), rather than staying on the same page or rendering a long scrolling single page.
2. **Display AI Processing Status**
During communication with the AI skill, the waiting time can be long. To prevent users from wondering what's happening, add real-time text progress updates on the page (e.g., "Currently processing: ...") so users can see the current status.

---

Next UI revisions:

* Hide / do not display the "Creation Plan" overview section; jump straight into "Character Showcase".

**"Character Showcase" Page Modifications**:

* Next to "Character Settings / Image Prompt", add a small "Copy" button to copy the current prompt.
* Adjust the layout of the prompt section: Left side displays the prompt, Right side provides an image upload feature. The goal is to let me copy the prompt, generate an image using an external service, and upload it back here. So it needs Upload, Preview, and Save functionality.
* Hide "Reference Boards" and "Fixed Voice/Timbre Settings".

**"Audio Design" Page Modifications**:

* Hide all "BGM / Music Design" elements.
* Referencing `001_CloudJsonView`, implement "Read All" and "Read Line by Line" audio preview functionality.
* Hide "Audio Plan".

---

Next, let's add a slightly more complex feature.
On the "Audio Design" page, I want to use `edge-tts` to handle voice generation.
This should likely be handled via backend integration, but I'll leave the implementation details to you.

**UI Requirements**:

1. A "Generate All Audio" button.
2. An individual "Generate Audio" button for each audio line.
3. An editable `textarea` for each line of dialogue/audio script.

---

Next, adding a advanced feature to the "Storyboard Showcase" page.
I want to use the "Videos" capability provided by `ai&` (specifically "MiniMax H3 video") to generate "MP4 with audio at 768p" animations.
API Documentation reference: [https://docs.aiand.com/api/videos/](https://docs.aiand.com/api/videos/)
This should also be handled through backend integration, leaving the specifics to you.

**UI Requirements**:

1. A "Generate All Animations" button.
2. An individual "Generate Animation" button for each storyboard panel.
3. An editable `textarea` for each storyboard prompt / first-frame prompt.
4. Storyboard prompt row layout: Prompt on the left, generated video player/preview on the right.

Once all animations are generated, add a "Download Generated Animations" feature to package everything into a `.zip` file for download.
Similarly, on the "Audio Design" page, add a "Download Generated Audio" feature to package all generated audio files into a `.zip` download.

---

Can we also add a JSON import/export capability? Sometimes re-generating everything after system or layout changes is very costly. Saving the state to JSON and allowing users to import JSON at startup would save time and API costs.
The exported JSON should store edited text content, generated file paths, and output metadata.