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
