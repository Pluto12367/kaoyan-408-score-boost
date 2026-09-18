# CSV import workflow

The current import-ready starter bank is:

```text
kaoyan-408-content-starter/imports/starter-320-questions.csv
```

It contains 320 original starter questions across 16 knowledge points.

Regenerate the starter bank:

```bash
npm run questions:generate-starter
```

Validate the file without touching the database:

```bash
npm run questions:import:dry-run
```

Import into the configured PostgreSQL database:

```bash
npm run questions:import
```

Import another CSV file:

```bash
npm run questions:import -- path/to/questions.csv
```

Update existing questions with the same stem, source, and year:

```bash
npm run questions:import -- path/to/questions.csv --replace
```

Required CSV columns:

```text
stem,options,answer,analysis,knowledgePointIds,difficulty,type,source,year,expectedTimeSec
```

Use `|` to separate multiple options or knowledge point ids.

## Optional columns: 408 scoring & type foundation (V13-P0-1 / PHASE 8)

These three columns are optional and follow one uniform policy: **absent
stays absent** (unknown / unpriced / no rubric — never guessed, never
defaulted), and a **provided but invalid value is a hard error** so author
intent cannot silently degrade.

```text
questionSubtype, maxScore, 判分标准
```

- `questionSubtype` — the 408 business question type. One of (English code or
  Chinese label): `SINGLE_CHOICE` 单选题 · `JUDGEMENT` 判断题 ·
  `COMPREHENSIVE_CHOICE` 综合选择题 · `ALGORITHM` 算法大题 ·
  `CO_COMPUTATION` 组成原理计算题 · `OS_PV` OS PV 题 · `CN_ROUTING` CN
  路由计算题. (Historical rows may still be NULL = unknown.)
- `maxScore` — the question's highest obtainable score in the 408 exam
  (objective single choice = `2`). `NULL` means unpriced; **0 means a real
  zero-point question** — the two are never conflated.
- `判分标准` — the large-question rubric as a JSON string, `rubric-v1` shape:

```json
{"version":1,"totalPoints":6,"criteria":[
  {"id":"c1","description":"写出信号量定义","points":2,
   "evidenceHint":"出现信号量定义","matchAny":["信号量","semaphore"]},
  {"id":"c2","description":"给出 P/V 顺序","points":4,
   "evidenceHint":"P/V 次序正确","matchAny":["P(","V("]}
]}
```

Rules enforced by the importer (shared validator, same one the scoring path
uses): every criterion needs `id`/`description`/`evidenceHint`/`matchAny`;
criterion `points` must be positive; the sum of `points` must equal
`totalPoints`; duplicate ids are rejected. Malformed JSON or a failed
validation blocks the row (`INVALID_RUBRIC`) — nothing is stored.

Large-question rows (ALGORITHM / CO_COMPUTATION / OS_PV / CN_ROUTING) only
become student-trainable when they are **both priced and rubric-authored** —
check the live state any time (read-only):

```bash
npm run audit:large-question-content
```

The audit prints per-subtype question / priced / rubric / trainable counts and
an honest verdict; real exam content must come from an identifiable source
(真题/权威答案/官方分值) — anything unverifiable stays `UNVERIFIED`, and
reviewer confirmation is still required before content counts as approved.

Current starter ids:

```text
ds-list
ds-tree
ds-graph
ds-sort
co-data
co-cache
co-instruction
co-cpu
os-process
os-sync
os-memory
os-file
net-link
net-ip
net-tcp
net-app
```
