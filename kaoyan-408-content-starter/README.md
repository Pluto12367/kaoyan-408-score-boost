# 408 提分系统内容库

本仓库用于保存 408 提分系统的结构化内容，包括：

- 资料来源
- 知识点
- 知识关系
- 知识卡
- 题目
- 测评卷
- 内容校验脚本
- 内容规范与审核规则

## 快速开始

### 1. 创建虚拟环境

```bash
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 执行内容校验

```bash
python scripts/validate-content.py
```

## 内容状态

推荐使用以下状态：

```text
draft
self_check
content_review
copyright_review
trial
approved
published
deprecated
```
