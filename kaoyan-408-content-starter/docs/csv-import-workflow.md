# CSV import workflow

The first import-ready CSV is:

```text
kaoyan-408-content-starter/imports/starter-40-questions.csv
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

Use `|` to separate multiple options or knowledge point ids. Current starter ids are
`ds-tree`, `co-cache`, `os-sync`, and `net-tcp`.
