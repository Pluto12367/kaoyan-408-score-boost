# 品牌风格预览(主题 d 候选)

为"新增主题 d"做的三套品牌风格对比稿,与 `design/option-c-mockups/` 同级、同为**静态设计决策素材**:不接入应用、不修改现有 abc 三主题、不包含真实业务数据。

## 打开方式

直接双击 `index.html`(或任一品牌页)在浏览器打开,无需构建、无外部依赖。

- `index.html` —— 对比入口
- `linear.html` —— 近黑 `#010102` 画布、薰衣草蓝 `#5E6AD2`、hairline 细线、表面阶梯分层
- `notion.html` —— 白底、签名紫 `#5645D4` CTA、暖炭黑 `#37352F` 文字、粉彩分类卡
- `claude.html` —— 奶油 `#FAF9F5` 画布、珊瑚红 `#CC785C`、衬线大标题、深色精选卡
- `preview-base.css` —— 共享结构样式;所有颜色/圆角/阴影/字体来自各页 `--p-*` 品牌变量

## 设计含义

三个页面共用同一份结构 CSS,视觉差异完全由 `--p-*` 变量驱动——这正是本项目主题系统的目标模式(纯 token 覆盖,而非逐类名覆盖)。选定品牌后,阶段 4 将以 `html[data-theme="d"]` 的纯 token 覆盖块落地到 `apps/web/src/styles.css`,并在 `themePreference.ts` 注册。

## 来源与许可

色板与规则参考 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)(MIT)中的 `linear.app` / `notion` / `claude` DESIGN.md,按本项目架构重新实现。两处已标注的偏差:

- Linear 规范不含警告/危险色,预览中的 `#F2C94C` / `#EB5757` 是为学习场景(待复习/错误)扩展的;
- Claude 中文衬线用系统宋体近似(Copernicus 为商用字体),不引入任何外部字体资源。
