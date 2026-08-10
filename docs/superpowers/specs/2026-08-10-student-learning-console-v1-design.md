# Student Learning Console v1 Design

## 1. Goal

Build a student-facing home learning console so a student can open the system and immediately understand:

- what to do today;
- why those actions matter;
- where to start;
- how to switch into self-directed learning;
- where to check feedback after studying.

This is a product-experience layer over existing learning data. It is not a new planner, recommendation engine, database model, or Retrieval V2 production integration.

## 2. System Location

The feature appears in the student home / overview area as the first visible learning block after login.

Primary location:

```text
student overview / home section
```

Likely frontend integration points:

```text
apps/web/src/App.tsx
apps/web/src/features/student/StudentLearningConsole.tsx
apps/web/src/styles.css
```

Existing modules remain available below or near the console:

```text
TodayPlan
recommended practice
wrong-question review
stage assessment
learning report
knowledge catalog
```

## 3. User-Visible Behavior

The student sees one concise "learning console" that answers four questions.

### 3.1 Today's learning path

Shows two to three recommended steps, derived from existing state:

```text
1. Start the top-priority task from today's plan
2. Review due wrong questions if any exist
3. Practice the current weak point / recommended set
```

Each step has a clear action button. Buttons navigate to existing sections or focus existing components; they do not create a new backend workflow in v1.

### 3.2 Self-directed learning

Shows stable entry points:

```text
practice weak points
practice by subject / recommended set
review wrong questions
take stage assessment
view learning report
open knowledge catalog
```

The goal is to make autonomous study feel legitimate and guided, not hidden behind scattered navigation.

### 3.3 Current learning status

Shows compact status cards from existing data:

```text
today completion
today accuracy
study streak
due wrong-question count
weak-point count or weakest point
```

If a data source is loading, failed, or mock-backed, the console follows the existing ModuleResource behavior and does not silently invent production data.

### 3.4 Next-step suggestion

Shows one plain-language suggestion:

```text
If today's plan has unfinished priority tasks:
  "Start with the highest-priority task first."

If due wrong questions exist:
  "Review due wrong questions before doing new practice."

If today's plan is complete:
  "Continue with weak-point practice or review the report."
```

This is deterministic copy based on existing state, not AI planning.

## 4. Product Objective

This feature directly supports the product goal:

```text
Students know their daily tasks and can also study independently.
```

It turns the student home screen from a collection of modules into a daily learning command center:

```text
open system
-> see what matters today
-> start task / review / practice
-> check feedback
```

## 5. Data Sources

v1 reuses existing frontend state and API data.

```text
todayPlan
dashboard overview
studentLearning.practiceSet
studentLearning.wrongQuestionSummary
studentLearning.reviewResources
studentProgress.masteryMap
studentProgress.learningProfile
stageReport
learningCalendar
```

No new endpoint is required for v1. If a future iteration needs richer planning explanations, that should be a separate design.

## 6. Interaction Model

The console actions are navigation/focus actions only.

Examples:

```text
"Start today's task"        -> navigate to plan section and focus the first unfinished task
"Review wrong questions"    -> navigate to wrong-book section
"Practice weak points"      -> navigate to practice/recommended practice section
"Take stage assessment"     -> navigate to stage assessment section
"View report"               -> navigate to report section
"Open knowledge catalog"    -> navigate to knowledge catalog section
```

If an existing section name differs in code, implementation should use the current `RoleSection` values rather than inventing new routes.

## 7. Architecture

Add one focused presentational component:

```text
StudentLearningConsole
```

Responsibilities:

- derive display cards from existing props;
- render today's learning path;
- render autonomous learning entry points;
- render current status;
- emit navigation callbacks.

Non-responsibilities:

- fetching data directly;
- mutating tasks;
- completing tasks;
- creating practice sessions;
- changing planner rules;
- writing to the database.

`App.tsx` remains the orchestration layer that already owns data hooks and section navigation.

## 8. Scope Boundaries

In scope:

- frontend-only console component;
- existing data wiring;
- deterministic next-step copy;
- section navigation/focus;
- tests for rendered guidance and navigation callbacks.

Out of scope:

- database migrations;
- new backend endpoints;
- AI-generated daily plans;
- Retrieval V2 production annotation integration;
- rewriting `TodayPlan`;
- replacing existing report/practice/wrong-book flows;
- large navigation redesign.

## 9. Error and Empty States

The console must remain useful when some data is unavailable.

Rules:

- If `todayPlan` is missing, show onboarding / plan setup guidance and autonomous learning entries.
- If wrong-question summary is unavailable, hide the due-count claim and keep the wrong-book entry.
- If mastery data is unavailable, show "practice recommended set" instead of naming a weak point.
- In production, do not silently replace failed API data with mock data beyond the existing approved mock policy.

## 10. Testing Strategy

Add frontend tests around behavior, not implementation details.

Required coverage:

- console renders daily path from a non-empty `todayPlan`;
- console shows autonomous learning entries;
- unfinished priority task produces a "start today's task" recommendation;
- due wrong questions produce a wrong-review recommendation;
- completed day produces a report / weak-practice next-step suggestion;
- action buttons call the expected navigation callbacks;
- missing optional data does not crash and does not invent precise counts.

Existing full repository tests must remain at zero failures.

## 11. Acceptance Criteria

The feature is accepted when:

```text
1. Student home first screen contains the learning console.
2. Student can identify today's first action without reading the full task list.
3. Student has visible autonomous study choices.
4. Console uses only existing data sources.
5. No database or backend contract changes are introduced.
6. Existing TodayPlan, practice, wrong-book, report, and catalog flows remain usable.
7. Focused tests and npm test pass with 0 failures.
```

## 12. Recommended Implementation Approach

Use the approved option B:

```text
Create a new StudentLearningConsole component and wire it into the student home overview using existing data.
```

This balances product impact and engineering risk:

- more useful than only editing `TodayPlan`;
- much smaller than redesigning the full student app;
- keeps v1 reversible and easy to test.
